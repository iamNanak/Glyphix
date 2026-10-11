// Headless smoke test: loads the editor (WebGPU and forced WebGL2), screenshots, collects console errors.
// Usage: node scripts/smoke.mjs [baseUrl] [outDir]
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
const logs = [];
page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));

for (const [name, query] of [['webgpu', ''], ['webgl2', '?webgl']]) {
  await page.goto(`${base}/${query}`);
  await page.waitForTimeout(3500);
  const backend = await page.locator('header .font-mono').textContent().catch(() => '?');
  await page.screenshot({ path: `${out}/editor-${name}.png` });
  console.log(`${name}: backend=${backend}`);
}
console.log(logs.slice(0, 30).join('\n') || 'no console errors');
await browser.close();
