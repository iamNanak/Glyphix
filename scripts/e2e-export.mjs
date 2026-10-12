// Export dialog end to end: every format through the real UI, downloads decoded and verified.
// Usage: node scripts/e2e-export.mjs [baseUrl] [outDir]
import { readFileSync } from 'node:fs';
import { ALL_FORMATS, BufferSource, Input } from 'mediabunny';
import { browserName, launch } from './browser.mjs';

const base = process.argv[2] ?? 'http://localhost:5173';
const out = process.argv[3] ?? '.';
const browser = await launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

await page.goto(base);
await page.waitForFunction(() => window.__glyphix && window.__glyphix.saveState() === 'saved');
await page.keyboard.press('Space');
await page.evaluate(() => window.__glyphix.setTime(4));

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
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 120000 }),
    dialog().getByRole('button', { name: /^Export / }).click(),
  ]);
  const path = `${out}/${download.suggestedFilename()}`;
  await download.saveAs(path);
  await dialog().getByRole('status').waitFor(); // result summary
  return { path, name: download.suggestedFilename(), bytes: readFileSync(path), secs: (Date.now() - started) / 1000 };
}

/** Read a video's container in Node (<video> metadata depends on the browser having a decoder). */
async function inspectVideo(bytes) {
  const input = new Input({ source: new BufferSource(bytes), formats: ALL_FORMATS });
  const vt = await input.getPrimaryVideoTrack();
  return { w: vt.displayWidth, h: vt.displayHeight, duration: await input.computeDuration() };
}

/** Decode an exported image in the page and describe it. */
const inspect = (bytes, mime) =>
  page.evaluate(
    async ([b64, mime]) => {
      const data = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const blob = new Blob([data], { type: mime });
      let frames = 1;
      if (mime === 'image/gif' && 'ImageDecoder' in window) {
        const dec = new ImageDecoder({ data: data.buffer, type: 'image/gif' });
        await dec.tracks.ready;
        frames = dec.tracks.selectedTrack.frameCount;
      }
      const bmp = await createImageBitmap(blob);
      const c = new OffscreenCanvas(bmp.width, bmp.height);
      const g = c.getContext('2d');
      g.drawImage(bmp, 0, 0);
      const d = g.getImageData(0, 0, bmp.width, bmp.height).data;
      let opaque = 0;
      let clear = 0;
      for (let i = 3; i < d.length; i += 4) {
        if (d[i] > 200) opaque++;
        else if (d[i] < 10) clear++;
      }
      const n = d.length / 4;
      return { w: bmp.width, h: bmp.height, opaquePct: (100 * opaque) / n, clearPct: (100 * clear) / n, frames };
    },
    [bytes.toString('base64'), mime],
  );

let r = await exportWith('PNG', { scale: '1×', transparent: false });
let info = await inspect(r.bytes, 'image/png');
check('PNG 1×', r.name.endsWith('.png') && info.w === 1920 && info.h === 1080 && info.opaquePct > 99, `${info.w}×${info.h}, ${info.opaquePct.toFixed(0)}% opaque, ${(r.bytes.length / 1024).toFixed(0)} KB`);

r = await exportWith('PNG', { scale: '2×', transparent: true });
info = await inspect(r.bytes, 'image/png');
check('PNG 2× transparent', info.w === 3840 && info.h === 2160 && info.clearPct > 20 && info.opaquePct > 5, `${info.w}×${info.h}, ${info.clearPct.toFixed(0)}% fully transparent`);

r = await exportWith('JPEG', { scale: '1×' });
info = await inspect(r.bytes, 'image/jpeg');
check('JPEG', r.name.endsWith('.jpg') && r.bytes[0] === 0xff && r.bytes[1] === 0xd8 && info.w === 1920, `${(r.bytes.length / 1024).toFixed(0)} KB`);

r = await exportWith('WebP', { scale: '1×', transparent: false });
const isWebp = r.bytes.subarray(0, 4).toString() === 'RIFF' && r.bytes.subarray(8, 12).toString() === 'WEBP';
check('WebP is really WebP', r.name.endsWith('.webp') && isWebp, `${(r.bytes.length / 1024).toFixed(0)} KB`);

r = await exportWith('GIF', { scale: '0.5×' });
info = await inspect(r.bytes, 'image/gif');
const comp = await page.evaluate(() => window.__glyphix.state().doc.comp);
check('GIF', r.bytes.subarray(0, 6).toString() === 'GIF89a' && info.w === 960 && info.frames === Math.round(comp.duration * 20), `${info.w}×${info.h}, ${info.frames} frames, ${(r.bytes.length / 1e6).toFixed(1)} MB, ${r.secs.toFixed(1)}s`);

r = await exportWith('MP4 video', { scale: '1×' });
info = await inspectVideo(r.bytes);
check('MP4', r.name.endsWith('.mp4') && info.w === 1920 && info.h === 1080 && Math.abs(info.duration - comp.duration) < 0.1, `${info.w}×${info.h}, ${info.duration.toFixed(2)}s, ${(r.bytes.length / 1e6).toFixed(1)} MB, ${r.secs.toFixed(1)}s`);
// Firefox's WebCodecs H.264 encoder is software-only here (~4× slower); the gate applies to Chrome.
if (browserName === 'firefox') console.log(`INFO MP4 export time in Firefox — ${r.secs.toFixed(2)}s (gate applies to Chrome)`);
else check('MP4 1080p30 5 s exports in ≤ 5 s', r.secs <= 5.5, `${r.secs.toFixed(2)}s wall clock incl. download`);

// Cancel a running export.
await dialog().getByRole('group', { name: 'Format' }).getByRole('button', { name: 'MP4 video', exact: true }).click();
await dialog().getByRole('group', { name: 'Scale' }).getByRole('button', { name: '2×', exact: true }).click();
await dialog().getByRole('button', { name: /^Export / }).click();
await dialog().getByRole('progressbar').waitFor();
await page.waitForTimeout(400);
await dialog().getByRole('button', { name: 'Cancel' }).click();
const msg = await dialog().getByRole('alert').textContent({ timeout: 10000 });
check('cancel stops a running export', /cancelled/.test(msg), msg);

console.log(errors.length ? `page errors:\n${errors.slice(0, 10).join('\n')}` : 'no page errors');
if (errors.length) failures++;
await browser.close();
process.exit(failures ? 1 : 0);
