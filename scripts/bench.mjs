// Headless bench run: for each scene, report frame stats, then run the gate buttons.
// Usage: node scripts/bench.mjs [baseUrl] [outDir]
// Note: headless numbers are indicative only; real gates need a real iGPU laptop.
import { chromium } from 'playwright-core';

const base = process.argv[2] ?? 'http://localhost:5173';
const out = process.argv[3] ?? '.';
// Headless Chrome screenshots of a WebGPU canvas are blank unless a frame is being rendered at
// capture time (headed Chrome is fine). Set HEADED=1 (needs a display) for trustworthy WebGPU screenshots.
// In-app pixel checks are unaffected: they read pixels in the same task as the render.
const browser = await chromium.launch({
  headless: !process.env.HEADED,
  executablePath: process.env.CHROME ?? '/usr/bin/google-chrome',
  args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=vulkan', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

const stats = async () =>
  page.$$eval('dl dt', (dts) => Object.fromEntries(dts.map((dt) => [dt.textContent, dt.nextElementSibling?.textContent])));

for (const webgl of [false, true]) {
  await page.goto(`${base}/${webgl ? '?webgl' : ''}#/bench`);
  await page.waitForTimeout(1500);
  for (const scene of ['Demo', '300 glyphs', '1000 glyphs', '4K + 10 layers']) {
    await page.getByRole('button', { name: scene, exact: true }).click();
    await page.waitForTimeout(4000);
    const s = await stats();
    console.log(`${webgl ? 'webgl2' : 'webgpu'} | ${scene.padEnd(15)} | fps ${s['fps (p50)']} | p95 ${s['frame p95']} | cpu p95 ${s['cpu p95']} | glyphs ${s['glyphs']} | draws ${s['draw calls']} | vram ${s['VRAM est.']}`);
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
