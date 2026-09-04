#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SHA256_RE = /^sha256:[a-f0-9]{64}$/;
const SOURCE_SHA_RE = /^[a-f0-9]{40}$/;
const SOURCE_REPOSITORY_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const BUILDKIT_DIGEST_SOURCES = new Set([
  'steps.build.outputs.digest',
  'steps.build.outputs.metadata["containerimage.config.digest"]',
]);

export function buildCloudRuntimeMetadata(input) {
  if (!SHA256_RE.test(input.buildkitDigest)) {
    throw new Error(`buildkitDigest must be sha256:<64 lowercase hex>, got ${input.buildkitDigest}`);
  }
  if (!SHA256_RE.test(input.loadedImageConfigId)) {
    throw new Error(
      `loadedImageConfigId must be sha256:<64 lowercase hex>, got ${input.loadedImageConfigId}`,
    );
  }
  if (!SHA256_RE.test(input.imageArchiveSha256)) {
    throw new Error(
      `imageArchiveSha256 must be sha256:<64 lowercase hex>, got ${input.imageArchiveSha256}`,
    );
  }
  if (!SOURCE_SHA_RE.test(input.sourceSha)) {
    throw new Error(`sourceSha must be a 40-character lowercase git SHA, got ${input.sourceSha}`);
  }
  if (!SOURCE_REPOSITORY_RE.test(input.sourceRepository)) {
    throw new Error(`sourceRepository must be an owner/repository slug, got ${input.sourceRepository}`);
  }
  if (!BUILDKIT_DIGEST_SOURCES.has(input.buildkitDigestSource)) {
    throw new Error(`unsupported buildkitDigestSource: ${input.buildkitDigestSource}`);
  }
  if (!input.imageTag || !input.imageRef.endsWith(`:${input.imageTag}`)) {
    throw new Error('imageRef must end with the supplied imageTag');
  }
  if (input.platform !== 'linux/amd64') {
    throw new Error(`cloud runtime platform must be linux/amd64, got ${input.platform}`);
  }
  return {
    schemaVersion: 1,
    image: {
      buildkitDigest: input.buildkitDigest,
      buildkitDigestSource: input.buildkitDigestSource,
      loadedImageConfigId: input.loadedImageConfigId,
      reference: input.imageRef,
      platform: input.platform,
      tag: input.imageTag,
    },
    source: {
      repository: input.sourceRepository,
      revision: input.sourceSha,
      ref: input.sourceRef,
      dockerfile: 'deploy/cloud-instance/Dockerfile',
    },
    build: {
      createdAt: input.createdAt,
      runId: input.runId,
      runAttempt: input.runAttempt,
    },
    artifacts: {
      imageArchive: {
        path: input.imageArchive,
        sha256: input.imageArchiveSha256,
      },
      sbom: {
        path: input.sbom,
      },
    },
    promotion: {
      enabled: false,
      reason: 'Build-1 records a tested local archive only; promotion must use the future registry push digest.',
    },
  };
}

function parseArgs(argv) {
  const values = new Map();
  for (const arg of argv) {
    const match = arg.match(/^--([a-z-]+)=(.*)$/s);
    if (!match) throw new Error(`expected --name=value, got ${arg}`);
    values.set(match[1], match[2]);
  }
  const requireValue = (name) => {
    const value = values.get(name);
    if (!value) throw new Error(`missing --${name}=...`);
    return value;
  };
  return {
    output: requireValue('output'),
    input: {
      imageRef: requireValue('image-ref'),
      imageTag: requireValue('image-tag'),
      buildkitDigest: requireValue('buildkit-digest'),
      buildkitDigestSource: requireValue('buildkit-digest-source'),
      loadedImageConfigId: requireValue('loaded-image-config-id'),
      platform: requireValue('platform'),
      sourceRepository: requireValue('source-repository'),
      sourceSha: requireValue('source-sha'),
      sourceRef: requireValue('source-ref'),
      createdAt: requireValue('created-at'),
      runId: requireValue('run-id'),
      runAttempt: requireValue('run-attempt'),
      imageArchive: requireValue('image-archive'),
      imageArchiveSha256: requireValue('image-archive-sha256'),
      sbom: requireValue('sbom'),
    },
  };
}

function main() {
  const { input, output } = parseArgs(process.argv.slice(2));
  const metadata = buildCloudRuntimeMetadata(input);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(metadata, null, 2)}\n`);
  console.log(`[cloud-runtime-metadata] wrote ${output}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(`[cloud-runtime-metadata] ${error.message ?? String(error)}`);
    process.exit(1);
  }
}
