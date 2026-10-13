// Motion presets end to end: apply via the inspector, check the evaluator, check that two
// independent renderers agree mid-animation (preview = export) and that frames actually change.
// Usage: node scripts/e2e-motion.mjs [baseUrl] [outDir]
import { launch } from './browser.mjs';

const base = process.argv[2] ?? 'http://localhost:5173';
const out = process.argv[3] ?? '.';
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
const layer = (id) => page.evaluate((id) => window.__glyphix.state().doc.comp.layers.find((l) => l.id === id), id);
const item = (id, t) =>
  page.evaluate(
    async ([id, t]) => {
      const { evaluate } = await import('/src/doc/evaluate.ts');
      return evaluate(window.__glyphix.state().doc, t).items.find((i) => i.id === id);
    },
    [id, t],
  );
const preset = (group, name) => page.getByRole('group', { name: group }).getByRole('button', { name, exact: true }).click();

await page.goto(base);
await page.waitForFunction(() => window.__glyphix);
await page.waitForTimeout(1500);
await page.keyboard.press('Space');

// --- Image: slide up at 1 s.
await page.evaluate(() => window.__glyphix.select('shot'));
await page.waitForTimeout(200);
await preset('Enter animation', 'Slide up');
let shot = await layer('shot');
check('image enter preset stored', shot.motion.enter?.preset === 'slide-up', JSON.stringify(shot.motion.enter));
await page.getByRole('slider', { name: 'Starts at' }).focus();
for (let i = 0; i < 20; i++) await page.keyboard.press('ArrowRight'); // 20 × 0.05 s = 1 s
shot = await layer('shot');
check('start slider is keyboard operable', Math.abs(shot.motion.enter.start - 1) < 1e-6, `start=${shot.motion.enter.start}`);
const early = await item('shot', 1.1);
const rest = await item('shot', 4);
check('slide-up: lower and fading in at 1.1 s', early.y > rest.y + 10 && early.opacity < rest.opacity, `y ${early.y.toFixed(1)} vs ${rest.y.toFixed(1)}, opacity ${early.opacity.toFixed(2)}`);

await page.getByRole('tab', { name: /Loop/ }).click();
await preset('Loop animation', 'Ken Burns');
shot = await layer('shot');
// Compare one full cycle apart, after the layer's own keyframes (scale 0.94 → 1 over 0–1 s) have settled.
const kbA = await item('shot', 1.5);
const kbB = await item('shot', 1.5 + shot.motion.loop.period);
check('ken burns cycles match the comp length', shot.motion.loop?.period === 5 && Math.abs(kbA.scale - kbB.scale) < 1e-9 && Math.abs(kbA.x - kbB.x) < 1e-9, `period ${shot.motion.loop?.period}`);

// --- Text: typewriter + wave.
await page.evaluate(() => window.__glyphix.select('headline'));
await page.waitForTimeout(200);
await page.getByRole('tab', { name: /Enter/ }).click();
await preset('Enter animation', 'Typewriter');
await page.getByRole('tab', { name: /Loop/ }).click();
await preset('Loop animation', 'Wave');
const head = await item('headline', 0.5);
check('typewriter compiles to a hold-easing glyph animator', head.enter?.easing.kind === 'hold' && head.enter.stagger > 0);
check('wave loop reaches the renderer', head.loop?.kind === 'wave' && head.loop.amplitude > 0, JSON.stringify(head.loop));
check('custom glyph controls hidden while a glyph preset is active', (await page.getByText('Custom glyph animation').count()) === 0);

// --- Timeline: length + fps are undoable doc edits.
await page.getByLabel('Video length in seconds').fill('6');
let comp = await page.evaluate(() => window.__glyphix.state().doc.comp);
check('video length edit', comp.duration === 6);
await page.keyboard.press('Escape');
await page.locator('body').click({ position: { x: 5, y: 5 } });
await page.keyboard.press('Control+z');
comp = await page.evaluate(() => window.__glyphix.state().doc.comp);
check('video length undo', comp.duration === 5, `duration=${comp.duration}`);

// --- Rendering: two independent backends agree mid-animation, and the animation is visible.
const r = await page.evaluate(async () => {
  const { createBackend } = await import('/src/render/backend.ts');
  const { renderFrameBitmap } = await import('/src/export/exporter.ts');
  const { fontLibrary } = await import('/src/text/fontLibrary.ts');
  await fontLibrary.load('inter');
  const doc = window.__glyphix.state().doc;
  const px = async (t) => {
    const b = await createBackend({ canvas: document.createElement('canvas'), fullResAssets: true });
    b.setSize(960, 540, 1);
    await renderFrameBitmap(b, doc, t);
    const bmp = await renderFrameBitmap(b, doc, t);
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    const g = c.getContext('2d');
    g.drawImage(bmp, 0, 0);
    await b.idle();
    b.dispose();
    return g.getImageData(0, 0, bmp.width, bmp.height).data;
  };
  const a = await px(1.2);
  const b = await px(1.2);
  const later = await px(3.5);
  let maxSame = 0;
  let changed = 0;
  let opaque = 0;
  for (let i = 0; i < a.length; i++) {
    maxSame = Math.max(maxSame, Math.abs(a[i] - b[i]));
    if (Math.abs(a[i] - later[i]) > 8) changed++;
    if (i % 4 === 3 && a[i] > 200) opaque++;
  }
  return { maxSame, changedPct: (100 * changed) / a.length, opaquePct: (100 * opaque) / (a.length / 4) };
});
check('preview = export mid-animation', r.maxSame <= 1 && r.opaquePct > 99, `max Δ ${r.maxSame}, ${r.opaquePct.toFixed(0)}% opaque`);
check('animation changes the frame over time', r.changedPct > 1, `${r.changedPct.toFixed(1)}% of channels changed between 1.2 s and 3.5 s`);

await page.evaluate(() => window.__glyphix.setTime(1.25));
await page.waitForTimeout(400);
await page.screenshot({ path: `${out}/motion-mid.png` });

console.log(errors.length ? `page errors:\n${errors.slice(0, 10).join('\n')}` : 'no page errors');
if (errors.length) failures++;
await browser.close();
process.exit(failures ? 1 : 0);
