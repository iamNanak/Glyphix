// Keyboard-only workflow: every editing tool reachable without a pointer.
// Usage: node scripts/e2e-keyboard.mjs [baseUrl]
import { launch } from './browser.mjs';

const base = process.argv[2] ?? 'http://localhost:5173';
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};
const shot = () => page.evaluate(() => window.__glyphix.state().doc.comp.layers.find((l) => l.id === 'shot'));
const focused = () => page.evaluate(() => {
  const el = document.activeElement;
  return el ? el.getAttribute('aria-label') || el.textContent?.trim().slice(0, 30) || el.tagName : '';
});
/** Press Tab until the focused element matches, up to `max` presses. */
// Generous limit: Firefox keeps the sequential-focus start point after blur() and also stops on
// scrollable panels, so wrapping around the whole UI can take a few hundred presses.
async function tabTo(test, max = 400, key = 'Tab') {
  const trail = [];
  for (let i = 0; i < max; i++) {
    await page.keyboard.press(key);
    const f = await focused();
    trail.push(f);
    if (test(f)) return true;
  }
  if (process.env.TRACE) console.log(`  · tab trail (last 25 of ${trail.length}): ${trail.slice(-25).join(' | ')}`);
  return false;
}

await page.goto(base);
await page.waitForFunction(() => window.__glyphix && window.__glyphix.saveState() === 'saved');
await page.keyboard.press('Space'); // pause
await page.evaluate(() => {
  window.__glyphix.select(null);
  document.activeElement?.blur();
});

// Tab order reaches every area of the app.
const seen = new Set();
for (let i = 0; i < 80; i++) {
  await page.keyboard.press('Tab');
  seen.add(await focused());
}
const want = ['Projects', 'Project name', 'Export', 'Screenshot', 'Playhead', 'Video length in seconds'];
const missing = want.filter((w) => ![...seen].some((s) => s.includes(w)));
check('Tab reaches toolbar, layers, inspector and timeline', missing.length === 0, missing.length ? `missing: ${missing.join(', ')}` : `${seen.size} stops`);

// Select a layer from the layers panel with the keyboard.
await page.evaluate(() => document.activeElement?.blur());
check('Tab to the Screenshot layer', await tabTo((f) => f === 'Screenshot'));
await page.keyboard.press('Enter');
check('Enter selects it', (await page.evaluate(() => window.__glyphix.state().selectedId)) === 'shot');

// Transform fields.
const before = await shot();
await page.getByLabel('X', { exact: true }).fill('700');
await page.getByLabel('Scale %', { exact: true }).fill('80');
await page.getByLabel('Rotation °', { exact: true }).fill('-6');
const after = await shot();
const last = (p) => ('static' in p ? p.static : p.track.keys.at(-1).v);
check('X / scale / rotation via number fields', last(after.transform.x) === 700 && Math.abs(last(after.transform.scale) - 0.8) < 1e-9 && last(after.transform.rotation) === -6, `x=${last(after.transform.x)} scale=${last(after.transform.scale)} rot=${last(after.transform.rotation)}`);
check('animated props keep their animation', 'track' in after.transform.scale === 'track' in before.transform.scale);

// Crop with arrow keys.
await page.getByRole('slider', { name: 'Left' }).focus();
for (let i = 0; i < 20; i++) await page.keyboard.press('ArrowRight');
const cropped = await shot();
check('crop with arrow keys', cropped.crop.x > 0.09 && cropped.width < after.width, `crop.x=${cropped.crop.x.toFixed(3)} width=${cropped.width.toFixed(0)}`);

// Nudge on the canvas with arrows (focus must not be in a field).
await page.evaluate(() => document.activeElement?.blur());
const x0 = last((await shot()).transform.x);
await page.keyboard.press('Shift+ArrowRight');
check('Shift+Arrow nudges 10 px', last((await shot()).transform.x) === x0 + 10);

// Dialogs open and close from the keyboard; focus returns.
await page.keyboard.press('Control+e');
check('Ctrl+E opens Export', await page.getByRole('dialog', { name: 'Export' }).isVisible());
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
check('Escape closes it', !(await page.getByRole('dialog', { name: 'Export' }).isVisible().catch(() => false)));
await page.evaluate(() => document.activeElement?.blur());
// Projects is the first control: reach it backwards. (Headless Firefox moves focus out of the page
// after the last control and never brings it back, so wrapping forwards isn't testable there.)
check('Shift+Tab to Projects', await tabTo((f) => f === 'Projects', 400, 'Shift+Tab'));
await page.keyboard.press('Enter');
check('Enter opens Projects', await page.getByRole('dialog', { name: 'Projects' }).isVisible());
await page.keyboard.press('Escape');

// Undo the whole session from the keyboard.
await page.waitForTimeout(300);
await page.evaluate(() => document.activeElement?.blur());
for (let i = 0; i < 10; i++) await page.keyboard.press('Control+z');
const undone = await shot();
check('Ctrl+Z undoes everything', JSON.stringify(undone.transform) === JSON.stringify(before.transform) && undone.crop.x === 0);

// Visible focus indicator.
await page.getByLabel('Project name').focus();
const outline = await page.evaluate(() => {
  const cs = getComputedStyle(document.activeElement);
  return cs.outlineStyle !== 'none' || cs.boxShadow !== 'none';
});
check('focused controls show a focus ring', outline);

console.log(errors.length ? `page errors:\n${errors.slice(0, 10).join('\n')}` : 'no page errors');
if (errors.length) failures++;
await browser.close();
process.exit(failures ? 1 : 0);
