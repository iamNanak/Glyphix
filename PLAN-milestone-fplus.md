# Milestone F+ — "ASCII Studio"

Source: `CAPABILITY-MAP-phase2.md` (modules `ascii-glyphs`, `ascii-text`, `ascii-studio-ux`), `RESEARCH.md` §11.
Branch: `milestone-fplus` (from `main` at 9820b63). Built by a coordinator plus three worker agents, each in its
own git worktree; the coordinator owns the shared interfaces and merges.

> 🧒 **In plain words:** drop in a video or GIF, click once, and it becomes ASCII art in any font and with any
> characters. Export it as a video, or as real text (copy, file, a web-page player, a React component) that
> matches the picture character for character.

## Gate

- Text export equals the rendered ASCII cell for cell (glyph and colour) on every frame of a test video.
- Custom charset + any bundled or uploaded font render identically on WebGPU, WebGL2 and in export.
- 160×90 ASCII on 1080p video still 60 fps p50 in the bench.
- The HTML player plays the exported sequence in time with the comp (drift < 1 frame over 10 s), with sound
  when that option is on.
- Animated GIF input is frame-exact (frame-number GIF fixture reads back exactly) on all three browsers.
- Old projects (schema 5) open with the exact same ASCII look.
- Earlier gates stay green on Chrome WebGPU, WebGL2 and Firefox; axe clean; every new control keyboard-reachable.

## Design decisions

1. **Glyphs from any font at runtime.** The embedded JetBrains Mono outlines (`asciiGlyphs.ts`) stay as the
   built-in default. For another font, harfbuzz (`glyphToPath`, already a dependency and already how
   `scripts/gen-ascii-glyphs.mjs` works) gives the outlines and the existing JS rasteriser in `asciiAtlas.ts`
   draws them, so atlases stay byte-identical across browsers and GPU backends. Atlases are cached by
   `(font, weight, charset)`.
2. **Fonts load before drawing.** Loading a font is async, so the ASCII atlas joins the renderer's existing
   `prepare(list)` step (like video frames): preview, thumbnails and export never draw a frame with the wrong
   font. Missing font → built-in font, with a note in the inspector.
3. **Effects can hold text** (schema v6): `Effect.text: Record<string, string>` for `charset` (custom string)
   and `fontId`. New numeric params: `weight`, `lineHeight`, `spacing` (letter spacing), `columns` (0 = use cell
   size), `threshold` (density cut-off). Migration 5 → 6 sets values that keep today's square cells and
   stretched glyphs exactly.
4. **Non-square cells.** Cell height = `size`; cell width = font advance × (1 + spacing) / line height, unless
   the "square" legacy mode is set by the migration. Non-monospace fonts: each glyph centred in its cell.
5. **Text comes from the GPU, not a CPU re-calculation.** Pass 1 already writes each cell's glyph index and ink
   colour into a small cell texture. Text export renders each frame like the video export (full comp, scale 1)
   and reads that texture back for one chosen ASCII effect, so text and picture cannot disagree. The text holds
   that effect's grid only (other layers on top are not text).
6. **Text outputs:** copy current frame; `.txt` / JSON frame sequence zip (fflate); a self-contained HTML player
   (frames compressed, decompressed with `DecompressionStream`, drawn with the effect's font embedded via
   `@font-face`); a React component (`.tsx` + data file). Sound: an option, off by default, embeds the comp's
   audio mix (Opus, same mix as the video export). The dialog shows the estimated size before saving.
7. **GIF input with our own decoder** (pure JS LZW, no dependency): works in every browser, Safari and the
   future Mac (Tauri) app included, and is deterministic. A GIF becomes an image layer with a `VideoClip`
   (trim, loop) and a frame provider behind the existing `VideoFrameProvider` interface. No sound.
8. **Studio UX:** "Video → ASCII" (fit canvas size and length to the clip, add ASCII with a preset), look
   presets (Terminal, Matrix, Newsprint, Blocks, Colour…), optional frame counter ("Frame 001 / 125").
9. **C8 (export in a Worker) stays deferred.**

## Tasks and owners

| # | Task | Owner | Done when |
|---|---|---|---|
| F+1 | Schema v6 + migration, `Effect.text`, new ASCII params, atlas `prepare()` hook, cell-texture readback hook in the backend, fixtures (frame-number GIF) | coordinator | unit tests (migration keeps old look); typecheck |
| F+2 | `ascii-glyphs`: runtime atlas from any font/weight, custom charset, line height, letter spacing, columns/auto-fit, threshold, inspector controls | agent A | WebGPU = WebGL2, preview = export for 3 fonts × custom charset; old-project pixels unchanged |
| F+3 | `ascii-text`: readback, copy frame, TXT/JSON zip, HTML player, React component, sound option, export dialog | agent B | text equals rendered cells every frame; HTML player in sync; outputs open in a fresh browser |
| F+4 | `ascii-studio-ux`: GIF decoder + provider, Video → ASCII, presets, frame counter | agent C | GIF frame-exact on all browsers; one-click flow e2e |
| F+5 | Integration, `e2e-ascii-studio`, bench, axe, full runs on three browsers; status below | coordinator | all suites green; status filled in |

## Risks

- Non-monospace fonts look uneven in a fixed grid (centred per cell; documented).
- Long colour clips make big HTML players (tens of MB); size shown before saving.
- Reading back the cell texture every frame adds a GPU→CPU wait; text export may run slower than video export.
- Safari and real GPUs remain unverified (as in F).

## Status (2026-10-18)

F+1–F+5 done. Coordinator built F+1 and F+2 (fonts/charsets) and integrated; two Sonnet worker agents built
F+3 (text export) and F+4 (GIF, presets, Video → ASCII, frame counter) in separate worktrees. Headless, Intel
Iris Xe; Chrome WebGPU, Chrome forced WebGL2 (`?webgl`), Playwright Firefox.

| Gate | Result |
|---|---|
| Text = rendered cells | text export = GPU readback (text + colour) on frames 0, 7, 31, 100, 217 of the demo (mono and colour, WebGPU and WebGL2); text vs drawn picture per-cell ink correlation ≥ 0.9915 (colour) / 1.0000 (mono). WebGPU vs WebGL2 text: 99.99 % of cells equal (1 of 14 400 differs at a brightness boundary) |
| Any font + custom charset | built-in, Geist Mono, Fraunces × custom charset: WebGPU ≈ WebGL2 (mean Δ ≤ 0.002); first frame on a fresh backend already in the right font (Δ 0); old projects: atlases byte-identical, square cells kept |
| Speed | bench "1080p + ASCII 320×90" (default font-shaped cells, 2× the gate's cells) and "1080p video + ASCII": 60 fps p50 on WebGPU and WebGL2; ASCII passes 1.0–1.4 ms (160×90, e2e-ascii); determinism Δ 0 |
| HTML player | plays at 30.3 fps, drift 0.6 frames over 3 s (Chrome); with sound, frames follow the audio clock (±1 frame); React component type-checks and plays |
| GIF input | frame-exact in provider, preview and exported still; trim/loop; reload and `.glyphix` round-trip (e2e-gif, all three browsers) |
| Earlier gates | all 16 e2e suites green on Chrome WebGPU, WebGL2 and Firefox; axe clean incl. the ASCII card and ASCII export dialog |

Sizes, 10 s 30 fps 160×90: HTML player 0.32 MB mono / 3.4 MB colour; JSON 4.4 / 30 MB; TXT zip 0.33 MB.
Text capture ≈ 25 ms/frame (Chrome), ≈ 100 ms/frame (Firefox).

Not verified / limits:
- Text equality was checked on 5 sampled frames of the demo doc, not every frame of a test video.
- Player drift measured over 3 s, not 10 s; headless Firefox drifted up to 2 frames in a worker run (passed in the final run).
- The size estimate is 2–4× high for HTML/React on the demo (it compresses unusually well); untested on real footage.
- Player sound tested with a synthetic tone, not a real video's mix. Safari and real GPUs not checked.
- Animating the cell size during a text export fits every frame to the first frame's grid (the dialog says so).
- Non-monospace fonts look uneven in the fixed grid (each glyph centred in its cell).
- C8 (export in a Worker) still deferred.
