#!/usr/bin/env node
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { sensitiveBuildContextContentRule } from './cloud-runtime-build-context.mjs';

const require = createRequire(import.meta.url);
const { extractFile, listPackage } = require('@electron/asar');
const SHA256_RE = /^sha256:[a-f0-9]{64}$/;
const CONFIG_EXTENSIONS = new Set(['.conf', '.ini', '.json', '.toml', '.yaml', '.yml']);

function sha256File(filePath) {
  const hash = createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return `sha256:${hash.digest('hex')}`;
}

export function packagedArchivePathRule(entryPath) {
  const normalized = entryPath.replaceAll('\\', '/').replace(/^\/+/, '');
  const segments = normalized.split('/');
  const basename = segments.at(-1) ?? '';
  if (/^\.env(?:\.|$)/i.test(basename)) return 'environment-file';
  if (/^endpoint\.(?:local|dev|mock)\.json$/i.test(basename)) return 'local-endpoint-file';
  if (segments.some((segment) => ['safe-storage', 'userData'].includes(segment))) {
    return 'persistent-user-state';
  }
  if (segments.some((segment) => [
    '.aws', '.azure', '.docker', '.kube', '.ssh', '.gnupg',
  ].includes(segment))) return 'credential-directory';
  if (/\.(?:enc|pem|key|crt|p12|pfx|jks|keystore)$/i.test(basename)) {
    return 'credential-extension';
  }
  if (/^(?:account|auth|credential|credentials|secret|secrets|token|tokens)\.(?:json|ya?ml|txt)$/i.test(basename)) {
    return 'credential-file-name';
  }
  return null;
}

export function packagedConfigContentRule(content) {
  const credentialRule = sensitiveBuildContextContentRule(content);
  if (credentialRule) return credentialRule;
  const endpointUrl = /https?:\/\/(?:localhost|127\.0\.0\.1|\[?::1\]?|host\.docker\.internal|mock(?:[.-]|\/))/i;
  if (endpointUrl.test(content)) return 'local-or-mock-endpoint';
  const urls = content.match(/[a-z][a-z0-9+.-]*:\/\/[^\s"'<>]+/gi) ?? [];
  for (const value of urls) {
    try {
      const url = new URL(value.replace(/[),.;]+$/, ''));
      if (url.username || url.password) return 'credentialed-url';
    } catch {
      // Non-URL text that happens to contain :// is not a credential finding.
    }
  }
  return null;
}

export function validatePackagedArchiveEntries({ asarPath, entries, extract = extractFile }) {
  const findings = [];
  let inspectedConfigCount = 0;
  let skippedNodeModulesConfigCount = 0;
  for (const rawEntry of entries) {
    const entryPath = rawEntry.replace(/^\/+/, '');
    const pathRule = packagedArchivePathRule(entryPath);
    if (pathRule) {
      findings.push({ entryPath, rule: pathRule });
      continue;
    }
    if (!CONFIG_EXTENSIONS.has(path.extname(entryPath).toLowerCase())) continue;
    if (entryPath.split('/').includes('node_modules')) {
      skippedNodeModulesConfigCount += 1;
      continue;
    }
    inspectedConfigCount += 1;
    const content = extract(asarPath, entryPath).toString('utf8');
    const contentRule = packagedConfigContentRule(content);
    if (contentRule) findings.push({ entryPath, rule: contentRule });
  }
  return { findings, inspectedConfigCount, skippedNodeModulesConfigCount };
}

export function createPackagedContentManifest({ asarPath, outputPath }) {
  const entries = listPackage(asarPath);
  const {
    findings,
    inspectedConfigCount,
    skippedNodeModulesConfigCount,
  } = validatePackagedArchiveEntries({ asarPath, entries });
  if (findings.length > 0) {
    throw new Error(`packaged content rejected:\n${findings.map(
      ({ entryPath, rule }) => `- ${entryPath} (${rule})`,
    ).join('\n')}`);
  }
  const archiveSha256 = sha256File(asarPath);
  if (!SHA256_RE.test(archiveSha256)) throw new Error('unable to hash packaged app.asar');
  const manifest = {
    schemaVersion: 1,
    rulesVersion: 2,
    result: 'safe',
    archive: {
      path: 'resources/app.asar',
      sha256: archiveSha256,
      entryCount: entries.length,
      inspectedConfigCount,
      skippedNodeModulesConfigCount,
    },
    findings: [],
  };
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

function parseArgs(argv) {
  const values = new Map(argv.map((arg) => {
    const match = arg.match(/^--([a-z-]+)=(.*)$/s);
    if (!match) throw new Error(`expected --name=value, got ${arg}`);
    return [match[1], match[2]];
  }));
  const required = (name) => {
    const value = values.get(name);
    if (!value) throw new Error(`missing --${name}=...`);
    return path.resolve(value);
  };
  return { asarPath: required('asar'), outputPath: required('output') };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const manifest = createPackagedContentManifest(parseArgs(process.argv.slice(2)));
    console.log(
      `[cloud-runtime-packaged-content] ${manifest.archive.entryCount} entries, ${manifest.archive.inspectedConfigCount} non-node_modules config files inspected, and ${manifest.archive.skippedNodeModulesConfigCount} node_modules config files skipped`,
    );
  } catch (error) {
    console.error(`[cloud-runtime-packaged-content] ${error.message ?? String(error)}`);
    process.exit(1);
  }
}
