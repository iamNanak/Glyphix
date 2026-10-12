// Renders the PWA icons from public/favicon.svg. Usage: node scripts/make-icons.mjs
import { readFileSync } from 'node:fs';
import { launch } from './browser.mjs';

const svg = readFileSync('public/favicon.svg', 'utf8');
const browser = await launch();
const page = await browser.newPage();
for (const [size, file, pad] of [
  [192, 'public/icons/icon-192.png', 0],
  [512, 'public/icons/icon-512.png', 0],
  // Maskable: the platform may crop to a circle, so keep the glyph inside the 80% safe zone.
  [512, 'public/icons/icon-maskable-512.png', 0.1],
]) {
  await page.setViewportSize({ width: size, height: size });
  const inner = Math.round(size * (1 - 2 * pad));
  await page.setContent(
    `<html><body style="margin:0;background:${pad ? '#8b5cf6' : 'transparent'};display:grid;place-items:center;height:${size}px">` +
      `<div style="width:${inner}px;height:${inner}px">${svg.replace('<svg ', `<svg width="${inner}" height="${inner}" `)}</div></body></html>`,
  );
  await page.screenshot({ path: file, omitBackground: !pad });
  console.log('wrote', file);
}
await browser.close();
