// Timeline panel end to end: layer bars (move, trim, preset strips), keyboard equivalents, one undo step per
// drag, in/out points in the renderer (presets follow the layer; GPU glyph animations included).
// Usage: node scripts/e2e-timeline.mjs [baseUrl] [outDir]
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
const near = (a, b) => Math.abs(a - b) < 1e-6;
const undo = async () => {
  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.press('Control+z');
};

await page.goto(base);
await page.waitForFunction(() => window.__glyphix);
await page.waitForTimeout(1000);
await page.evaluate(() => window.__glyphix.editor.getState().setPlaying(false));

const tracks = page.getByRole('region', { name: 'Timeline tracks' });
const bar = tracks.getByRole('button', { name: /^Headline: on screen/ });
check('timeline shows a bar per layer', (await tracks.getByRole('button', { name: /: on screen/ }).count()) === 2);

// Pixels per second from the bar (the headline spans the whole 5 s comp).
let box = await bar.boundingBox();
const pps = box.width / 5;
const drag = async (x, y, dx) => {
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(x + (dx * i) / 8, y);
  await page.mouse.up();
};

// --- Trim the out point 1 s earlier (right edge), then the in point 0.5 s later (left edge).
await drag(box.x + box.width - 2, box.y + 6, -pps);
let h = await layer('headline');
check('drag right edge trims the out point', near(h.timing.out, 4) && h.timing.in === 0, JSON.stringify(h.timing));
box = await bar.boundingBox();
await drag(box.x + 2, box.y + 6, pps / 2);
h = await layer('headline');
check('drag left edge trims the in point', near(h.timing.in, 0.5) && near(h.timing.out, 4), JSON.stringify(h.timing));
check('outside [in, out) the layer is not drawn', await page.evaluate(async () => {
  const { evaluate } = await import('/src/doc/evaluate.ts');
  const doc = window.__glyphix.state().doc;
  const has = (t) => evaluate(doc, t).items.some((i) => i.id === 'headline');
  return !has(0.4) && has(0.5) && has(3.9) && !has(4);
}));

// --- Move the whole bar 1 s right: in/out and the custom glyph animator move with it; one undo step.
const before = await layer('headline');
box = await bar.boundingBox();
await drag(box.x + box.width / 2, box.y + 8, pps);
h = await layer('headline');
check('drag bar moves in/out', near(h.timing.in, 1.5) && h.timing.out === null, JSON.stringify(h.timing));
check('moving carries the custom glyph animator', near(h.animator.start, before.animator.start + 1), `${before.animator.start} → ${h.animator.start}`);
await undo();
h = await layer('headline');
check('one undo reverts the whole drag', near(h.timing.in, 0.5) && near(h.timing.out, 4) && near(h.animator.start, before.animator.start), JSON.stringify(h.timing));

// --- Keyboard: arrows on the focused bar nudge by frames (one undo step); Alt+[ / Alt+] trim to the playhead.
await bar.focus();
for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight');
await page.keyboard.press('Shift+ArrowRight');
h = await layer('headline');
check('arrow keys nudge the bar by frames (Shift = 10)', near(h.timing.in, 0.5 + 13 / 30), JSON.stringify(h.timing));
await undo();
h = await layer('headline');
check('nudges coalesce into one undo step', near(h.timing.in, 0.5), JSON.stringify(h.timing));
await page.evaluate(() => window.__glyphix.select('headline'));
await page.evaluate(() => window.__glyphix.setTime(1));
await page.keyboard.press('Alt+BracketLeft');
await page.evaluate(() => window.__glyphix.setTime(3));
await page.keyboard.press('Alt+BracketRight');
h = await layer('headline');
check('Alt+[ / Alt+] trim in / out to the playhead', near(h.timing.in, 1) && near(h.timing.out, 3), JSON.stringify(h.timing));

// --- Preset strips: an enter preset shows as a strip; dragging it moves the preset start.
await page.evaluate(() => window.__glyphix.editor.getState().set('t', [{ path: ['comp', 'layers', 2, 'timing'], value: { in: 0, out: null } }]));
await page.getByRole('group', { name: 'Enter animation' }).getByRole('button', { name: 'Rise', exact: true }).click();
const strip = bar.locator('[data-part="enter"]');
h = await layer('headline');
const start0 = h.motion.enter.start;
const sb = await strip.boundingBox();
await drag(sb.x + sb.width / 2, sb.y + sb.height / 2, pps / 2);
h = await layer('headline');
check('drag enter strip moves the preset start', near(h.motion.enter.start, start0 + 0.5), `${start0} → ${h.motion.enter.start}`);
const lb = await bar.locator('[data-part="enter-length"]').boundingBox();
const dur0 = h.motion.enter.duration;
await drag(lb.x + lb.width / 2, lb.y + lb.height / 2, pps / 2);
h = await layer('headline');
check('drag its end changes the preset length', near(h.motion.enter.duration, dur0 + 0.5), `${dur0} → ${h.motion.enter.duration}`);

// --- Panel: collapse / expand, keyboard resize.
await page.getByRole('button', { name: 'Collapse timeline' }).click();
check('collapse hides the tracks', (await tracks.count()) === 0);
await page.getByRole('button', { name: 'Expand timeline' }).click();
const sep = page.getByRole('separator', { name: 'Resize timeline' });
const h0 = Number(await sep.getAttribute('aria-valuenow'));
await sep.focus();
await page.keyboard.press('ArrowUp');
check('expand + keyboard resize', (await tracks.count()) === 1 && Number(await sep.getAttribute('aria-valuenow')) === h0 + 24);
await sep.press('ArrowDown');

// --- Renderer: presets follow the in/out points (GPU per-glyph animation), and a layer before its in point is
// not drawn. Fresh blank project: gradient + a headline with the per-glyph "rise" enter preset.
const r = await page.evaluate(async () => {
  const { createBlankDoc, applyPatches, defaultExit } = await import('/src/doc/index.ts');
  const { createBackend, renderFrameBitmap } = window.__glyphix.render;
  const i = 1; // headline
  const base = createBlankDoc('t');
  const at = (doc, ...p) => applyPatches(doc, p.map(([path, value]) => ({ path: ['comp', 'layers', i, ...path], value })));
  const px = async (doc, t) => {
    const b = await createBackend({ canvas: document.createElement('canvas'), fullResAssets: true });
    b.setSize(640, 360, 1);
    await renderFrameBitmap(b, doc, t);
    const bmp = await renderFrameBitmap(b, doc, t);
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    c.getContext('2d').drawImage(bmp, 0, 0);
    await b.idle();
    b.dispose();
    return c.getContext('2d').getImageData(0, 0, bmp.width, bmp.height).data;
  };
  const diff = (a, b) => {
    let m = 0;
    let n = 0;
    for (let k = 0; k < a.length; k++) {
      const d = Math.abs(a[k] - b[k]);
      m = Math.max(m, d);
      if (d > 8) n++;
    }
    return { max: m, changed: n };
  };
  const late = at(base, [['timing'], { in: 1, out: null }]);
  const hidden = at(base, [['visible'], false]);
  const exitAtCut = at(base, [['timing'], { in: 0, out: 3 }], [['motion', 'exit'], defaultExit('sink')]);
  const exitAtEnd = at({ ...base, comp: { ...base.comp, duration: 3 } }, [['motion', 'exit'], defaultExit('sink')]);
  return {
    enter: diff(await px(base, 0.45), await px(late, 1.45)),
    moving: diff(await px(base, 0.45), await px(base, 0.6)),
    beforeIn: diff(await px(late, 0.9), await px(hidden, 0.9)),
    exit: diff(await px(exitAtCut, 2.7), await px(exitAtEnd, 2.7)),
    afterOut: diff(await px(exitAtCut, 3.2), await px(hidden, 3.2)),
  };
});
check('GPU glyph enter follows the in point (preview = export)', r.enter.max <= 1 && r.moving.changed > 100, `Δ ${r.enter.max}; animation moves ${r.moving.changed} channels in 0.15 s`);
check('before the in point the layer is absent', r.beforeIn.max <= 1, `Δ ${r.beforeIn.max}`);
check('GPU glyph exit ends at the out point', r.exit.max <= 1, `Δ ${r.exit.max}`);
check('after the out point the layer is absent', r.afterOut.max <= 1, `Δ ${r.afterOut.max}`);

await page.screenshot({ path: `${out}/timeline.png` });
console.log(errors.length ? `page errors:\n${errors.slice(0, 10).join('\n')}` : 'no page errors');
if (errors.length) failures++;
await browser.close();
process.exit(failures ? 1 : 0);
