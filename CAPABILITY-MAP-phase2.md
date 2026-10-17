# Capability Map: Glyphix — Phase 2 (Typography, GPU effects, ASCII)

Status: **In progress — Milestone D done (`PLAN-milestone-d.md`), Milestone E done 2026-10-13 (`PLAN-milestone-e.md`), Milestone F done 2026-10-14 (`PLAN-milestone-f.md`); next: ASCII Studio (priority), then G (optional).** Built milestone by milestone, like Phase 1.
Source: `RESEARCH.md` §4 (GPU typography and effects), §8.2 (Phase 2), §11 (video → ASCII); the Phase 1 code.

> 🧒 **In plain words:** Phase 1 made Glyphix a good screenshot editor that can move things. Phase 2 makes it
> *special*: lots of fonts, letters that fly in 20+ different ways, shader effects (glow, glitch, blur…), and
> video turned into moving ASCII art. These are the features no free screenshot tool has.

## Phase 2 goal (one sentence)

A user picks from a dozen good fonts (or uploads their own), animates a headline letter by letter, word by word or
line by line with 20+ kinetic presets, adds GPU effects (glow, blur, glitch, RGB split, noise, gradient map…) to any
layer or to everything below an adjustment layer, drops in a video and turns it into ASCII art, and exports
MP4 (with audio), WebM with transparency, GIF or PNG. The preview still looks exactly like the export.

## Modules

| Module id | Responsibility | Depends on |
|---|---|---|
| `font-manager` | Bundled OFL font set (~15 families, variable weights), font upload (TTF/OTF/WOFF) stored as project assets, font picker with live previews, atlas that grows and evicts | `text-engine`, `persistence` |
| `text-styling` | Weight, line height, outline, text shadow, gradient fill — all from the SDF in the glyph shader | `font-manager` |
| `glyph-animators` | Animator v2: unit (glyph / word / line), order (forward, reverse, center, edges, random), stagger falloff, 3D flip, skew, blur, spread, colour, scramble; enter **and** exit animators; per-glyph emphasis loops | `text-engine`, `motion-presets` |
| `kinetic-presets` | 20+ text presets (enter / exit / emphasis) built on animator v2, hover-to-preview, "advanced" overrides | `glyph-animators` |
| `compositor` | Layers that need it render into their own GPU texture, then composite; adjustment layers process everything below them. Replaces the single-scene draw while keeping preview = export | `render-core` |
| `effects` | Effect stack per layer: blur, glow, noise/grain, displacement, glitch, RGB split, gradient map, dissolve, pixelate, vignette, colour adjust; keyframable params; every effect in WebGPU *and* WebGL2 | `compositor`, `doc-model` |
| `video-layer` | Video import, preview via `<video>` + `requestVideoFrameCallback`, frame-exact export via Mediabunny decode, audio passthrough into MP4 | `assets`, `export`, `compositor` |
| `ascii` | ASCII effect (two-pass: cell analysis → glyph raster), calibrated brightness LUT from the real font, charsets, colour modes, edge glyphs, keyframable params; works on any layer or adjustment layer | `effects`, `font-manager` |
| `export-v2` | WebM VP9 with alpha, MP4 with audio, PNG sequence (zip); effects and video are frame-exact | `export`, `video-layer` |
| `ascii-text` | Read back the exact characters the GPU chose (cell glyph + colour per frame); copy a frame as text, export a .txt/JSON frame sequence (zip), a self-contained HTML player and a React component | `ascii`, `export-v2` |
| `ascii-glyphs` | Custom character order, any bundled/uploaded font for ASCII (glyph set built at runtime), non-square cells (line height, letter spacing), columns × rows / auto-fit, density threshold | `ascii`, `font-manager` |
| `ascii-studio-ux` | One-click "Video → ASCII" (fit canvas, add effect), ASCII look presets, animated GIF input, optional frame counter | `ascii`, `video-layer` |
| `redact` *(optional)* | Redact layer (blur / pixelate / solid box) + OCR auto-detect of text regions in a Worker | `effects`, `assets` |

## Build order

```
Milestone D — "Type that moves"
  font-manager → text-styling → glyph-animators → kinetic-presets
  ✔ Gate: 15 font families + upload; 20+ kinetic presets; 300 glyphs with enter + exit + emphasis at 60 fps
          (WebGPU and WebGL2); preview = export mid-animation for every preset

Milestone E — "Effects"
  compositor → effects (+ adjustment layers)
  ✔ Gate: 10+ effects, WebGPU vs WebGL2 pixel diff within tolerance; 4K layer with 3 effects ≥ 30 fps preview;
          Phase 1 gates still green (drag 60 fps, preview = export)

Milestone F — "Video and ASCII"
  video-layer → ascii → export-v2
  ✔ Gate: 1080p30 video plays in sync; ASCII 160×90 on 1080p at 60 fps preview (effect < 2 ms);
          MP4 with audio and WebM-alpha export frame-exact

Milestone F+ — "ASCII Studio"  (PRIORITY: next, before G)
  ascii-glyphs → ascii-text → ascii-studio-ux
  ✔ Gate: text export equals the rendered ASCII cell for cell (every frame of a test video); custom
          charset + any font render identically on WebGPU / WebGL2 and in export; 160×90 ASCII video still
          60 fps; HTML player plays the exported sequence in sync; GIF input frame-exact; keyboard + axe clean

Milestone G (optional) — "Redact"
  redact (manual first, then OCR auto-detect)
```

Dependency direction stays one-way: `doc-model` is still the root and stays free of renderer/DOM imports.

## Phase 2 success criteria (draft)

- 15 bundled font families with weights; uploaded fonts survive reload and `.glyphix` round-trip.
- 20+ kinetic text presets (enter, exit, emphasis), all computed on the GPU; 300 glyphs with enter + exit +
  emphasis at 60 fps on the Iris Xe laptop iGPU, in WebGPU and forced WebGL2.
- 10+ effects; each matches between WebGPU and WebGL2 (mean Δ < 1/255); effect params animate.
- Video layer + ASCII effect: 160×90 grid on 1080p video at 60 fps preview.
- Export: MP4 with audio, WebM VP9 with alpha, GIF, PNG; preview = export (max Δ ≤ 2/255 where effects use
  noise/derivatives, 0 elsewhere).
- Every new control is keyboard-reachable; Lighthouse accessibility stays 100.

## Explicitly NOT in Phase 2

Keyframe / curve editor UI (Phase 3), OCR text *replacement*, desktop app, system fonts, per-glyph variable-axis
animation, ProRes, Lottie, collaboration.

## Assumptions (to confirm)

1. **Fonts are downloaded from the google/fonts repo (OFL) and bundled in `public/fonts`**, loaded lazily on first
   use. No Google Fonts API calls at runtime (offline/PWA, privacy).
2. **WOFF2 upload is not supported in D** (needs Brotli + glyf transforms). TTF, OTF and WOFF are.
3. **Text shadow in D is the soft SDF shadow** (small blur). Big blurred shadows come from the effects in E.
4. **Scramble/decode uses a fixed alternate charset** (A–Z, 0–9, symbols) from the same font.
5. **OCR redact is optional (Milestone G)**, like C8 was in Phase 1.
6. **C8 (export in a Worker) stays deferred.** It becomes more valuable in F (video makes exports heavier), so it
   is revisited there.
