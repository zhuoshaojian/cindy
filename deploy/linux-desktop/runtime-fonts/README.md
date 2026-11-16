# Cloud runtime emoji font

The base's Debian font packages (CJK, DejaVu and others) include no color emoji
font, so some emoji would render as missing-glyph boxes. The image bundles Noto
Color Emoji. A fallback family match alone does not prove glyph coverage.

`../runtime-base/Dockerfile` downloads Debian bookworm's `fonts-noto-color-emoji`
`2.042-0+deb12u1` through the signed package index, checks the package SHA-256
`a5ab0f69c7938423862320d9aca5dd187b3fd879d6a9a57dd52e17c3fa8d2751`, and stages
the font with `stage-emoji-font.py`; the package itself is not installed. The helper
verifies the exact font and license bytes before writing anything, stages both with
explicit modes regardless of umask, rejects symlinked or overlapping paths, and
prints a JSON manifest of the staged files. Manual use, with the package extracted
outside the repository:

```sh
python3 stage-emoji-font.py /path/to/extracted-package /path/to/image-layer
```

Keep the font in the dependency base. Do not append it to an existing runtime image
or install it into instance data volumes.

Debian's existing `60-generic.conf` already maps `emoji` to Noto Color Emoji;
no client CSS, language settings, or extra global font override is needed.

When changing the font, verify on a fresh read-only-root runtime as UID 10001:
`fc-match emoji`, codepoint coverage, and actual Electron rendering with
representative emoji (basic faces, rocket, robot, skin tone, ZWJ profession/family,
flags, variation selectors) next to CJK text. Confirm the license is readable and
image directory modes remain 0755. Fontconfig matching alone is not the rendering
gate. Some glyphs keep a monochrome design; check that combined emoji form one glyph
rather than treating every monochrome glyph as missing.

Packaging regression checks (no external downloads required):

```sh
python3 deploy/linux-desktop/runtime-fonts/test_stage_emoji_font.py
```
