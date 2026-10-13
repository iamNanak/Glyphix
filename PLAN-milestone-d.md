# Milestone D — "Type that moves"

Source: `CAPABILITY-MAP-phase2.md` (modules `font-manager`, `text-styling`, `glyph-animators`, `kinetic-presets`).
Branch: `milestone-d` (from `main`).

## Gate

- 15 bundled font families (variable weights where the family has them) + upload of TTF/OTF/WOFF.
  Uploaded fonts survive reload and the `.glyphix` round-trip.
- Text styling: weight, line height, outline, soft shadow, gradient fill — WebGPU and WebGL2.
- 20+ kinetic text presets across enter / exit / emphasis, on the GPU, with unit (glyph/word/line), order and
  falloff overrides.
- 300 glyphs with enter + exit + emphasis at 60 fps (p95 ≤ 17 ms) in WebGPU and WebGL2.
- Preview = export (max Δ 0) mid-animation for every text preset.
- Phase 1 suites stay green in Chrome WebGPU, Chrome WebGL2 and Firefox.

## Design decisions

1. **Variable fonts via HarfBuzz `setVariations`.** One hb `Face` per font file, one hb `Font` per weight
   instance. Glyph SDFs are cached per (font, weight, glyph). Static families expose one weight.
2. **Atlas 4096², spread 16 px at 64 px/em.** When it fills up it is cleared and rebuilt from what is on screen
   (a generation counter invalidates layouts), instead of silently dropping glyphs.
3. **Fonts are assets.** Uploaded fonts get a content-hash id `font-<hash>`; the font bytes go into the same
   IndexedDB `assets` store and into `.glyphix` under `assets/`. `referencedAssets` includes them.
4. **Animator v2 = an "away pose" + timing.** Each animator describes how far a glyph is from its rest pose
   (`k = 1` fully away, `k = 0` at rest): offset, scaleX/Y, rotation, rotateX/Y (3D, per glyph, perspective),
   skew, opacity, blur, spread (tracking-in), colour, random offset/rotation, scramble.
   Enter uses `k = 1 − ease(p)`, exit uses `k = ease(p)`; both run in the vertex shader at the same time.
   The unit (glyph/word/line) decides the rank *and* the pivot that scale/rotation use.
5. **Per-glyph data stays in instance attributes; tables go into a small float texture per text layer**
   (easing LUTs for enter/exit, scramble charset rects). This keeps uniform counts safe on WebGL2.
6. **Presets compile to animators** (pure functions in `src/doc/kinetic.ts`), exactly like Phase 1's
   `glyphAnimatorFor`; user overrides (unit, order, overlap, falloff) are stored next to the preset id.
7. **Exit motion is new for every layer type** (`motion.exit`), mirroring enter: whole-layer presets for images,
   per-glyph presets for text. It ends at the comp end by default.
8. **Schema v3** with a migration: text layers gain weight/lineHeight/outline/shadow/fill, the legacy
   `animator` converts to animator v2, `motion.exit = null`.

## Tasks (in order; each ends green: typecheck, unit tests, e2e)

| # | Task | Done when |
|---|---|---|
| D1 | Font library v2: bundled registry (15 families), variable weights, 4096 atlas with reset-on-full, export waits for all fonts | every family renders in WebGPU + WebGL2; unit tests for registry/atlas reset |
| D2 | Font upload as assets (TTF/OTF/WOFF), IndexedDB + `.glyphix` round-trip, FontFace registration for UI previews | e2e: upload → reload → still rendered; round-trip equal |
| D3 | Text styling: schema v3 + migration; weight, line height, outline, shadow, gradient fill in the glyph shader | e2e pixel checks per style on both backends |
| D4 | Animator v2 in doc + shader (units, orders, falloff, 3D, skew, blur, spread, colour, random, scramble), enter + exit at once; CPU reference + tests | unit tests; preview = export mid-animation |
| D5 | Kinetic presets: 20+ text presets, exit presets for all layers, per-glyph emphasis loops (wave, jitter, flicker, swing, breathe, rainbow, bounce) | 20+ presets listed; each renders non-blank mid-animation |
| D6 | UI: font picker (search, categories, live previews, upload), Typography section, Animation section with Enter / Exit / Emphasis, advanced overrides, hover-to-preview | e2e-typography; keyboard reachable; a11y 100 |
| D7 | Bench + full run: 300-glyph stress with enter+exit+emphasis, all suites in Chrome/WebGL2/Firefox, status report | numbers in the Status section below |

## Status (2026-10-13)

D1–D7 done. Gate results (headless, Intel Iris Xe; Chrome WebGPU, Chrome forced WebGL2, Playwright Firefox):

| Gate | Result |
|---|---|
| 15 bundled families + upload | 15 OFL families (12 variable); TTF/OTF/WOFF upload (WOFF2 refused with a message); upload survives reload and `.glyphix` round-trip |
| Styling on both backends | weight, line height, outline, soft shadow, gradient fill, glow — e2e on WebGPU, WebGL2, Firefox |
| 20+ kinetic presets | 33 per-glyph presets: 18 enter, 8 exit, 7 emphasis loops (+ whole-layer enter/exit for every layer) |
| Unit / order / falloff overrides | "Letter timing": letter / word / line, 5 orders, overlap, spacing |
| 300 glyphs, enter + exit + emphasis | 60 fps, p95 16.7 ms on WebGPU and WebGL2 (bench scene "300 glyphs, enter + exit + wave") |
| Preview = export | max Δ 0 mid-animation for all 33 presets (two independent renderers); bench determinism Δ 0 |
| Phase 1 suites | all green on Chrome WebGPU, WebGL2 and Firefox (8 suites, 109 checks); MP4 5 s 1080p30 in 4.2–4.5 s |
| Accessibility | Lighthouse a11y 100 / best practices 100; axe (WCAG 2.1 AA) clean with text selected, every animation tab, styling controls, font picker open |

Also done along the way:
- Glyph atlas is now an array texture of 2048² pages (up to 8, added on demand; only changed pages re-upload).
  When all pages are full it rebuilds once; tested with 45 font instances × full ASCII.
- Thumbnails reuse one small renderer (no shader rebuild per autosave) and are taken between entrances and exits.
- Fixed: the Layers list nested buttons inside listbox options (axe "nested-interactive", from Phase 1).
- Fixed during D: the Animation section re-rendered on every drag move (WebGL2 drag p95 33 ms) — it now subscribes
  to the comp duration only.

Not verified: Safari 26; real (non-headless) GPUs other than the Iris Xe; screen readers.
Known limits: text shadow softness is limited to ~0.2 em (big blurred shadows come with Milestone E effects);
WOFF2 upload not supported; uploaded fonts live with the projects that use them.
