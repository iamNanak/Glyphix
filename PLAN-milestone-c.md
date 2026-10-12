# Milestone C — "It moves and it saves"

Source: `CAPABILITY-MAP.md` (modules `motion-presets`, `persistence`, `export`), plus the Phase 1 finishing work.
Branch: `milestone-c` (stacked on `milestone-b`).

## Gate (Phase 1 success criteria that C must satisfy)

- Every layer can get an entrance animation from a preset; text and images each have 5+ presets; preview = export.
- Reloading the tab restores the last project. `.glyphix` files round-trip (save → open gives an identical doc and assets).
- Export: PNG (transparent) / JPEG / WebP at 1–4×, MP4, GIF, with progress and cancel. 5 s 1080p30 MP4 ≤ 5 s.
- Every tool reachable by keyboard; Lighthouse accessibility ≥ 90; app installable (PWA manifest).

## Design decisions

1. **Presets are data, not baked keyframes.** A layer gets `motion: { enter?, loop? }`. The pure evaluator expands a
   preset into *modifiers* applied on top of the layer's own props (opacity ×, offset +, scale ×, rotation +, tilt +).
   So moving a layer never fights its animation, and changing a preset's duration is one field.
   Existing keyframe tracks keep working (the demo uses them).
2. **Text presets compile to the GPU glyph animator** (already built) — fade, rise, pop, typewriter, cascade —
   plus a new continuous **wave** loop computed in the glyph shader from `(rank, t)`.
3. **Persistence:** IndexedDB, two stores: `projects` (doc JSON, name, timestamps, thumbnail) and `assets`
   (blob by asset id). Autosave debounced ~800 ms after the last change. `schemaVersion` + an ordered list of
   migrations runs on every load (IndexedDB and file).
4. **`.glyphix` file = zip** (`fflate`): `project.json` + `assets/<id>.<ext>`. Canvas-only assets (the procedural
   demo screenshot) are encoded to PNG when saving.
5. **Export dialog** (Wensity Dialog): format, scale, (video) fps/duration from the comp, quality; progress + cancel.
   GIF via `gifenc` (palette per frame sampled globally from a few frames, so colours don't flicker).
6. **Worker export is last and optional.** MP4 export already meets its gate on the main thread (4.92 s for
   5 s 1080p30) and awaits the encoder between frames, so the UI stays responsive. Moving rendering into a
   Worker needs worker-side fonts, assets and frame bars; attempt it only after everything above is done.

## Tasks (in order; each ends green: typecheck, unit tests, e2e)

| # | Task | Done when |
|---|---|---|
| C1 | `motion` in the doc model + evaluator modifiers + unit tests | image presets animate in preview; tests cover each preset's start/end values |
| C2 | Text presets via glyph animator; `wave` loop in the glyph shader | 5+ text presets; wave loops seamlessly |
| C3 | Inspector "Animation" section (preset grid, start, duration, easing) + timeline controls (duration, fps, loop) | e2e: apply preset, scrub, values match evaluator |
| C4 | Persistence: IndexedDB store, autosave, restore on load, migrations framework | e2e: edit → reload → same doc + images |
| C5 | Recent projects + New / Open / Save `.glyphix` (zip) | round-trip test is byte-for-byte equal on doc JSON |
| C6 | Export dialog: PNG/JPEG/WebP 1–4×, MP4, GIF, progress, cancel | e2e exports every format; pixels checked; cancel works |
| C7 | Finishing: PWA manifest + icons, keyboard pass, Lighthouse a11y ≥ 90, success-criteria run | report of every Phase 1 criterion with numbers |
| C8 | (optional) Export in a Worker with OffscreenCanvas | same output as main-thread export (pixel diff) |

## Status (2026-10-12)

C1–C7 done; C8 (Worker export) not started — optional, since MP4 export already meets its gate on the main thread.

Phase 1 success criteria, measured headless on an Intel Iris Xe laptop GPU (Chrome 145+, Vulkan flags; Firefox via Playwright):

| Criterion | Result |
|---|---|
| Paste a 4K screenshot → styled and visible < 500 ms | 350–440 ms (decode + ½/¼ proxies + first frame) |
| Drag at 60 fps; 10 layers at 4K | drag p95 16.7 ms; 4K × 10 layers p95 16.7 ms (WebGPU and WebGL2) |
| Forced WebGL2 has every Phase 1 feature | all e2e suites pass on WebGL2 paths; Firefox suites pass |
| 300 animated glyphs at 60 fps | p95 16.8 ms (1000 glyphs too) |
| Undo/redo for every edit, < 50 ms per step | 0.1–7 ms per step |
| Reload restores the last project | e2e-persistence (identical doc + images) |
| PNG export pixel-identical to preview | max Δ 0, checked mid-animation |
| 5 s 1080p30 MP4 in ≤ 5 s, frame-for-frame | 4.6 s in Chrome; Firefox 13–16 s (software H.264 encoder) |
| Lighthouse accessibility ≥ 90; every tool keyboard-reachable | accessibility 100, best practices 100; e2e-keyboard 13/13 (Chrome + Firefox) |
| Installable PWA | manifest + icons + service worker; loads offline |

Not verified: Safari 26 (no macOS here); real (non-headless) Firefox preview canvas; Lighthouse/keyboard on a screen reader.
