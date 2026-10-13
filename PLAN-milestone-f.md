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

## Status

In progress.
