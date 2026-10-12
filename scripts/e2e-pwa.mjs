// PWA checks against a production build (pnpm build && vite preview).
// Usage: node scripts/e2e-pwa.mjs [baseUrl=http://localhost:4173]
import { launch } from './browser.mjs';

const base = process.argv[2] ?? 'http://localhost:4173';
const browser = await launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

await page.goto(base);
const manifest = await page.evaluate(async () => {
  const href = document.querySelector('link[rel=manifest]')?.getAttribute('href');
  const m = href ? await (await fetch(href)).json() : null;
  const icons = m ? await Promise.all(m.icons.map(async (i) => (await fetch(i.src)).ok)) : [];
  return { name: m?.name, display: m?.display, icons: icons.length, iconsOk: icons.every(Boolean), maskable: !!m?.icons.some((i) => i.purpose === 'maskable') };
});
check('manifest with name, standalone display and icons', manifest.name === 'Glyphix' && manifest.display === 'standalone' && manifest.iconsOk && manifest.maskable, JSON.stringify(manifest));

const sw = await page.evaluate(async () => {
  const reg = await Promise.race([navigator.serviceWorker.ready, new Promise((r) => setTimeout(() => r(null), 10000))]);
  return reg ? reg.active?.state : 'none';
});
check('service worker active', sw === 'activated', sw);

// Load once more so assets are cached, then go offline and reload.
await page.reload();
await page.waitForFunction(() => document.querySelector('[aria-label="Project name"]'), null, { timeout: 15000 });
await ctx.setOffline(true);
await page.reload();
const offline = await page
  .waitForFunction(() => document.querySelector('[aria-label="Project name"]') && document.querySelector('main canvas'), null, { timeout: 15000 })
  .then(() => true)
  .catch(() => false);
check('app loads offline', offline);
await ctx.setOffline(false);

await browser.close();
process.exit(failures ? 1 : 0);
