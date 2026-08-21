import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  brandDeepLinkSchemes,
  brandExecutableName,
} from '@cindy/maker-shared/brand-identity';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(testDirectory, '../../..');

describe('packaged build identity wiring', () => {
  it('keeps production schemes/display names unchanged and isolates dev', () => {
    expect(brandDeepLinkSchemes('cn')).toEqual(['cindy', 'xdt-maker']);
    expect(brandDeepLinkSchemes('global')).toEqual(['cindy', 'xdt-maker']);
    expect(brandDeepLinkSchemes('dev')).toEqual(['cindydev', 'xdt-maker-dev']);

    expect(brandExecutableName('cn')).toBe('Cindy');
    expect(brandExecutableName('global')).toBe('Cindy');
    expect(brandExecutableName('dev')).toBe('CindyDev');
  });

  it('wires Forge protocols and mac display name to the same build identity', async () => {
    const source = await readFile(path.join(desktopRoot, 'forge.config.ts'), 'utf8');

    expect(source).toContain(
      'const CINDY_DEEP_LINK_SCHEMES = brandDeepLinkSchemes(CINDY_REGION);',
    );
    expect(source).toContain(
      "mimeType: CINDY_DEEP_LINK_SCHEMES.map((s) => `x-scheme-handler/${s}`)",
    );
    expect(source).toContain(
      "{ name: 'Cindy Deep Link', schemes: [...CINDY_DEEP_LINK_SCHEMES] }",
    );
    expect(source).toContain(
      'applyMacPackagedDisplayName(buildPath, opts.platform, CINDY_EXE);',
    );
    expect(source).not.toContain('schemes: [...allDeepLinkSchemes()]');
  });

  it('sequesters AppleDouble metadata so generic unzip preserves the code seal', async () => {
    const source = await readFile(path.join(desktopRoot, 'scripts/package-desktop.mjs'), 'utf8');
    const finishDarwinBody = source.slice(
      source.indexOf('async function finishDarwin'),
      source.indexOf('async function finishLinux'),
    );

    expect(finishDarwinBody).toContain(
      '/usr/bin/ditto -c -k --sequesterRsrc --keepParent',
    );
  });
});
