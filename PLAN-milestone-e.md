# Milestone E — "Effects"

Source: `CAPABILITY-MAP-phase2.md` (modules `compositor`, `effects`).
Branch: `milestone-e` (from `milestone-d`).

## Gate

- 10+ effects, usable on any layer and on adjustment layers.
- Every effect matches between WebGPU and forced WebGL2 (mean Δ < 1/255 per channel).
- Effect parameters animate (keyframes at the playhead).
- A 4K image layer with 3 effects previews at ≥ 30 fps.
- Preview = export with effects (max Δ ≤ 2/255).
- Phase 1 + D gates stay green: drag at 60 fps, preview = export, all e2e suites on Chrome WebGPU, WebGL2 and Firefox.
- Every new control is keyboard-reachable; axe stays clean.

## Design decisions

1. **Effects live on every layer** as `effects: Effect[]`. An effect is `{id, kind, enabled, params, colors}`.
   `params` are `Prop<number>`, so they can be keyframed. `colors` are static. A registry in `src/doc/effects.ts`
   lists each kind's parameters (label, range, default, unit), so the UI and the defaults come from one place.
2. **Adjustment layer** = new layer type `adjustment` with no transform: its effects process everything below
   it, and its opacity mixes the result with the unprocessed image.
3. **Fast path stays as-is.** If no visible layer has an enabled effect and there is no adjustment layer, the
   frame is drawn exactly as in Phase 1 (one scene draw). Phase 1 numbers and pixels cannot regress.
4. **Compositor path.** Layers are drawn into an MSAA half-float "accumulation" target in screen (drawing
   buffer) space. A run of plain layers is one draw. A layer with effects is drawn alone into its own target,
   its effects run as full-screen passes (ping-pong targets), and the result is blended onto the accumulation
   target (premultiplied alpha). An adjustment layer runs its effects on the accumulation target and mixes the
   result back by its opacity. A final pass writes the accumulation target to the canvas (artboard scissor in
   preview, as before).
5. **Screen-space targets, comp-space parameters.** Targets are the size of the drawing buffer, so the cost is
   bounded by the screen, not by layer size (a 4K layer in preview costs the same as a 1080p one). Parameters
   are in comp px and are converted with px-per-comp-px, so preview and export match at any zoom.
6. **Blur is one helper used by blur, glow and shadow**: downsample by 2× steps until σ ≤ 4 px, then a separable
   Gaussian; bilinear upsample happens when the next pass samples it. Cost stays flat for large radii.
7. **Time-based effects (grain, glitch, displacement, dissolve) use comp time**, so they are deterministic.
8. **Schema v4**: every layer gains `effects: []`.

## Effects (12)

Blur · Glow · Drop shadow · Grain · Displace · Glitch · RGB split · Gradient map · Dissolve · Pixelate ·
Vignette · Colour adjust (brightness, contrast, saturation, hue)

## Tasks (in order; each ends green: typecheck, unit tests, e2e)

| # | Task | Done when |
|---|---|---|
| E1 | Doc: effect registry, adjustment layer, schema v4 + migration, evaluate resolves effect params | unit tests (defaults, keyframed params, migration) |
| E2 | Compositor: render-target pool, layer isolation, adjustment layers, fast path kept | preview = export; no-effect scenes pixel-identical to before |
| E3 | The 12 effects in TSL (WebGPU + WebGL2) | each effect changes the image; WebGPU vs WebGL2 mean Δ < 1/255 |
| E4 | UI: Effects section (add menu, reorder, enable, remove, params, colours), keyframe toggles, "Add adjustment layer" | e2e-effects; keyboard reachable; axe clean |
| E5 | Bench (4K layer + 3 effects), full suite run on all three browsers, status report | numbers in the Status section below |

## Status (2026-10-13)

E1–E5 done. Gate results (headless, Intel Iris Xe; Chrome WebGPU, Chrome forced WebGL2, Playwright Firefox):

| Gate | Result |
|---|---|
| 10+ effects | 12: blur, glow, drop shadow, grain, displace, glitch, RGB split, gradient map, dissolve, pixelate, vignette, colour adjust — on any layer, the background, or an adjustment layer |
| WebGPU vs WebGL2 | every effect mean Δ 0.005/255 per channel (max 38 on a few edge pixels, same as with no effects) |
| Preview = export | max Δ 0 for every effect (two independent renderers); bench determinism Δ 0 |
| Effect params animate | keyframe button per parameter (add/remove at playhead; slider edits set the key at the playhead); e2e checks blur radius 0 → 40 animates |
| 4K layer + 3 effects | 60 fps, p95 16.8 ms on WebGPU and WebGL2 (bench scene "4K layer + 3 effects": glow + animated displace + animated grain) |
| Phase 1 + D gates | all 9 e2e suites green on Chrome WebGPU, WebGL2 and Firefox; drag 4K layer p95 16.7–17.3 ms; all bench scenes 60 fps; MP4 5 s 1080p30 4.6 s (5.6 s with 4 effects + adjustment layer) |
| Accessibility | Lighthouse a11y 100 / best practices 100; axe clean with the effect menu open, effect cards (keyframed, toggles, colours) and an adjustment layer selected; effect menu works by keyboard (arrows, Home/End, Enter) |

Also checked: transparent PNG export with glow/shadow/grain/displace + an adjustment layer composites cleanly
(glow alpha now covers its added light; it showed as a hard-edged white blob before the fix). PWA still loads offline.

Not verified: Safari 26; GPUs other than the Iris Xe; screen readers; the preview canvas in headless Firefox
(it reads back blank in headless Firefox; Firefox offscreen renders are checked instead).
Known limits: effect sizes are in comp px and don't scale with the layer's own scale; blur/glow/shadow near the
edge of the visible preview area clamp at the screen edge when zoomed in (export is unaffected); no blend modes yet.
