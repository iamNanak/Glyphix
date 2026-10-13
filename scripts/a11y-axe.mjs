// Accessibility audit with axe-core (the engine Lighthouse uses) in editor states Lighthouse can't
// reach on its own: text layer selected, font picker open, each animation tab.
// Usage: AXE=/path/to/axe.min.js node scripts/a11y-axe.mjs [baseUrl]
import { readFileSync } from 'node:fs';
import { launch } from './browser.mjs';

const base = process.argv[2] ?? 'http://localhost:5173';
const axe = readFileSync(process.env.AXE, 'utf8');
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(base);
await page.waitForFunction(() => window.__glyphix && window.__glyphix.saveState() === 'saved');
await page.keyboard.press('Space');
await page.addScriptTag({ content: axe });
let failures = 0;
async function audit(name) {
  const r = await page.evaluate(async () => {
    const res = await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } });
    return res.violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`);
  });
  console.log(`${r.length ? 'FAIL' : 'PASS'} ${name}${r.length ? `\n  ${r.join('\n  ')}` : ''}`);
  if (r.length) failures++;
}
await audit('nothing selected');
await page.evaluate(() => window.__glyphix.select('headline'));
await page.waitForTimeout(400);
await audit('text layer selected (enter tab)');
for (const tab of ['Exit', 'Loop']) {
  await page.getByRole('tab', { name: new RegExp(tab) }).click();
  await page.waitForTimeout(300);
  await audit(`animation ${tab.toLowerCase()} tab`);
}
await page.getByRole('switch', { name: 'Outline' }).click();
await page.getByRole('switch', { name: 'Text shadow' }).click();
await page.getByRole('group', { name: 'Fill type' }).getByRole('button', { name: 'Gradient' }).click();
await page.waitForTimeout(300);
await audit('outline, shadow, gradient controls');
await page.getByRole('button', { name: /^Font:/ }).click();
await page.waitForTimeout(800);
await audit('font picker open');
await browser.close();
process.exit(failures ? 1 : 0);
