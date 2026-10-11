# Capability Map: Glyphix — Phase 1 (Screenshot editor on the time-aware GPU engine)

Status: **DRAFT — assumptions 1, 2, 4, 8 confirmed by user (2026-10-11); module table awaiting final OK**
Source: `RESEARCH.md` §6 (architecture), §8 (roadmap), §15 (prototype)

> 🧒 **In plain words:** Phase 1 is too big to plan as one blob. It's really 11 smaller "LEGO blocks". This page lists each block, what it does, which other blocks it needs first, and the order we build them in. Once this is approved, each block gets its own short spec (`SPEC-<id>.md`).

## Phase 1 goal (one sentence)

A user pastes a screenshot into Glyphix in the browser, makes it look great (background, padding, shadow, frame, tilt), adds a headline whose letters animate with presets, and exports a PNG or a short MP4/GIF. The preview looks exactly like the export.

## Modules

| Module id | Responsibility | Depends on |
|---|---|---|
| `app-shell` | Vite + React + TS + Tailwind v4 project, layout (toolbar / layers panel / canvas / inspector / mini-timeline), UI components from Wensity UI + Opensource UI, keyboard shortcuts, PWA manifest | — |
| `doc-model` | Document schema (Comp → Layers → Effects). Every property is either a static value or an animated track. Command bus, undo/redo via patches, seeded randomness, and the pure `evaluate(doc, t) → RenderList`. **No renderer or DOM imports.** | — |
| `render-core` | `RenderBackend` interface; three.js `WebGPURenderer` adapter (WebGPU → WebGL2 fallback + "force WebGL2" switch); per-layer texture cache; render on demand; context/device-loss recovery | `doc-model` |
| `assets` | Upload / paste / drag-drop images, off-thread decode (`createImageBitmap`), ½ and ¼ proxies, content-hash blob store, >8192 px guard | `doc-model` |
| `bench` | `/bench` page: frame time p50/p95, backend in use, VRAM estimate, stress scenes (4K + 10 layers, 300/1000 glyphs) | `render-core` |
| `text-engine` | Bundled OFL fonts, shaping (HarfBuzz) → glyph runs, GPU glyph rendering (pmndrs/glyph pilot, troika fallback), per-glyph animation in shaders | `render-core`, `assets` |
| `canvas-editor` | Viewport pan/zoom; selection; DOM/SVG transform handles (move/scale/rotate); snapping guides; crop; layers panel ops (reorder, hide, lock, delete, duplicate); inline text editing | `doc-model`, `render-core` |
| `styling` | Backgrounds (solid, gradient, mesh, image, auto-palette from screenshot); padding, radius, shadow, border; browser/window frames; 3D tilt presets; canvas size presets (16:9, 1:1, 9:16, OG, Twitter) | `doc-model`, `render-core`, `assets` |
| `motion-presets` | 5–10 animation presets for image and text layers (fade, slide, scale, typewriter, per-glyph stagger/wave, Ken Burns, 3D tilt-in); playback, scrub bar, duration, fps, loop | `doc-model`, `text-engine` |
| `persistence` | Autosave to IndexedDB/OPFS, recent projects, `.glyphix` project file (zip: JSON + assets), schema version + migrations | `doc-model`, `assets` |
| `export` | PNG (transparent) / JPEG / WebP at 1–4×; MP4 (H.264) and GIF via a Worker using the same renderer + Mediabunny / gifenc; progress + cancel | `doc-model`, `render-core` |

## Build order

```
Milestone A — "Engine slice" (the RESEARCH.md §15 spike, built as real code, not throwaway)
  app-shell (minimal) + doc-model (minimal) → render-core → text-engine (minimal) → export (MP4 minimal) → bench
  ✔ Gate: per-glyph text animates at 60 fps on an iGPU in WebGPU AND forced WebGL2; exported MP4 frame == preview frame

Milestone B — "It's an editor"
  assets → canvas-editor → styling
  ✔ Gate: paste a 4K screenshot, style it, drag/resize at 60 fps, undo/redo works

Milestone C — "It moves and it saves"
  motion-presets → persistence → export (full: JPEG/WebP/GIF, scales, progress/cancel)
  ✔ Gate: Phase 1 success criteria below

app-shell is fleshed out continuously alongside B and C.
```

Dependency direction is one-way and has no cycles: `doc-model` is the root, `render-core` depends only on it, and the UI-facing modules sit on top.

## Phase 1 success criteria (draft, to be confirmed)

- Paste or drag in a screenshot → styled and visible in < 500 ms (4K source).
- Drag/resize at 60 fps with 10 layers at 4K on a mid-range laptop iGPU (Chrome, Safari 26, Firefox).
- Works in forced-WebGL2 mode with no missing Phase 1 features.
- 300 animated glyphs at 60 fps preview.
- Undo/redo for every edit, < 50 ms per step.
- Reloading the tab restores the last project (autosave).
- PNG export is pixel-identical to the preview at 1×. MP4 export of a 5 s 1080p30 clip finishes in ≤ 5 s and matches the preview frame-for-frame.
- Lighthouse accessibility ≥ 90 for the app chrome. Every tool is reachable by keyboard.

## Explicitly NOT in Phase 1

Keyframe editor / curve editor, custom shader effects (glow etc. beyond the text preset), video import, ASCII, OCR, device-model 3D mockups, desktop app (Tauri), accounts / cloud / sharing links, collaboration, Figma import, WebM-alpha, Lottie.

## Assumptions (✅ = confirmed by user)

1. ✅ **Web app only in Phase 1.** The PWA install is included; Tauri comes in Phase 3.
2. ✅ **No backend, no accounts, no cloud.** Everything runs and saves locally in the browser.
3. **Desktop browsers are the target:** latest Chrome/Edge, Safari 26, Firefox. Mobile must not break, but it isn't optimised.
4. ✅ **The engine slice comes first** (Milestone A), before any editor polish, as RESEARCH.md recommends.
5. **Package manager: pnpm. Tests: Vitest (unit) + Playwright (e2e and pixel-diff).** Hosting the static site on Vercel/Netlify/Cloudflare Pages is decided later.
6. **Fonts are a bundled set of ~10–15 OFL fonts** (Inter, Geist, JetBrains Mono, etc.). User font upload is P1 within Phase 1, if time allows.
7. **Wensity UI is used only after its license is confirmed.** Until then, Opensource UI (MIT) is the default.
8. ✅ **Work is solo plus AI agents.** The estimates in RESEARCH.md assume one full-time developer.
