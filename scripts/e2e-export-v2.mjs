// Export v2 end to end: MP4/WebM with mixed audio, WebM VP9 alpha, PNG sequence (zip).
// Outputs are decoded (mediabunny/WebCodecs in the page, fflate in Node) and checked against the source.
// Usage: node scripts/e2e-export-v2.mjs [baseUrl] [outDir]   (needs scripts/fixtures/*, see make-video-fixtures.sh)
import { readFileSync } from 'node:fs';
import { unzipSync } from 'fflate';
import { browserName, launch } from './browser.mjs';

const base = process.argv[2] ?? 'http://localhost:5173';
const out = process.argv[3] ?? '.';
const browser = await launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
// Known, unrelated: React's shorthand/longhand warning from the Inspector's fill swatch when a doc is loaded.
page.on('console', (m) => m.type() === 'error' && !/style property during rerender/.test(m.text()) && errors.push(m.text()));
let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};
const info = (name, detail) => console.log(`INFO ${name} — ${detail}`);

await page.goto(base);
await page.waitForFunction(() => window.__glyphix && window.__glyphix.saveState() === 'saved');
await page.evaluate(() => window.__glyphix.editor.getState().setPlaying(false)); // a playing preview slows exports a lot

// Register the fixtures as video assets (as video import will: original file as the blob, a poster image).
await page.evaluate(async () => {
  const files = { 'vid-test1': 'clip-1080p30.mp4', 'vid-test2': 'clip-720p-vp9.webm', 'vid-silent': 'clip-silent-2s.mp4' };
  for (const [id, name] of Object.entries(files)) {
    const blob = await (await fetch(`/scripts/fixtures/${name}`)).blob();
    const poster = document.createElement('canvas');
    poster.width = 1280;
    poster.height = 720;
    const g = poster.getContext('2d');
    g.fillStyle = '#3a6';
    g.fillRect(0, 0, 1280, 720);
    window.__glyphix.export.putVideoAsset(id, poster, blob);
  }
});

// Where the tone starts in each source file (AAC encoders ramp in over the first packet, ~10 ms).
const srcOnset = await page.evaluate(async () => {
  const m = window.__glyphix.export.mediabunny;
  const out = {};
  for (const name of ['clip-1080p30.mp4', 'clip-720p-vp9.webm']) {
    const input = new m.Input({ source: new m.BlobSource(await (await fetch(`/scripts/fixtures/${name}`)).blob()), formats: m.ALL_FORMATS });
    const at = await input.getPrimaryAudioTrack();
    for await (const { buffer, timestamp } of new m.AudioBufferSink(at).buffers(0, 0.5)) {
      const x = buffer.getChannelData(0);
      const i = x.findIndex((v) => Math.abs(v) > 0.2 * 0.125); // the fixtures' sines peak at ~0.125
      if (i >= 0) {
        out[name] = timestamp + i / buffer.sampleRate;
        break;
      }
    }
    input.dispose();
  }
  return out;
});

// Test docs: the demo doc with its screenshot layer turned into video clips.
const docWith = (clips) =>
  page.evaluate((clips) => {
    const doc = structuredClone(window.__glyphix.state().doc);
    const shot = doc.comp.layers.find((l) => l.type === 'image');
    const layers = clips.map((c, i) => ({ ...structuredClone(shot), id: i ? `${shot.id}-${i}` : shot.id, assetId: c.assetId, video: { start: 0, in: 0, out: 2, loop: false, volume: 1, muted: false, ...c.clip } }));
    const at = doc.comp.layers.indexOf(shot);
    doc.comp.layers.splice(at, 1, ...layers);
    return doc;
  }, clips);

/**
 * Export `doc` directly (dev hook) and analyse the result in the page: tracks, frame count,
 * audio RMS per window, zero-crossing pitch, Goertzel tone power, onset time.
 */
const analyse = (doc, settings, probes = {}) =>
  page.evaluate(
    async ([doc, settings, probes]) => {
      const g = window.__glyphix;
      const m = g.export.mediabunny;
      const t0 = performance.now();
      const r = await g.export.runExport(doc, { format: 'mp4', scale: 0.5, quality: 0.9, transparent: false, webmTransparent: true, time: 0, gifFps: 20, ...settings }, { forceWebGL: g.editor.getState().forceWebGL });
      const ms = performance.now() - t0;
      const input = new m.Input({ source: new m.BlobSource(r.blob), formats: m.ALL_FORMATS });
      const vt = await input.getPrimaryVideoTrack();
      let frames = 0;
      for await (const _ of new m.EncodedPacketSink(vt).packets()) frames++;
      const res = { ms, filename: r.filename, note: r.note, size: r.blob.size, w: vt.displayWidth, h: vt.displayHeight, vcodec: vt.codec, frames, transparent: await vt.canBeTransparent(), audio: null };
      const at = await input.getPrimaryAudioTrack();
      if (at) {
        const chunks = [];
        let rate = 0;
        let first = null;
        for await (const { buffer, timestamp } of new m.AudioBufferSink(at).buffers()) {
          rate = buffer.sampleRate;
          first ??= timestamp;
          chunks.push({ data: buffer.getChannelData(0).slice(), at: timestamp });
        }
        const duration = await at.computeDuration();
        const n = Math.round((chunks.at(-1).at + chunks.at(-1).data.length / rate) * rate) + 1;
        const x = new Float32Array(n);
        for (const c of chunks) x.set(c.data, Math.max(0, Math.round(c.at * rate)));
        const win = (a, b) => x.subarray(Math.round(a * rate), Math.round(b * rate));
        const rms = (a, b) => {
          const s = win(a, b);
          let e = 0;
          for (const v of s) e += v * v;
          return Math.sqrt(e / Math.max(1, s.length));
        };
        const pitch = (a, b) => {
          const s = win(a, b);
          let zc = 0;
          for (let i = 1; i < s.length; i++) if ((s[i - 1] < 0) !== (s[i] < 0)) zc++;
          return zc / 2 / (s.length / rate);
        };
        // Goertzel: relative power of one frequency (≈ amplitude² / 4 for a pure tone).
        const tone = (a, b, f) => {
          const s = win(a, b);
          const k = (2 * Math.cos((2 * Math.PI * f) / rate));
          let p1 = 0;
          let p2 = 0;
          for (const v of s) {
            const p0 = v + k * p1 - p2;
            p2 = p1;
            p1 = p0;
          }
          return Math.sqrt(p1 * p1 + p2 * p2 - k * p1 * p2) / s.length;
        };
        // First sample above 20% of the fixtures' sine peak (~0.125).
        const onset = x.findIndex((v) => Math.abs(v) > 0.2 * 0.125) / rate;
        res.audio = {
          codec: at.codec,
          rate,
          channels: at.numberOfChannels,
          first,
          duration,
          onset,
          rms: Object.fromEntries((probes.rms ?? []).map(([a, b]) => [`${a}-${b}`, rms(a, b)])),
          pitch: Object.fromEntries((probes.pitch ?? []).map(([a, b]) => [`${a}-${b}`, pitch(a, b)])),
          tone: Object.fromEntries((probes.tone ?? []).map(([a, b, f]) => [`${a}-${b}@${f}`, tone(a, b, f)])),
        };
      }
      input.dispose();
      return res;
    },
    [doc, settings, probes],
  );

const comp = await page.evaluate(() => window.__glyphix.state().doc.comp);
const frameCount = Math.round(comp.duration * comp.fps);
const tol = 1 / comp.fps;
const f3 = (v) => (v == null ? 'n/a' : v.toFixed(3));

// --- MP4: one clip at 1 s (source 0..2 s), 440 Hz -----------------------------------------------
const probes = { rms: [[0.05, 0.95], [1.05, 2.95], [3.05, 4.95]], pitch: [[1.2, 2.8]] };
let doc = await docWith([{ assetId: 'vid-test1', clip: { start: 1, in: 0, out: 2 } }]);
let r = await analyse(doc, { format: 'mp4' }, probes);
const mp4Codec = r.vcodec;
check('MP4 video track', r.vcodec === 'avc' && r.w === comp.width / 2 && r.frames === frameCount, `${r.vcodec} ${r.w}×${r.h}, ${r.frames} frames (want ${frameCount}), ${(r.ms / 1000).toFixed(1)}s`);
let fullRms = 0;
if (!r.audio) check('MP4 has an audio track', false, r.note ?? '');
else {
  const a = r.audio;
  check('MP4 has an audio track', ['aac', 'opus'].includes(a.codec), `${a.codec} ${a.rate} Hz ×${a.channels}`);
  if (a.codec !== 'aac') info('MP4 audio codec', `${a.codec}: no AAC encoder in this browser — note: "${r.note}"`);
  check('MP4 audio duration = comp ±1 frame', Math.abs(a.duration - comp.duration) <= tol + 1e-6, `${f3(a.duration)}s (first sample ${f3(a.first)}s)`);
  const [pre, mid, post] = Object.values(a.rms);
  check('audio silent before/after the clip, loud during it', pre < 0.002 && post < 0.002 && mid > 0.05, `RMS ${f3(pre)} / ${f3(mid)} / ${f3(post)}`);
  const want = 1 + srcOnset['clip-1080p30.mp4'];
  check('audio starts at the clip start (sync)', Math.abs(a.onset - want) <= tol, `onset ${f3(a.onset)}s, want ${f3(want)} (1 s + source onset) ±${f3(tol)}; error ${((a.onset - want) * 1000).toFixed(1)} ms`);
  const p = Object.values(a.pitch)[0];
  check('pitch matches the source (440 Hz)', Math.abs(p - 440) < 8, `${p.toFixed(1)} Hz`);
  fullRms = mid;
}

// --- volume 0.5 halves RMS ---------------------------------------------------------------------
doc = await docWith([{ assetId: 'vid-test1', clip: { start: 1, in: 0, out: 2, volume: 0.5 } }]);
r = await analyse(doc, { format: 'mp4' }, probes);
if (r.audio && fullRms) {
  const ratio = Object.values(r.audio.rms)[1] / fullRms;
  check('volume 0.5 halves RMS (±10%)', Math.abs(ratio - 0.5) <= 0.05, `ratio ${ratio.toFixed(3)}`);
} else check('volume 0.5 halves RMS (±10%)', false, 'no audio');

// --- muted → no audio track; a file without audio → no audio track ------------------------------
doc = await docWith([{ assetId: 'vid-test1', clip: { start: 1, in: 0, out: 2, muted: true } }]);
r = await analyse(doc, { format: 'mp4' });
check('muted clip → no audio track', !r.audio && r.frames === frameCount, `${r.frames} frames`);
doc = await docWith([{ assetId: 'vid-silent', clip: { start: 0, in: 0, out: 2 } }]);
r = await analyse(doc, { format: 'mp4' });
check('silent source → no audio track', !r.audio && !r.note, `note: ${r.note}`);

// --- two overlapping clips mix: 440 Hz 0..3 s, 660 Hz (WebM/Opus source) 1..3 s -----------------
doc = await docWith([
  { assetId: 'vid-test1', clip: { start: 0, in: 0, out: 3 } },
  { assetId: 'vid-test2', clip: { start: 1, in: 0, out: 2 } },
]);
r = await analyse(doc, { format: 'mp4' }, { tone: [[0.2, 0.8, 440], [0.2, 0.8, 660], [1.2, 2.8, 440], [1.2, 2.8, 660], [3.2, 4.8, 440]] });
if (r.audio) {
  const [a440, a660, b440, b660, c440] = Object.values(r.audio.tone);
  check('overlapping clips mix (440 alone, then 440 + 660)', a440 > 0.02 && a660 < 0.1 * a440 && b440 > 0.02 && b660 > 0.02 && c440 < 0.002, `0–1s: 440=${f3(a440)} 660=${f3(a660)} · 1–3s: 440=${f3(b440)} 660=${f3(b660)} · 3–5s: 440=${f3(c440)}`);
} else check('overlapping clips mix', false, 'no audio');

// --- looping clip: source 0..1 s repeats ------------------------------------------------------
doc = await docWith([{ assetId: 'vid-test1', clip: { start: 0, in: 0, out: 1, loop: true } }]);
r = await analyse(doc, { format: 'mp4' }, { rms: [[0.1, 4.9]], pitch: [[3.2, 3.8]] });
check('looping clip plays for the whole comp', r.audio && Object.values(r.audio.rms)[0] > 0.05 && Math.abs(Object.values(r.audio.pitch)[0] - 440) < 8, r.audio ? `RMS ${f3(Object.values(r.audio.rms)[0])}, ${Object.values(r.audio.pitch)[0].toFixed(1)} Hz in loop 4` : 'no audio');

// --- WebM: VP9 + alpha + Opus (Opus source at 1 s: its tone starts at once, so sync is sharp) ----
const want1 = 1 + srcOnset['clip-720p-vp9.webm'];
doc = await docWith([{ assetId: 'vid-test2', clip: { start: 1, in: 0, out: 2 } }]);
r = await analyse(doc, { format: 'webm' }, probes);
check('WebM VP9', r.filename.endsWith('.webm') && r.vcodec === 'vp9' && r.frames === frameCount, `${r.vcodec}, ${r.frames} frames, ${(r.ms / 1000).toFixed(1)}s${r.note ? ` — note: ${r.note}` : ''}`);
check('WebM may be transparent (alpha track data)', r.transparent || /transparent/.test(r.note ?? ''), `canBeTransparent=${r.transparent}`);
check('WebM audio is Opus, silent outside the clip, in sync', r.audio?.codec === 'opus' && Object.values(r.audio.rms)[1] > 0.05 && Object.values(r.audio.rms)[0] < 0.002 && Math.abs(r.audio.onset - want1) <= tol, r.audio ? `RMS ${Object.values(r.audio.rms).map(f3).join(' / ')}, onset ${f3(r.audio.onset)}s (want ${f3(want1)})` : 'no audio');
const webmAlpha = r.transparent;

// Alpha pixels: decode a frame with alpha and compare with a direct transparent render of the same time.
const alphaCheck = await page.evaluate(async (doc) => {
  const g = window.__glyphix;
  const m = g.export.mediabunny;
  const r = await g.export.runExport(doc, { format: 'webm', scale: 0.5, quality: 0.9, transparent: false, webmTransparent: true, time: 0, gifFps: 20 }, { forceWebGL: g.editor.getState().forceWebGL });
  const input = new m.Input({ source: new m.BlobSource(r.blob), formats: m.ALL_FORMATS });
  const vt = await input.getPrimaryVideoTrack();
  const t = 2;
  const wc = await new m.CanvasSink(vt, { alpha: true, poolSize: 0 }).getCanvas(t + 0.001);
  const w = vt.displayWidth;
  const h = vt.displayHeight;
  const c = new OffscreenCanvas(w, h);
  const cg = c.getContext('2d', { willReadFrequently: true });
  cg.drawImage(wc.canvas, 0, 0);
  const dec = cg.getImageData(0, 0, w, h).data;
  // Reference: the same doc without background layers, rendered directly.
  const ref = { ...doc, comp: { ...doc.comp, layers: doc.comp.layers.map((l) => (l.type === 'background' ? { ...l, visible: false } : l)) } };
  const canvas = document.createElement('canvas');
  const backend = await g.render.createBackend({ canvas, fullResAssets: true, forceWebGL: g.editor.getState().forceWebGL });
  backend.setSize(w, h, 1);
  const { evaluate } = await import('/src/doc/index.ts'); // pure functions: a second module copy is harmless
  backend.render(evaluate(ref, t)); // warm-up
  const bmp = await g.render.renderFrameBitmap(backend, ref, t);
  cg.clearRect(0, 0, w, h);
  cg.drawImage(bmp, 0, 0);
  const want = cg.getImageData(0, 0, w, h).data;
  await backend.idle();
  backend.dispose();
  input.dispose();
  let clear = 0, clearOk = 0, solid = 0, solidOk = 0;
  for (let i = 3; i < want.length; i += 4 * 7) {
    if (want[i] === 0) {
      clear++;
      if (dec[i] <= 2) clearOk++;
    } else if (want[i] === 255) {
      solid++;
      if (dec[i] >= 253) solidOk++;
    }
  }
  return { clear, clearOk, solid, solidOk };
}, doc);
if (webmAlpha) {
  check('WebM alpha: transparent where the background was', alphaCheck.clear > 1000 && alphaCheck.clearOk / alphaCheck.clear > 0.99, `${alphaCheck.clearOk}/${alphaCheck.clear} sampled px have alpha 0`);
  check('WebM alpha: opaque where layers are', alphaCheck.solid > 1000 && alphaCheck.solidOk / alphaCheck.solid > 0.99, `${alphaCheck.solidOk}/${alphaCheck.solid} sampled px have alpha 255`);
} else info('WebM alpha', 'not encoded in this browser (fallback note shown)');

// --- Through the dialog: MP4 with audio, WebM, PNG sequence ------------------------------------
await page.evaluate((doc) => window.__glyphix.editor.getState().loadDoc(doc), doc);
await page.evaluate(() => window.__glyphix.setTime(2));
const dialog = () => page.getByRole('dialog', { name: 'Export' });
async function exportWith(format, { scale, transparent } = {}) {
  if (!(await dialog().isVisible().catch(() => false))) {
    await page.keyboard.press('Control+e');
    await dialog().waitFor();
  }
  await dialog().getByRole('group', { name: 'Format' }).getByRole('button', { name: format, exact: true }).click();
  if (scale) await dialog().getByRole('group', { name: 'Scale' }).getByRole('button', { name: scale, exact: true }).click();
  if (transparent !== undefined) {
    const sw = dialog().getByRole('switch', { name: 'Transparent background' });
    if ((await sw.getAttribute('aria-checked')) !== String(transparent)) await sw.click();
  }
  const started = Date.now();
  const [download] = await Promise.all([page.waitForEvent('download', { timeout: 180000 }), dialog().getByRole('button', { name: /^Export / }).click()]);
  const path = `${out}/${download.suggestedFilename()}`;
  await download.saveAs(path);
  const status = await dialog().getByRole('status').textContent();
  return { path, name: download.suggestedFilename(), bytes: readFileSync(path), secs: (Date.now() - started) / 1000, status };
}

/** Container facts of a downloaded file, read in the page. */
const tracks = (bytes) =>
  page.evaluate(async (b64) => {
    const m = window.__glyphix.export.mediabunny;
    const data = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const input = new m.Input({ source: new m.BufferSource(data), formats: m.ALL_FORMATS });
    const vt = await input.getPrimaryVideoTrack();
    const at = await input.getPrimaryAudioTrack();
    const res = { v: vt?.codec, w: vt?.displayWidth, a: at?.codec ?? null, duration: await input.computeDuration() };
    input.dispose();
    return res;
  }, bytes.toString('base64'));

let d = await exportWith('MP4 video', { scale: '1×' });
let t = await tracks(d.bytes);
check('dialog: MP4 with audio', d.name.endsWith('.mp4') && t.v === 'avc' && t.w === comp.width && !!t.a && Math.abs(t.duration - comp.duration) <= tol + 0.01, `${t.v}+${t.a}, ${t.duration.toFixed(2)}s, ${(d.bytes.length / 1e6).toFixed(1)} MB, ${d.secs.toFixed(1)}s`);
if (t.a !== 'aac') check('dialog explains the audio fallback', /AAC|audio/.test(d.status), d.status.trim());

d = await exportWith('WebM (transparent)', { scale: '1×', transparent: true });
t = await tracks(d.bytes);
check('dialog: WebM', d.name.endsWith('.webm') && t.v === 'vp9' && t.a === 'opus', `${t.v}+${t.a}, ${(d.bytes.length / 1e6).toFixed(1)} MB, ${d.secs.toFixed(1)}s${/transparent/.test(d.status) ? ` — ${d.status.trim()}` : ''}`);

d = await exportWith('PNG sequence (.zip)', { scale: '0.5×', transparent: true });
const zip = unzipSync(new Uint8Array(d.bytes));
const names = Object.keys(zip);
const wantNames = Array.from({ length: frameCount }, (_, i) => `frame-${String(i).padStart(5, '0')}.png`);
check('dialog: PNG sequence zip', d.name.endsWith('-frames.zip') && names.length === frameCount && names.every((n, i) => n === wantNames[i]), `${names.length} files (${names[0]} … ${names.at(-1)}), ${(d.bytes.length / 1e6).toFixed(1)} MB, ${d.secs.toFixed(1)}s`);

// Frames k equal a direct render of comp time k/fps (transparent, 0.5×).
const pick = [0, 45, frameCount - 1];
const cmp = await page.evaluate(
  async ([pngs, ks]) => {
    const g = window.__glyphix;
    const { evaluate } = await import('/src/doc/index.ts');
    const doc = g.state().doc;
    const ref = { ...doc, comp: { ...doc.comp, layers: doc.comp.layers.map((l) => (l.type === 'background' ? { ...l, visible: false } : l)) } };
    const read = async (src, w, h) => {
      const c = new OffscreenCanvas(w, h);
      const cg = c.getContext('2d', { willReadFrequently: true });
      cg.drawImage(src, 0, 0);
      return cg.getImageData(0, 0, w, h).data;
    };
    const out = [];
    let backend = null;
    for (let j = 0; j < ks.length; j++) {
      const png = await createImageBitmap(new Blob([Uint8Array.from(atob(pngs[j]), (c) => c.charCodeAt(0))], { type: 'image/png' }), { premultiplyAlpha: 'none' });
      const w = png.width;
      const h = png.height;
      if (!backend) {
        backend = await g.render.createBackend({ canvas: document.createElement('canvas'), fullResAssets: true, forceWebGL: g.editor.getState().forceWebGL }); // same backend as the export
        backend.setSize(w, h, 1);
        backend.render(evaluate(ref, 0));
      }
      const t = ks[j] / doc.comp.fps;
      const bmp = await g.render.renderFrameBitmap(backend, ref, t);
      const a = await read(png, w, h);
      const b = await read(bmp, w, h);
      let maxD = 0;
      let clear = 0;
      // Compare premultiplied: the colour of a nearly transparent pixel is noise after any 8-bit round trip.
      let rawD = 0;
      for (let i = 0; i < a.length; i += 4) {
        maxD = Math.max(maxD, Math.abs(a[i + 3] - b[i + 3]));
        for (let c = 0; c < 3; c++) {
          maxD = Math.max(maxD, Math.abs((a[i + c] * a[i + 3]) / 255 - (b[i + c] * b[i + 3]) / 255));
          rawD = Math.max(rawD, Math.abs(a[i + c] - b[i + c]));
        }
      }
      maxD = Math.round(maxD);
      for (let i = 3; i < a.length; i += 4) if (a[i] === 0) clear++;
      out.push({ k: ks[j], w, h, maxD, rawD, clearPct: (100 * clear) / (w * h) });
    }
    await backend.idle();
    backend.dispose();
    return out;
  },
  [pick.map((k) => Buffer.from(zip[wantNames[k]]).toString('base64')), pick],
);
for (const c of cmp) {
  check(`PNG sequence frame ${c.k} = direct render at ${c.k}/${comp.fps}s`, c.maxD <= 2 && c.w === comp.width / 2, `${c.w}×${c.h}, max Δ ${c.maxD} premultiplied (straight RGB ${c.rawD})`);
}
check('PNG sequence transparent: alpha 0 where the background was', cmp.every((c) => c.clearPct > 20), cmp.map((c) => `${c.clearPct.toFixed(0)}%`).join(', '));

info('browser', `${browserName}${base.includes('webgl') ? ' (WebGL2)' : ''}; MP4 video codec ${mp4Codec}`);
console.log(errors.length ? `page errors:\n${errors.slice(0, 10).join('\n')}` : 'no page errors');
if (errors.length) failures++;
await browser.close();
process.exit(failures ? 1 : 0);
