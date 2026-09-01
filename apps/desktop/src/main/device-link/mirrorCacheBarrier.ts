/**
 * mirrorCacheBarrier —— 镜像缓存的**跨进程作废屏障**(持久计数器)。
 * ---------------------------------------------------------------------------
 * 跨进程锁只保证「清理」与「提交」不重叠,挡不住这一种:B 的写入**在清理之前**就取到了内容,
 * 却在清理结束、锁释放之后才提交 —— 那份内容是被撤销设备 / 上一个账号的旧正文,照写等于把它
 * 重建出来(review: codex P1)。
 *
 * 机制:写入侧在**发起时**读一次计数,提交前(锁内)再读一次;变了就丢弃这次写。用计数而不是
 * 时间戳 —— 毫秒精度下"清理在同一毫秒内跑完"时时间戳挡不住,计数没有精度问题。
 *
 * 为什么单独成模块:`mirrorCacheStore`(清理与写入)与 `mirrorCachePurgeQueue`(失败重试的
 * 消化)都要动这些计数器 —— 队列在补删掉残留之后必须**顺手把屏障修好**,否则「自增失败 →
 * 只登记了文件 → 队列删掉文件、扔掉记录、计数原样」的组合会让一笔迟到的、仍握着旧计数的写入
 * 在消化之后通过比对,把已清掉的正文重建回来(review: codex P1)。两个模块共用同一份实现,
 * 也保证"落位方式 / 三态语义"不会各写一遍走偏。
 *
 * 位置:计数器住在缓存根的**兄弟**目录 `<cache-root>.control/cleared/` —— `clearAll()` 会
 * 递归删掉整棵缓存根,放在里面等于把自己的屏障一起删掉(缺失会被读成初始值 0,与发起时读到的
 * 一样 → 屏障失效)。仍在 owner 命名空间内,切账号照样隔离。
 */

import path from 'node:path';
import fsp from 'node:fs/promises';
import { createHash, randomBytes } from 'node:crypto';

/** 控制面目录后缀(与缓存根同级,clearAll 不会删它)。 */
export const CACHE_CONTROL_SUFFIX = '.control';
const CLEARED_DIR = 'cleared';
/** 列表快照是整份写,任何设备被清都可能让它变陈旧 → 用一个共享计数器。 */
export const CLEARED_ANY = '_any';
/** 账号级(登出 / 切账号 / clearAll)计数器:它删的是整棵缓存根,而计数器在根之外。 */
export const CLEARED_ACCOUNT = '_account';

/**
 * 作废计数的三态读取结果:
 *  - number:计数(缺文件 = 0,从未清过);
 *  - `'denied'`:文件在那儿但**没权限**读(EACCES / EPERM)—— 屏障可能是真的,fail-closed;
 *  - `'unknown'`:资源类失败(EMFILE / EBUSY…)或内容不是数字 —— **无法比对**,写入侧一律
 *    按"可能清过"处理(fail-closed)。取舍很不对称:少写一次缓存只是少一次首屏加速,而放行
 *    一笔可能取自清理之前的内容,等于把被撤销设备 / 上个账号的正文重建到盘上(review: codex
 *    P1)。计数文件是原子落位的,所以"内容不是数字"只会来自外部损坏,那时更不该信它。
 */
export type ClearCounter = number | 'denied' | 'unknown';

export function controlDir(root: string): string {
  return `${root}${CACHE_CONTROL_SUFFIX}`;
}

/** 镜像缓存的跨进程锁文件(store 的写入 / 清理与 purge 队列的补删都用它互斥)。 */
export function cacheLockPath(root: string): string {
  return path.join(controlDir(root), 'lock');
}

export function clearedMarkPath(root: string, key: string): string {
  return path.join(controlDir(root), CLEARED_DIR, key);
}

/**
 * 「清理已经开始、还没确认完成」的**持久墓碑**目录。
 *
 * 计数器只记"清过几代",记不住"这一代清到一半就崩了":进程在第一次自增之后、扫描 / 列表重写
 * 之前退出时,被撤销设备的正文还在盘上,而计数前后一致 —— 重启后读路径照样命中,离线时更是
 * 一直显示那批本该消失的消息(review: codex P1)。所以清理开始前先落一个墓碑,**清完才删**;
 * 墓碑存在期间该 root 的读一律不命中(fail-closed)。
 *
 * 与 purge 队列的分工:队列负责"把删不掉的东西继续删",墓碑负责"没确认删完之前不许读"。
 * 崩溃残留的墓碑会让缓存对该 root 保持关闭,直到下一次成功的清理(设备撤销是粘滞的,
 * 下次启动仍会重新发起 clearDevice;登出走 clearAll)把它清掉。
 */
const PENDING_DIR = 'pending';
const DEVICE_RETIREMENT_PREFIX = 'retired-device-';

export function isDeviceRetirementScope(scope: string): boolean {
  return scope.startsWith(DEVICE_RETIREMENT_PREFIX);
}

export interface DeviceRetirementTombstone {
  deviceId: string;
  instanceId?: string;
  createdAtMs: number;
}

export function pendingClearDir(root: string): string {
  return path.join(controlDir(root), PENDING_DIR);
}

function retirementScope(deviceId: string): string {
  return `${DEVICE_RETIREMENT_PREFIX}${createHash('sha256').update(deviceId.trim()).digest('hex')}`;
}

function parseRetirementTombstone(raw: string, scope: string): DeviceRetirementTombstone | null {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const deviceId = typeof parsed.deviceId === 'string' ? parsed.deviceId.trim() : '';
    const instanceId = typeof parsed.instanceId === 'string' ? parsed.instanceId.trim() : undefined;
    const createdAtMs = parsed.createdAtMs;
    if (
      parsed.version !== 1
      || parsed.kind !== 'device-retirement'
      || !deviceId
      || typeof createdAtMs !== 'number'
      || !Number.isFinite(createdAtMs)
      || createdAtMs < 0
      || retirementScope(deviceId) !== scope
    ) {
      return null;
    }
    return { deviceId, ...(instanceId ? { instanceId } : {}), createdAtMs };
  } catch {
    return null;
  }
}

/**
 * 云端设备删除后的长期退役墓碑。与清理过程墓碑共用 control/pending 目录，但内容带类型与
 * 原始 deviceId，供重启后继续对账。落位失败必须抛出：没有墓碑就不能声称已阻止后续镜像回写。
 */
export async function markDeviceRetirement(
  root: string,
  deviceId: string,
  createdAtMs = Date.now(),
  instanceId?: string,
): Promise<void> {
  const id = deviceId.trim();
  if (!id) throw new Error('mirror cache: device retirement requires deviceId');
  const dir = pendingClearDir(root);
  await fsp.mkdir(dir, { recursive: true });
  const file = path.join(dir, retirementScope(id));
  const tmp = `${file}.${randomBytes(6).toString('hex')}.tmp`;
  const oldInstanceId = instanceId?.trim();
  const payload = JSON.stringify({
    version: 1,
    kind: 'device-retirement',
    deviceId: id,
    ...(oldInstanceId ? { instanceId: oldInstanceId } : {}),
    createdAtMs,
  });
  try {
    await fsp.writeFile(tmp, payload, 'utf8');
    await fsp.rename(tmp, file);
  } catch (err) {
    await fsp.rm(tmp, { force: true }).catch(() => undefined);
    throw err;
  }
}

export async function clearDeviceRetirement(root: string, deviceId: string): Promise<void> {
  await fsp.rm(path.join(pendingClearDir(root), retirementScope(deviceId)), { force: true });
}

/**
 * 单设备写入闸。读取失败一律按 tombstoned 处理：少写一次可重建缓存，优于把已删设备写回来。
 */
export async function hasDeviceRetirement(root: string, deviceId: string): Promise<boolean> {
  const id = deviceId.trim();
  if (!id) return false;
  const scope = retirementScope(id);
  try {
    await fsp.readFile(path.join(pendingClearDir(root), scope), 'utf8');
    // 文件存在但内容损坏也必须封锁；把损坏当“不存在”会正好在最不可信时放行回写。
    return true;
  } catch (err) {
    const code = errnoCode(err);
    if (code === 'ENOENT' || code === 'ENOTDIR') return false;
    return true;
  }
}

/** 列出持久退役墓碑；目录或内容不可读时抛出，调用方不得据此错误解除。 */
export async function listDeviceRetirements(root: string): Promise<DeviceRetirementTombstone[]> {
  let names: string[];
  try {
    names = await fsp.readdir(pendingClearDir(root));
  } catch (err) {
    const code = errnoCode(err);
    if (code === 'ENOENT' || code === 'ENOTDIR') return [];
    throw err;
  }
  const tombstones: DeviceRetirementTombstone[] = [];
  for (const scope of names) {
    if (!isDeviceRetirementScope(scope) || scope.endsWith('.tmp')) continue;
    const raw = await fsp.readFile(path.join(pendingClearDir(root), scope), 'utf8');
    const parsed = parseRetirementTombstone(raw, scope);
    if (!parsed) throw new Error(`mirror cache: malformed device retirement tombstone (${scope})`);
    tombstones.push(parsed);
  }
  return tombstones;
}

/** 落墓碑。**失败会抛** —— 落不下去就不该开始删(等于没有"没删完"的痕迹)。 */
export async function markClearPending(root: string, scope: string): Promise<void> {
  const dir = pendingClearDir(root);
  await fsp.mkdir(dir, { recursive: true });
  const file = path.join(dir, scope);
  const tmp = `${file}.${randomBytes(6).toString('hex')}.tmp`;
  try {
    await fsp.writeFile(tmp, String(Date.now()), 'utf8');
    await fsp.rename(tmp, file);
  } catch (err) {
    await fsp.rm(tmp, { force: true }).catch(() => undefined);
    throw err;
  }
}

/** 清理确认完成后撤墓碑。删不掉不算致命(只是读继续被挡),记日志由调用方决定。 */
export async function clearPendingMark(root: string, scope: string): Promise<void> {
  await fsp.rm(path.join(pendingClearDir(root), scope), { force: true });
}

/**
 * 该 root 是否有"没确认清完"的墓碑。**fail-closed**:目录读不出来(EACCES / EMFILE…)一律
 * 按"有"处理 —— 读不出来时放行等于在最需要挡的场合放行。
 */
export async function hasPendingClears(root: string): Promise<boolean> {
  try {
    const names = await fsp.readdir(pendingClearDir(root));
    for (const name of names) {
      if (name.endsWith('.tmp')) continue;
      if (!isDeviceRetirementScope(name)) return true;
      let raw: string;
      try {
        raw = await fsp.readFile(path.join(pendingClearDir(root), name), 'utf8');
      } catch (err) {
        const code = errnoCode(err);
        // releaseRetiredDevice 可在 readdir 之后原子移除这一份长期墓碑；它不代表其它
        // scope 也不存在，继续检查快照里的剩余名字。其它读取失败仍 fail-closed。
        if (code === 'ENOENT' || code === 'ENOTDIR') continue;
        return true;
      }
      // 长期退役墓碑只封锁目标设备；损坏 / 伪造的同前缀文件继续按全 root pending 处理。
      if (!parseRetirementTombstone(raw, name)) return true;
    }
    return false;
  } catch (err) {
    const code = errnoCode(err);
    if (code === 'ENOENT' || code === 'ENOTDIR') return false;
    return true;
  }
}

/** 对外暴露的计数值:非数字(denied / unknown)一律用 -1 表示"不可比对"。 */
export function numericCounter(value: ClearCounter): number {
  return typeof value === 'number' ? value : -1;
}

function errnoCode(err: unknown): string | undefined {
  return (err as NodeJS.ErrnoException | null)?.code;
}

export async function readClearCounter(root: string, key: string): Promise<ClearCounter> {
  try {
    const raw = await fsp.readFile(clearedMarkPath(root, key), 'utf8');
    const value = Number.parseInt(raw, 10);
    return Number.isFinite(value) ? value : 'unknown';
  } catch (err) {
    const code = errnoCode(err);
    if (code === 'ENOENT' || code === 'ENOTDIR') return 0;
    if (code === 'EACCES' || code === 'EPERM') return 'denied';
    return 'unknown';
  }
}

/**
 * 列出该 root 下**所有**作废计数 key。整根清理时用它把每个计数都自增一遍 —— 队列条目里的
 * key 清单有上限(不可信 JSON 必须有界),而"这一整棵都不可信"本来就该作废全部,不该依赖
 * 那份清单是否装得下(review: codex P1)。**读不出来就抛**:整根清理不能在"数不出计数"时
 * 报成功。
 */
export async function listClearCounterKeys(root: string): Promise<string[]> {
  const dir = path.join(controlDir(root), CLEARED_DIR);
  try {
    const names = await fsp.readdir(dir);
    return names.filter((name) => !name.endsWith('.tmp'));
  } catch (err) {
    const code = errnoCode(err);
    if (code === 'ENOENT' || code === 'ENOTDIR') return [];
    throw err;
  }
}

/** 列出该 root 下所有还挂着的墓碑 scope(整根清理完成后一次全退役)。同样读不出来就抛。 */
export async function listPendingClearScopes(root: string): Promise<string[]> {
  try {
    const names = await fsp.readdir(pendingClearDir(root));
    return names.filter((name) => !name.endsWith('.tmp'));
  } catch (err) {
    const code = errnoCode(err);
    if (code === 'ENOENT' || code === 'ENOTDIR') return [];
    throw err;
  }
}

/**
 * 自增作废计数。**失败会抛** —— 这是跨进程唯一的持久屏障:另一个实例可能已经读到旧计数
 * 并在锁上等着,自增落不下去却报"清干净了"的话,它会在清理之后把被撤销设备 / 上一个账号的
 * 正文重建出来。落不下去就让调用方把这次清理当成"没清完",登记重试。
 */
export async function bumpClearedCounter(root: string, key: string): Promise<void> {
  const file = clearedMarkPath(root, key);
  const read = await readClearCounter(root, key);
  // 旧值读不出来时**不能**当 0 重来:曾经读到合法值 1 的写入,会在"清理后又被写成 1"的计数上
  // 比对成功,把刚删掉的正文重建出来。既然这是唯一的持久屏障,读不出旧值就让自增失败 ——
  // 调用方会把这次清理登记成"没清完"(purge 队列),而 purge 记录挂着期间缓存读一律被挡掉,
  // 于是失效方向是"缓存关掉",不是"旧明文回来"(review: codex P1)。
  if (typeof read !== 'number') {
    throw new Error(`mirror cache: clear counter unreadable (${read}) for ${key}`);
  }
  await fsp.mkdir(path.dirname(file), { recursive: true }).catch(() => undefined);
  // 原子落位:直接 writeFile 会有"截断了、新内容还没写完"的窗口,那一刻读出来是空串 →
  // `'unknown'`,而 unknown 是 fail-closed,撕裂一次就会把这个 key 的缓存写入长期挡住。
  // 计数文件里只有一个数字,tmp 残留不含正文,清理失败可忽略。
  const tmp = `${file}.${randomBytes(6).toString('hex')}.tmp`;
  try {
    await fsp.writeFile(tmp, String(read + 1), 'utf8');
    await fsp.rename(tmp, file);
  } catch (err) {
    await fsp.rm(tmp, { force: true }).catch(() => undefined);
    throw err;
  }
}
