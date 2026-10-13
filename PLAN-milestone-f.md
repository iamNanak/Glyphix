# Milestone F — "Video and ASCII"

Source: `CAPABILITY-MAP-phase2.md` (modules `video-layer`, `ascii`, `export-v2`).
Branch: `milestone-f` (from `milestone-e`). Built by a coordinator plus three worker agents, each in its own
git worktree; the coordinator owns the shared interfaces and merges.

## Gate

- Import MP4 / WebM / MOV (H.264, VP9, AV1, HEVC where the browser decodes it) as a layer; it survives reload and
  the `.glyphix` round-trip.
- 1080p30 video plays in sync with the timeline (drift < 1 frame) and with its audio in the preview.
- Paused / scrubbed / exported frames are frame-exact (the frame-number strip of the test clip reads back exactly).
- ASCII effect: 160×90 cells on a 1080p video at 60 fps preview; the effect pass costs < 2 ms.
- Export: MP4 with audio (mixed from every audible video layer), WebM VP9 with alpha, PNG sequence (zip);
  frame-exact; GIF and stills still work.
- Phase 1, D and E gates stay green on Chrome WebGPU, WebGL2 and Firefox; axe clean; keyboard reachable.

## Design decisions

1. **A video is an image layer with a clip.** `ImageLayer.video: VideoClip | null` with `start, in, out, loop,
   volume, muted`; `assetId` is then a video asset (`vid-<sha20>`). Every image feature (crop, radius, shadow,
   frame, tilt, motion, effects) works on video for free. Outside the clip the first/last frame holds.
2. **Pure timing in the doc** (`src/doc/video.ts`): `videoSourceTime(clip, t)` and `audioSegments(doc)`.
   The render list carries `item.video.time` (source seconds).
3. **Frames come from a `VideoFrameProvider`** (`src/video/provider.ts`). The renderer asks synchronously
   (`frame(layerId, assetId, time)`); callers `await backend.prepare(list)` before `render(list)`.
   - Exact provider (export, thumbnails, tests, and the paused preview): Mediabunny `VideoSampleSink`, one
     sequential decode session per layer (forward requests reuse it; seeking backwards restarts it).
   - Live provider (the playing preview): one `<video>` per video layer, kept in sync with the timeline clock
     (small drift → playbackRate nudge, large drift → seek), frames captured with `requestVideoFrameCallback`;
     audio plays from the element.
   Without a frame yet, the layer shows the asset's poster (stored like an image asset, so thumbnails work).
4. **Video assets** keep the original file as the asset blob (IndexedDB + `.glyphix`), plus metadata and a poster.
5. **ASCII is an effect** (`kind: 'ascii'`) in the E compositor: pass 1 reduces each cell to average colour +
   luminance (+ edge direction), pass 2 draws a glyph from a charset atlas chosen by a brightness LUT measured
   from the real font's coverage. Works on any layer or adjustment layer.
6. **Export v2**: audio is decoded per segment, mixed (OfflineAudioContext), encoded (AAC in MP4, Opus in
   WebM); WebM VP9 keeps alpha (background hidden); PNG sequence zipped with fflate.
7. **C8 (export in a Worker) stays deferred**: export renders on the main GPU device and stays ~realtime;
   moving it needs an OffscreenCanvas renderer + Worker decode. Revisit if F exports block the UI badly.

## Tasks and owners

| # | Task | Owner | Done when |
|---|---|---|---|
| F1 | Doc model (VideoClip, schema v5, timing, audio segments), provider interface, backend `prepare()`, video texture in the renderer, test fixtures | coordinator | unit tests; typecheck |
| F2 | Video assets (import, validation, metadata, poster, persistence) + exact frame provider | agent A | browser checks: import → poster, exact frames read back their frame number, reload + `.glyphix` round-trip |
| F3 | ASCII effect (two passes, calibrated LUT, charsets, colour modes, edges) | agent B | WebGPU = WebGL2, preview = export, cost < 2 ms at 160×90 |
| F4 | Export v2 (MP4 + audio mix, WebM VP9 alpha, PNG sequence, dialog) | agent C | decoded outputs: frame-exact video, audio present and in sync, alpha kept |
| F5 | Live playback provider, video UI (import, inspector "Video" section, layer icon), integration, `e2e-video`, full runs | coordinator | all suites green on all three browsers; status below |

## Status (2026-10-14)

F1–F5 done. Built by the coordinator plus three worker agents in separate git worktrees (A: video import +
frame-exact decoder, B: ASCII, C: export v2), merged into `milestone-f`. Headless, Intel Iris Xe;
Chrome WebGPU, Chrome forced WebGL2, Playwright Firefox.

| Gate | Result |
|---|---|
| Import + persistence | MP4/WebM/MOV via toolbar, paste or drop; readable errors for non-videos, undecodable codecs, > 1 GB; reload and `.glyphix` round-trip keep the file byte-identical (e2e-video-assets, all browsers) |
| Frame-exact | provider frames 0..149 (H.264) and 0..89 (VP9) exact; paused/scrubbed preview, backwards seeks, exported still, exported MP4 and WebM all read back the exact frame number (e2e-video, Chrome + Firefox) |
| Plays in sync | preview pictures come from the exact decoder while playing: picture late p95 17–33 ms (< 1 frame) on Chrome WebGPU/WebGL2; sound (Web Audio, same mix as the export) drift p50 6 ms, p95 15–31 ms; cold start after a far jump in sync after ~120–150 ms |
| ASCII 160×90 on 1080p | both passes ≈ 0.6–1.6 ms GPU (one full-screen pass); bench "1080p video + ASCII": 60 fps p50 on WebGPU and WebGL2; WebGPU = WebGL2 (mean Δ ≤ 0.06), preview = export Δ 0 |
| Export v2 | MP4 + audio (mixed from every audible clip, placed/looped/faded, pitch and timing verified), WebM VP9 with alpha + Opus, PNG sequence zip; frame-exact; all browsers (e2e-export-v2) |
| Earlier gates | all 13 e2e suites green on Chrome WebGPU, WebGL2 and Firefox; bench: every scene 60 fps p50, determinism Δ 0; Lighthouse a11y 100 / best practices 100; axe clean incl. the Video section; PWA offline |

Found and fixed during integration:
- Firefox WebGPU drew a VideoFrame texture as frame 0 forever → Firefox gets ImageBitmaps from the decoder.
- A `<video>`/`<audio>` element per layer for preview sound stalled the frame decoder (prepare() 450–580 ms)
  → preview sound plays the export's own audio mix through Web Audio; sync by construction.
- First design (live `<video>` frames while playing) drifted 100–370 ms → pictures always from the exact decoder.

Not verified / limits:
- **AAC**: neither Chrome on Linux nor Firefox can encode AAC, so MP4 audio is Opus (with a note; QuickTime can't
  play it). Fix needs the `@mediabunny/aac-encoder` dependency (MPL-2.0, 4.7 MB; matching version only 8 days old)
  — waiting for a decision.
- Headless Firefox renders the editor at ≤ 30 fps and falls behind during 1080p playback (pictures stay exact;
  smoothness is reported, not gated, on Firefox). Real (headed) Firefox not checked.
- The full editor plays at ~45 fps headless even without video (the bench page holds 60); this predates F.
- Rotated videos are drawn upright but no rotated test file exists; Safari, other GPUs and screen readers not checked.
- ASCII uses a fixed font (JetBrains Mono) and fixed charsets; no custom charset yet.
- C8 (export in a Worker) still deferred: 5 s 1080p exports stay at ~5–9 s on the main thread.
