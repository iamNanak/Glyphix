# Milestone J — "Keyframe everything"

Source: `CAPABILITY-MAP-phase3.md` (module `animate-everything`). Branch: `phase3`. Coordinator builds the doc
layer (types, sampling, migration, key ops, registry) and reviews everything; a Sonnet worker converts the
inspector UI to the new value helpers (reviewed and re-run by the coordinator); Haiku runs the suites.

> 🧒 **In plain words:** today only numbers like position, opacity and effect sliders can have keyframes. After J
> colours (text, glow, background, gradient stops, shadows, borders, effect colours), shadow/border/outline sizes,
> corner radius, gradient angles and even the text itself can change over time — with the same timeline, easing
> editor, copy/paste and undo. Colours blend the way eyes expect (no muddy grey in the middle).

## What exists (verified, survey with file:line in the session notes)

- Numbers already animate as `Prop<number>` in place (opacity, transform, tilt, glow, effect params).
- `evaluate()` builds RenderItems per frame; every target field reaches the GPU as a **uniform set each frame**
  (text colour/gradient/outline/shadow, image shadow/border/radius, background solid/linear/mesh, effect colours) —
  no cache, so animating them costs nothing extra. Text content goes through the layout cache (512 entries,
  already sized for `{frame}` counters that change every frame) and rebuilds glyph geometry only when it changes.
- RenderItem types reuse doc types (`Shadow`, `TextGradient`, `BackgroundFill`, …) directly.
- Raw-doc readers outside evaluate: the inspector (≈35 write sites), `styling/presets.ts` (`fillToCss`, preset
  comparisons via `JSON.stringify`), `bench/scenes.ts`, `editor/Overlay.tsx` + `editor/geometry.ts` (text
  measuring / hit-testing / inline text editing), `EffectsSection.tsx`, `doc/asciiPresets.ts`.

## Gate

- Colour, gradient (angle, stop colours/offsets, mesh points), text content, shadow, border, outline, radius,
  glow colour and effect-colour keys interpolate; colours in OKLab (mid-point of red→blue is not grey-brown);
  text switches at its keys (hold).
- WebGPU = WebGL2 and preview = export at several times across animated segments.
- v1–v8 projects migrate and render byte-identically (fixture docs rendered before/after).
- Every new property appears in the timeline (rows, keys, easing editor, copy/paste, J/K) and the inspector can
  add/remove a key at the playhead; editing an animated value updates the key at the playhead (one undo step).
- axe clean; unit + all suites green on Chrome WebGPU, WebGL2, Firefox.

## Design decisions (recommendations; the user asked to build straight after planning)

1. **`Prop<V>` in place, like numbers today (schema v9).** Leaf fields become `Prop<Color>` / `Prop<number>` /
   `Prop<string>`; the migration wraps the old values as `{ static: v }`. One place per value, the same pattern
   the code already uses. (Rejected: a separate "animation overlay" map per layer — less churn, but two sources of
   truth for every value.)
2. **On/off stays structural.** `shadow`, `border`, `outline`, `gradient` stay `… | null` (turning one off is not
   animatable); their inside values animate. Fill *kind* (solid/linear/mesh/image) and frame *kind* are not
   animatable (they are choices, not values); the number of gradient stops / mesh points is fixed per kind.
3. **One resolver:** `Resolved<T>` (type) and `resolveProps(value, t)` (runtime) turn any doc structure with Props
   into plain values. RenderItems use `Resolved<Shadow>` etc., so the renderer code does not change.
4. **Sampling by value type:** numbers as today; colours in **OKLab** (sRGB → linear → OKLab, eased, back; alpha
   linear; channels clamped so overshooting curves stay valid); strings **hold** (the text switches exactly at the
   next key, whatever the easing).
5. **Key operations become generic** (`moveKeys`, `deleteKeys`, `putKey`, copy/paste, `setKeyEasing` over any V);
   the animatable registry gains the new properties with a value kind (`number | color | text`) so the timeline,
   "+" button and paste work unchanged. Paste only goes onto the same property id (as today).
6. **Editing an animated value** (inspector colour picker, slider, text box, canvas text editing) writes a key at
   the playhead; a static value stays static. Helpers `valueAt(prop, t)` / `editAt(prop, v, t, fps)`. A small key
   button next to each animatable control adds/removes the key at the playhead (same as effect params today).
7. **Text content keys:** the canvas shows the text at the playhead; editing on the canvas edits that key. Glyph
   enter/exit timing uses the text at the layer's in point (documented limit).

## Tasks

- **J1 — doc:** types + `Resolved<T>`, `resolveProps`, OKLab colour lerp, string hold, schema v9 migration
  (+ fixture test v1…v8 byte-identical), generic key ops, registry entries, evaluate uses resolved values.
  Unit tests.
- **J2 — UI:** inspector controls use `valueAt`/`editAt` and get key buttons; presets/swatches compare resolved
  values; Overlay/geometry measure sampled text; bench scenes updated.
- **J3 — timeline:** new rows/labels (grouped: Text, Shadow, Border, Outline, Gradient, Fill, effect colours);
  colour keys copy/paste; easing editor works on them (it already works on any key).
- **J4 — checks + status:** `scripts/e2e-animate.mjs` (OKLab mid-point, text hold switch, every property animates
  in preview = export and WebGPU ≈ WebGL2, inspector key buttons, editing an animated colour writes a key, one
  undo step), migration fixtures, axe state, all suites on 3 browsers, status section.

## Not in J

Animating on/off of shadow/border/outline/gradient, fill kind or frame kind, number of gradient stops, fonts,
font size / weight / line height / tracking (layout changes; revisit if wanted), motion-preset parameters.

## Risks

- Inspector churn (≈35 write sites): the worker must keep every control's behaviour for static values identical.
- Text keys + per-glyph animators: unit counts change when the text changes mid-animation; tested at the switch.
- Old projects must stay byte-identical: OKLab only applies *between* keys, static colours pass through untouched.
