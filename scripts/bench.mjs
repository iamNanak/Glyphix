// Headless bench run: for each scene, report frame stats, then run the gate buttons.
// Usage: node scripts/bench.mjs [baseUrl] [outDir]
// Note: headless numbers are indicative only; real gates need a real iGPU laptop.
import { launch } from './browser.mjs';

const base = process.argv[2] ?? 'http://localhost:5173';
const out = process.argv[3] ?? '.';
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

const stats = async () =>
  page.$$eval('dl dt', (dts) => Object.fromEntries(dts.map((dt) => [dt.textContent, dt.nextElementSibling?.textContent])));

for (const webgl of [false, true]) {
  await page.goto(`${base}/${webgl ? '?webgl' : ''}#/bench`);
  await page.waitForTimeout(1500);
  for (const scene of ['Demo', '300 glyphs', '1000 glyphs', '300 glyphs, enter + exit + wave', '4K + 10 layers', '4K layer + 3 effects', '1080p + ASCII 160×90', '1080p video', '1080p video + ASCII']) {
    await page.getByRole('button', { name: scene, exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('[role=status]'), null, { timeout: 120000 }); // test video
    // Rolling window = last 240 frames (~4 s); wait longer so one-time work (shader compiles,
    // texture uploads) after switching scene falls outside it.
    await page.waitForTimeout(6500);
    const s = await stats();
    console.log(`${webgl ? 'webgl2' : 'webgpu'} | ${scene.padEnd(31)} | fps ${s['fps (p50)']} | p95 ${s['frame p95']} | cpu p95 ${s['cpu p95']} | glyphs ${s['glyphs']} | draws ${s['draw calls']} | vram ${s['VRAM est.']}`);
    await page.screenshot({ path: `${out}/bench-${webgl ? 'webgl2' : 'webgpu'}-${scene.replace(/\W+/g, '_')}.png` });
  }
}

await page.goto(`${base}/#/bench`);
await page.waitForTimeout(1500);
await page.getByRole('button', { name: 'Demo', exact: true }).click();
for (const gate of ['Preview = export pixel check', 'WebGPU vs WebGL2 diff', 'Time video export']) {
  await page.getByRole('button', { name: gate }).click();
  await page.waitForFunction(() => !document.querySelector('aside button[disabled]'), null, { timeout: 120000 });
  await page.waitForTimeout(300);
}
console.log((await page.$$eval('ol li', (lis) => lis.map((l) => l.textContent))).reverse().join('\n'));
console.log(errors.length ? `errors:\n${errors.slice(0, 10).join('\n')}` : 'no page errors');
await browser.close();
