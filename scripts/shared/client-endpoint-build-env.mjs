/**
 * 客户端构建期端点自举配置。
 *
 * 运行期业务端点的唯一事实源是 region 对应的 config/endpoint*.json；构建期烘焙
 * region 与 CN/Global 两份清单的 CDN 基址。基址直接取仓内正本的 cdnBaseUrl，
 * 避免再维护一份 production-endpoints.json 镜像。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import manifestBaseUrl from './manifest-base-url.cjs';

const { normalizeManifestBaseUrl } = manifestBaseUrl;

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const CLIENT_BUILD_REGIONS = Object.freeze(['cn', 'global', 'dev']);
export const DESKTOP_ENDPOINT_MANIFEST_BASES_SCHEMA_VERSION = 1;

const DESKTOP_ENDPOINT_MANIFEST_BASES_KEYS = Object.freeze([
  'schemaVersion',
  'region',
  'currentManifestBaseUrl',
  'peerManifestBaseUrl',
]);

/** 规范化并校验构建 region。 */
export function resolveClientBuildRegion(authRegion) {
  const region = authRegion?.trim() || 'global';
  if (!CLIENT_BUILD_REGIONS.includes(region)) {
    throw new Error(`Invalid Cindy auth region: ${region}; expected cn, global or dev`);
  }
  return region;
}

/** auth-server / endpoint manifest 的物理 realm 只认 CN / Global；dev 身份落在 CN。 */
export function resolveClientEndpointRealmRegion(authRegion) {
  return resolveClientBuildRegion(authRegion) === 'global' ? 'global' : 'cn';
}

/** 返回 region 对应的仓内端点清单正本路径。 */
export function clientEndpointManifestPath(authRegion, repoRoot = REPO_ROOT) {
  const region = resolveClientBuildRegion(authRegion);
  const fileByRegion = {
    cn: 'endpoint.json',
    global: 'endpoint.global.json',
    dev: 'endpoint.dev.json',
  };
  return path.join(repoRoot, 'config', fileByRegion[region]);
}

/**
 * 从仓内端点清单读取不可自引用覆盖的 CDN 自举基址。
 * @param {{ authRegion?: string, repoRoot?: string }} [options]
 */
export function loadEndpointManifestBaseUrl(options = {}) {
  const region = resolveClientBuildRegion(options.authRegion);
  const manifestPath = clientEndpointManifestPath(region, options.repoRoot);
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') {
      throw new Error(`缺少 ${region} 客户端端点清单: ${manifestPath}`);
    }
    if (error instanceof SyntaxError) {
      throw new Error(`客户端端点清单不是合法 JSON: ${manifestPath}`);
    }
    throw error;
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`客户端端点清单必须是 JSON object: ${manifestPath}`);
  }
  if (!Number.isInteger(parsed.schemaVersion) || parsed.schemaVersion < 1) {
    throw new Error(`客户端端点清单 schemaVersion 非法: ${manifestPath}`);
  }

  return normalizeManifestBaseUrl(parsed.cdnBaseUrl, {
    fieldName: 'cdnBaseUrl',
    source: `客户端端点清单 ${manifestPath}`,
  });
}

/**
 * 返回当前构建区域之外的另一份受信任清单基址。CN/Global 互为对端；
 * dev 以 CN 身份运行，仍只把 Global 作为对端。
 */
export function loadPeerEndpointManifestBaseUrl(options = {}) {
  const region = resolveClientBuildRegion(options.authRegion);
  return loadEndpointManifestBaseUrl({
    authRegion: region === 'global' ? 'cn' : 'global',
    repoRoot: options.repoRoot,
  });
}

/**
 * 读取 Desktop packaged 构建的显式清单基址注入文件。
 *
 * 这是专用、可审计的构建输入，不读取普通 env override。相对路径始终以仓库根为基准，
 * 避免从根脚本与 apps/desktop 脚本启动时得到两套含义。
 */
export function loadDesktopEndpointManifestBases(options = {}) {
  const configuredPath = options.filePath?.trim();
  if (!configuredPath) {
    throw new Error('Desktop 端点清单基址注入缺少 filePath');
  }
  const repoRoot = options.repoRoot ?? REPO_ROOT;
  const filePath = path.isAbsolute(configuredPath) ? configuredPath : path.resolve(repoRoot, configuredPath);
  const source = `Desktop 端点清单基址配置 ${filePath}`;
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') {
      throw new Error(`缺少 ${source}`);
    }
    if (error instanceof SyntaxError) {
      throw new Error(`${source} 不是合法 JSON`);
    }
    throw error;
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${source} 必须是 JSON object`);
  }
  if (parsed.schemaVersion !== DESKTOP_ENDPOINT_MANIFEST_BASES_SCHEMA_VERSION) {
    throw new Error(`${source} schemaVersion 必须为 ${DESKTOP_ENDPOINT_MANIFEST_BASES_SCHEMA_VERSION}`);
  }
  const unknownKeys = Object.keys(parsed).filter((key) => !DESKTOP_ENDPOINT_MANIFEST_BASES_KEYS.includes(key));
  if (unknownKeys.length > 0) {
    throw new Error(`${source} 包含未知字段: ${unknownKeys.join(', ')}`);
  }
  if (parsed.region !== 'cn' && parsed.region !== 'global') {
    throw new Error(`${source} 字段 region 只能是 cn 或 global`);
  }
  const buildRealm = resolveClientEndpointRealmRegion(options.authRegion);
  if (parsed.region !== buildRealm) {
    throw new Error(`${source} region 与构建物理 realm 不一致: expected ${buildRealm}, got ${parsed.region}`);
  }

  return {
    currentManifestBaseUrl: normalizeManifestBaseUrl(parsed.currentManifestBaseUrl, {
      fieldName: 'currentManifestBaseUrl',
      source,
    }),
    peerManifestBaseUrl: normalizeManifestBaseUrl(parsed.peerManifestBaseUrl, {
      fieldName: 'peerManifestBaseUrl',
      source,
    }),
  };
}

/** Desktop 正式构建所需的公开 Vite 变量。 */
export function desktopClientBuildEnv({
  allowEnvOverride = true,
  authRegion,
  endpointManifestBasesFile,
  repoRoot,
} = {}) {
  const region = resolveClientBuildRegion(
    authRegion ||
      process.env.CINDY_AUTH_REGION?.trim() ||
      (allowEnvOverride ? process.env.VITE_CINDY_AUTH_REGION?.trim() : ''),
  );
  const override = allowEnvOverride ? process.env.VITE_ENDPOINT_MANIFEST_BASE_URL?.trim() : '';
  const peerOverride = allowEnvOverride ? process.env.VITE_ENDPOINT_MANIFEST_PEER_BASE_URL?.trim() : '';
  const explicitBases = endpointManifestBasesFile
    ? loadDesktopEndpointManifestBases({
        filePath: endpointManifestBasesFile,
        authRegion: region,
        repoRoot,
      })
    : null;
  return {
    VITE_CINDY_AUTH_REGION: region,
    VITE_ENDPOINT_MANIFEST_BASE_URL:
      explicitBases?.currentManifestBaseUrl ||
      override ||
      loadEndpointManifestBaseUrl({ authRegion: region, repoRoot }),
    VITE_ENDPOINT_MANIFEST_PEER_BASE_URL:
      explicitBases?.peerManifestBaseUrl ||
      peerOverride ||
      loadPeerEndpointManifestBaseUrl({ authRegion: region, repoRoot }),
  };
}

/** Mobile/EAS 构建所需的公开变量。 */
export function mobileClientBuildEnv({ authRegion, repoRoot } = {}) {
  const region = resolveClientBuildRegion(
    authRegion || process.env.EXPO_PUBLIC_CINDY_AUTH_REGION?.trim(),
  );
  return {
    EXPO_PUBLIC_CINDY_AUTH_REGION: region,
    EXPO_PUBLIC_ENDPOINT_MANIFEST_BASE_URL: loadEndpointManifestBaseUrl({
      authRegion: region,
      repoRoot,
    }),
  };
}

/**
 * Mobile JS bundle 额外需要对端区域清单基址。与 mobileClientBuildEnv 分开，
 * 避免把这个纯 JS 变量加入 app.config 的既有 Expo extra / runtime fingerprint。
 */
export function mobileClientBundleEnv(options = {}) {
  const buildEnv = mobileClientBuildEnv(options);
  return {
    ...buildEnv,
    EXPO_PUBLIC_ENDPOINT_MANIFEST_PEER_BASE_URL: loadPeerEndpointManifestBaseUrl({
      authRegion: buildEnv.EXPO_PUBLIC_CINDY_AUTH_REGION,
      repoRoot: options.repoRoot,
    }),
  };
}
