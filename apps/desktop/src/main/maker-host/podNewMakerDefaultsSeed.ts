/**
 * Pod 专属:用本机会话历史播种 newMakerDefaultsCache。
 *
 * 为什么需要它:newMakerDefaultsCache 的真源是 renderer 的 newMakerDraft(localStorage),
 * 由 renderer 在启动时全量 push 一次。**headless Pod 没有窗口**(headless-startup 跳过
 * 窗口创建),那次 push 永不发生,于是 cache 恒为 null。
 *
 * cache 为 null 的后果不是「回落到合理默认」,而是回落错了一档:
 * getRemoteNewMakerDefaults 此时连 modelChosenByUser 都不带(cache 为 null → undefined),
 * 而控制端的 resolveDeviceLinkDraftDefaults 把 undefined 当「旧版被控端,选没选过未知」
 * 的保守分支处理 —— 于是既不用目录标记的新对话默认(那条要求明确 === false),也没有
 * remoteDraft.model 可用,最终落到 availableModels[0](目录里排第一个,不是推荐的那个)。
 *
 * 所以本模块要做的是**把事实报准**,而不是另造一套默认:
 *   - 该 vendor 在本 Pod 用过 → 播种它最近一次用的 model(这就是「跟随习惯」);
 *   - 该 vendor 没用过 → modelChosenByVendor 明确置 false,让控制端**已有的**
 *     newSessionDefault 目录默认生效(那条链还会按 capabilities 校验模型,比这里
 *     凭一个账号级单值猜某 vendor 该用什么可靠得多)。
 * 两者互斥且不可同时:markedDefault 优先于 remoteDraft.model,置 false 会把播种值盖掉。
 *
 * **它不替代 renderer 真源**,普通桌面绝不调用(那里 renderer 的 push 才是权威,
 * 提前塞一份历史值会覆盖用户的真实草稿)。
 *
 * 习惯口径(2026-09-03 用户裁决):跟随**云端自己的最近使用** —— 即这个 Pod 上最近一次
 * 用某 vendor 建的会话所用的模型。跨设备口径(跟随桌面客户端)会突破「控制端纯镜像 /
 * 被控端单一真相」的架构契约,不在这里做。
 *
 * 耐久性:会话历史在 PVC 上,实例睡醒仍在 —— 这是它比 applyPodDraftPref(进程内 cache,
 * 睡醒即丢)更耐久的一半;两者互补,不是二选一。
 */

/** 与 newMakerDefaultsCache 的 VendorKey 对齐。 */
type VendorKey = 'cc' | 'codex' | 'pi';

/** sessions.agent_kind 的存储值 → cache 的 vendor key。 */
const VENDOR_BY_AGENT_KIND = new Map<string, VendorKey>([
  ['cc', 'cc'],
  ['claude-code', 'cc'],
  ['codex', 'codex'],
  ['pi', 'pi'],
]);

export interface PodRecentSessionModel {
  /** sessions.agent_kind 原值。 */
  agentKind: string;
  /** sessions.model;空串/缺失视为无习惯。 */
  model: string | null;
  /** 该 vendor 最近一条会话的排序依据,仅用于取「最近」。 */
  updatedAt: number;
}

export interface PodNewMakerDefaultsSeedInput {
  /** Pod 本地库里每个 vendor 的最近会话(顺序不限,同 vendor 多条时取 updatedAt 最大)。 */
  recentSessions: readonly PodRecentSessionModel[];
}

/** 播种结果:直接就是要写进 cache 的两个字段。 */
export interface PodNewMakerDefaultsSeed {
  /** 用过的 vendor → 它最近一次用的模型。 */
  lastByVendor: Partial<Record<VendorKey, { model: string }>>;
  /**
   * 没用过的 vendor → false(「明确未选过」)。**只填 false**:true 只能由用户在选择器里
   * 真选过时经 applyPodDraftPref 写入,这里替他声明选过会让控制端的目录默认永久失效。
   */
  modelChosenByVendor: Partial<Record<VendorKey, false>>;
}

function normalizeModel(model: string | null | undefined): string | null {
  const trimmed = model?.trim() ?? '';
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * 纯函数:由「本 Pod 最近会话」算出要播种的 cache 形状。
 *
 * 只填 model。effort / fast / permissionMode / providerId 一律不猜 —— 那些在
 * getRemoteNewMakerDefaults 里各有自己的回落链,凭历史臆造反而会把控制端的
 * capabilities 默认顶掉。
 */
export function computePodNewMakerDefaultsSeed(
  input: PodNewMakerDefaultsSeedInput,
): PodNewMakerDefaultsSeed {
  // 存已规范化的 model,而不是原始行:否则投影时得再 normalize 一次,并留下一条
  // 因上面已过滤而永不可达的 falsy 分支。
  const newestByVendor = new Map<VendorKey, { model: string; updatedAt: number }>();
  for (const session of input.recentSessions) {
    const vendor = VENDOR_BY_AGENT_KIND.get(session.agentKind.trim());
    if (!vendor) continue;
    const model = normalizeModel(session.model);
    if (!model) continue;
    const existing = newestByVendor.get(vendor);
    if (!existing || session.updatedAt > existing.updatedAt) {
      newestByVendor.set(vendor, { model, updatedAt: session.updatedAt });
    }
  }

  const lastByVendor: PodNewMakerDefaultsSeed['lastByVendor'] = {};
  for (const [vendor, { model }] of newestByVendor) lastByVendor[vendor] = { model };

  // 没有历史的 vendor 才声明「未选过」,把目录默认那条链让给控制端。
  const modelChosenByVendor: PodNewMakerDefaultsSeed['modelChosenByVendor'] = {};
  for (const vendor of ['cc', 'codex', 'pi'] as const) {
    if (!lastByVendor[vendor]) modelChosenByVendor[vendor] = false;
  }

  return { lastByVendor, modelChosenByVendor };
}

/**
 * 把播种结果补成完整草稿快照。effortByModel / fastModeByModel 是空表而非缺省:
 * NewMakerDraftSnapshot 要求它们必填,而「本 Pod 没记过任何模型级预设」正是空表的含义。
 */
export function podSeedToDraftSnapshot(seed: PodNewMakerDefaultsSeed): PodDraftSnapshot {
  return {
    lastByVendor: { ...seed.lastByVendor },
    modelChosenByVendor: { ...seed.modelChosenByVendor },
    fastModeByModel: {},
    effortByModel: {},
  };
}

/** 控制端经隧道下发的草稿模型偏好(APPLY_NEW_MAKER_DRAFT_PREF 的已校验形状)。 */
export interface PodDraftPref {
  agent: 'claude-code' | 'codex' | 'pi';
  modelId: string;
  providerId?: string;
  effort?: string;
  fast?: boolean;
  /** false = 只改该模型的 effort/fast 预设,不改「当前选中模型」。 */
  active: boolean;
}

/** 与 newMakerDefaultsCache.NewMakerDraftSnapshot 同形(只取本模块要写的字段)。 */
export interface PodDraftSnapshot {
  lastByVendor: Partial<Record<VendorKey, {
    model?: string;
    effort?: string;
    permissionMode?: string;
    providerId?: string | null;
  }>>;
  modelChosenByVendor?: Partial<Record<VendorKey, boolean>>;
  fastModeByModel: Record<string, boolean>;
  effortByModel: Record<string, string>;
  worktreeEnabled?: boolean;
}

const VENDOR_BY_AGENT: Record<PodDraftPref['agent'], VendorKey> = {
  'claude-code': 'cc',
  codex: 'codex',
  pi: 'pi',
};

/**
 * 纯函数:把一条控制端下发的 pref 应用到草稿快照上,返回新快照。
 *
 * 这是 Pod 上**替代 renderer 的那一步**。普通桌面由 renderer 的本地 setter 完成同样语义
 * 后经 SYNC_NEW_MAKER_DRAFT 回写;Pod 没有窗口,DRAFT_PREF_APPLY 广播给零个接收者,
 * 所以必须由 main 自己闭环,否则控制端的选择静默丢失。
 *
 * 语义对齐 register.ts 的入参校验:active=true 才改「当前选中模型」;effort/fast 是
 * **按模型**的全局预设(key 是 modelId,不带 vendor),无论 active 与否都写 —— 与
 * getRemoteNewMakerDefaults 读 effortByModel/fastModeByModel 的方式一致。
 */
export function applyPodDraftPref(
  snapshot: PodDraftSnapshot | null,
  pref: PodDraftPref,
): PodDraftSnapshot {
  const base: PodDraftSnapshot = snapshot
    ? {
        ...snapshot,
        lastByVendor: { ...snapshot.lastByVendor },
        modelChosenByVendor: { ...(snapshot.modelChosenByVendor ?? {}) },
        fastModeByModel: { ...snapshot.fastModeByModel },
        effortByModel: { ...snapshot.effortByModel },
      }
    : { lastByVendor: {}, modelChosenByVendor: {}, fastModeByModel: {}, effortByModel: {} };

  const vendor = VENDOR_BY_AGENT[pref.agent];
  const model = normalizeModel(pref.modelId);
  if (!model) return base;

  if (pref.effort !== undefined) base.effortByModel[model] = pref.effort;
  if (pref.fast !== undefined) base.fastModeByModel[model] = pref.fast;

  if (pref.active) {
    base.lastByVendor[vendor] = {
      ...(base.lastByVendor[vendor] ?? {}),
      model,
      ...(pref.effort !== undefined ? { effort: pref.effort } : {}),
      ...(pref.providerId !== undefined ? { providerId: pref.providerId } : {}),
    };
    // 用户在选择器里显式选过 → 控制端据此不再用 capabilities 默认覆盖显示。
    base.modelChosenByVendor = { ...(base.modelChosenByVendor ?? {}), [vendor]: true };
  }
  return base;
}
