# Milestone H — "Timeline"

Source: `CAPABILITY-MAP-phase3.md` (modules `layer-timing`, `timeline-panel`, `keyframe-editing`).
Branch: `phase3`. Built mostly by the coordinator (the UI must feel coherent); a Sonnet worker may write the
e2e/bench checks.

> 🧒 **In plain words:** today you can only scrub a slider. After H there is a real timeline: every layer has a
> bar showing when it is on screen, its animation presets show as smaller bars, and opening a layer shows its
> keyframes as diamonds you can drag, copy, delete and nudge — all undoable and keyboard-friendly.

## Gate

- 50 layers × ~10 animated properties (hundreds of keys): dragging keys/bars and scrubbing stay at 60 fps;
  playback fps with the timeline open is within 5 % of collapsed (no timeline re-render per frame).
- Each drag (key, bar, trim, box selection move) is one undo step.
- In/out points: a layer is invisible outside [in, out); enter/exit presets follow the layer's in/out; preview =
  export (still + MP4) around the cut points.
- Old (v6) projects open unchanged (every layer in = 0, out = end), byte-identical renders.
- Every timeline action is keyboard-reachable; axe clean; Chrome WebGPU, WebGL2 and Firefox suites green.

## Design decisions

1. **Layer timing (schema v7):** `LayerBase.timing: { in: number; out: number | null }`, seconds on the comp
   timeline; `out: null` = until the comp ends (so changing the length keeps "to the end" layers to the end).
   Backgrounds ignore it. `evaluate` skips a layer when `t < in || t >= out`.
2. **Presets follow the layer:** enter `start` is measured from the layer's in point, exit `endOffset` from its
   out point (today: from comp start / comp end — identical for in = 0, out = end, so no value migration).
   Loops and video clips stay on the comp clock.
3. **Moving a layer in time** (dragging its bar) shifts `timing` and every keyframe of that layer (opacity,
   transform, tilt, glow, effect params) and the video clip's `start`, as one patch set. Trimming (dragging a bar
   edge) changes only `in` / `out`.
4. **One registry of animatable properties** (`src/doc/animatable.ts`): `animatableProps(layer)` → `{ id, label,
   group, path }[]` (opacity, position X/Y, scale, rotation, tilt X/Y, text glow, every effect param). The
   timeline, keyframe ops and (later) presets/Lottie all use it, so adding a keyframable property is one entry.
5. **Pure keyframe operations** (`src/doc/keyframes.ts`): move keys by Δt with frame snapping and collision
   handling (a moved key replaces one at the same frame), delete, copy → clipboard shape `{ propId, dt, v, out }[]`
   relative to the earliest key, paste at a time, nudge. Unit-tested; the UI only builds patches from them.
6. **Timeline panel** (`src/app/timeline/`): replaces the footer slider. Resizable bottom dock (drag handle;
   height remembered per browser; collapse back to the compact transport bar).
   - Header: play/pause, timecode + frame, length, loop, zoom (slider, Ctrl+wheel, "fit").
   - Left column: layer names (same top-to-bottom order as the Layers panel), expand chevron, eye/lock.
   - Track area: ruler (adaptive ticks; click/drag scrubs), layer bar (in → out), enter/exit preset bars inside
     it (drag edges = duration, drag enter bar = start), loop shown as a striped strip, summary diamonds on the
     layer row; expanded: one row per animatable property — animated ones with their keys, static ones dimmed
     with an "add key at playhead" button.
   - Playhead line drawn by a store subscription that moves it with a CSS transform — the panel does not
     re-render while playing.
7. **Gestures:** click key = select (Shift = toggle, Ctrl/Cmd+A = all in the layer); drag selected keys (snap to
   frames always; also to the playhead, other keys and in/out within 6 px; Alt disables extra snaps); drag in an
   empty row area = box select; Delete/Backspace removes; Ctrl+C / Ctrl+V copies and pastes at the playhead (onto
   the same properties of the selected layer); ←/→ nudge 1 frame (Shift: 10); J / K jump to the previous / next
   key; Alt+[ / Alt+] trim the selected layer's in / out to the playhead; double-click a key = move the playhead
   there. Pointer-down → `beginGesture`, pointer-up → `endGesture` (one undo step).
8. **Accessibility:** the track area is a labelled region; layer rows and property rows are labelled groups;
   each key is a focusable button ("Opacity keyframe at 1.20 s, selected"); all gestures have keyboard
   equivalents (7); focus is never trapped; the transport keeps its existing labels.

## Tasks

| # | Task | Done when |
|---|---|---|
| H1 | Schema v7 `timing` + migration, evaluate skip, presets relative to in/out, `animatable.ts`, `keyframes.ts`, `moveLayerInTime` | unit tests; old docs render identically |
| H2 | Timeline panel shell: dock, resize/collapse, header transport, ruler + zoom/scroll, name column, playhead without re-render | renders, scrubs; playback fps unaffected |
| H3 | Layer bars: move (shifts keys), trim in/out, preset bars (enter/exit start/duration), loop strip | e2e: one undo per drag; preview = export at cut points |
| H4 | Property rows + keyframes: select, drag with snapping, box select, delete, copy/paste, nudge, J/K, add key | e2e by mouse and keyboard |
| H5 | Stress bench (50 layers × 10 props), axe states, full suites on three browsers; status below | gate met |

## Risks

- Re-render storms while dragging (doc changes every pointermove): memoise rows per layer; only the dragged
  layer's rows re-render.
- Dense keys at small zoom: hit-testing picks the nearest key; summary diamonds merge keys closer than 3 px.
- Text glyph animations run on the GPU from `enter.start`: shifting presets to the in point must stay
  preview = export (covered by the e2e at cut points).

## Status

Planned 2026-10-18.
