// Renders the link-preview card (Open Graph image) shown by WhatsApp, X, LinkedIn, Slack...
// Usage: node scripts/make-og.mjs [baseUrl=https://glyphixx.vercel.app]
// Takes a screenshot of the editor with its demo scene, then lays it out on a 1200x630 card.
// Content is kept centred because some apps (WhatsApp) crop the card to a square.
import { readFileSync } from 'node:fs';
import { launch } from './browser.mjs';

const base = process.argv[2] ?? 'https://glyphixx.vercel.app';
const out = 'public/og.jpg';

const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
await page.goto(base);
await page.waitForSelector('main canvas');
await page.waitForTimeout(3000); // let the demo animation settle on a full frame
const shot = (await page.screenshot({ type: 'png' })).toString('base64');

const inter = readFileSync('public/fonts/Inter.ttf').toString('base64');
const logo = readFileSync('public/favicon.svg', 'utf8').replace('<svg ', '<svg width="44" height="44" ');

await page.setViewportSize({ width: 1200, height: 630 });
await page.setContent(`<!doctype html><html><head><style>
@font-face { font-family: Inter; src: url(data:font/ttf;base64,${inter}); font-weight: 100 900; }
* { margin: 0; box-sizing: border-box; }
body { width: 1200px; height: 630px; overflow: hidden; font-family: Inter, sans-serif; color: #fff;
  background: radial-gradient(900px 420px at 50% 0%, #3b1d7a 0%, #0b0b0f 70%); }
.top { display: flex; flex-direction: column; align-items: center; padding-top: 40px; }
.brand { display: flex; align-items: center; gap: 12px; font-size: 30px; font-weight: 700; letter-spacing: -0.5px; }
h1 { margin-top: 18px; font-size: 54px; font-weight: 800; letter-spacing: -1.5px; line-height: 1.05; text-align: center; }
h1 span { background: linear-gradient(90deg, #f472b6, #a78bfa 55%, #818cf8); -webkit-background-clip: text; color: transparent; }
.sub { margin-top: 14px; font-size: 22px; color: #b4b4c0; }
.shot { position: absolute; left: 50%; top: 262px; width: 1000px; transform: translateX(-50%);
  border-radius: 14px; border: 1px solid #ffffff22; box-shadow: 0 30px 80px #8b5cf655, 0 0 0 6px #ffffff08; }
</style></head><body>
<div class="top">
  <div class="brand">${logo}Glyphix</div>
  <h1>Screenshots in. <span>Animated visuals out.</span></h1>
  <div class="sub">Free · No sign-up · Runs in your browser</div>
</div>
<img class="shot" src="data:image/png;base64,${shot}">
</body></html>`);
await page.waitForTimeout(300);
await page.screenshot({ path: out, type: 'jpeg', quality: 85 });
console.log('wrote', out);
await browser.close();
