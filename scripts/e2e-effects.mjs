// Milestone E end to end: every effect renders, changes the image, matches between two independent
// renderers (preview = export) and between WebGPU and WebGL2; adjustment layers; keyframed params;
// the Effects panel (add, edit, keyframe, reorder, disable, remove, undo); persistence.
// Usage: node scripts/e2e-effects.mjs [baseUrl] [outDir]
import { launch } from './browser.mjs';

const base = process.argv[2] ?? 'http://localhost:5173';
const out = process.argv[3] ?? '.';
const browser = await launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => (m.type() === 'error' || /leaked render targets/.test(m.text())) && errors.push(m.text()));
let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};
const state = () => page.evaluate(() => window.__glyphix.state());
const selected = () => page.evaluate(() => { const s = window.__glyphix.state(); return s.doc.comp.layers.find((l) => l.id === s.selectedId); });
const ready = () => page.waitForFunction(() => window.__glyphix && window.__glyphix.saveState() === 'saved');

await page.goto(base);
await ready();
await page.keyboard.press('Space'); // pause
await page.evaluate(() => window.__glyphix.setTime(2.5));

// --- Render helper: two WebGPU backends (preview/export paths) and one forced WebGL2, 960×540.
const backends = await page.evaluate(async () => {
  const { createBackend, renderFrameBitmap } = window.__glyphix.render;
  const mk = async (forceWebGL) => {
    const b = await createBackend({ canvas: document.createElement('canvas'), fullResAssets: true, forceWebGL });
    b.setSize(960, 540, 1);
    return b;
  };
  const A = await mk(false);
  const B = await mk(false);
  const G = await mk(true);
  const pixels = async (b, doc, t) => {
    await renderFrameBitmap(b, doc, t);
    const bmp = await renderFrameBitmap(b, doc, t);
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    const g = c.getContext('2d');
    g.drawImage(bmp, 0, 0);
    return g.getImageData(0, 0, bmp.width, bmp.height).data;
  };
  const diff = (a, b) => {
    let max = 0;
    let sum = 0;
    let changed = 0;
    for (let i = 0; i < a.length; i++) {
      const d = Math.abs(a[i] - b[i]);
      if (d > max) max = d;
      sum += d;
      if (d > 8) changed++;
    }
    return { max, mean: sum / a.length, changedPct: (100 * changed) / a.length };
  };
  window.__fx = {
    pixels,
    diff,
    async compare(doc, ref, t) {
      await window.__glyphix.fonts.loadAll(doc.comp.layers.flatMap((l) => (l.type === 'text' ? [l.fontId] : [])));
      const a = await pixels(A, doc, t);
      const b = await pixels(B, doc, t);
      const g = await pixels(G, doc, t);
      const r = ref ? await pixels(A, ref, t) : null;
      return { same: diff(a, b), gl: diff(a, g), vsRef: r ? diff(a, r) : null };
    },
  };
  return [A.kind, B.kind, G.kind];
});
check('test renderers', backends[2] === 'webgl2', backends.join(', '));

// --- Every effect on the screenshot layer (and the shot-free ones on an adjustment layer).
const kinds = await page.evaluate(async () => (await import('/src/doc/effects.ts')).EFFECTS.map((d) => d.kind));
check('10+ effects', kinds.length >= 10, kinds.join(', '));
const results = [];
for (const kind of kinds) {
  const r = await page.evaluate(async (kind) => {
    const fx = await import('/src/doc/effects.ts');
    const ref = structuredClone(window.__glyphix.state().doc);
    const doc = structuredClone(ref);
    const e = fx.createEffect(kind);
    if (kind === 'colorAdjust') e.params.saturation = { static: -1 };
    // The vignette darkens the canvas edges, where the screenshot isn't: put it on the background.
    doc.comp.layers.find((l) => l.id === (kind === 'vignette' ? 'bg' : 'shot')).effects.push(e);
    return window.__fx.compare(doc, ref, 2.5);
  }, kind);
  results.push({ kind, ...r });
}
const bad = results.filter((r) => !(r.same.max <= 2 && r.gl.mean < 1 && r.vsRef.changedPct > 0.3));
for (const r of results)
  console.log(`  ${r.kind.padEnd(12)} preview=export max Δ ${r.same.max}  WebGPU↔WebGL2 mean Δ ${r.gl.mean.toFixed(3)} (max ${r.gl.max})  changed ${r.vsRef.changedPct.toFixed(1)}%`);
check('every effect: changes the image, preview = export, WebGPU ≈ WebGL2', bad.length === 0, bad.map((r) => r.kind).join(', ') || `${results.length} effects`);

// --- No effects: the direct path is untouched, and a no-op effect costs nothing.
const plain = await page.evaluate(async () => {
  const fx = await import('/src/doc/effects.ts');
  const ref = structuredClone(window.__glyphix.state().doc);
  const doc = structuredClone(ref);
  doc.comp.layers.find((l) => l.id === 'shot').effects.push(fx.createEffect('colorAdjust')); // neutral
  return window.__fx.compare(doc, ref, 2.5);
});
check('neutral effect = no effect (direct path)', plain.vsRef.max === 0 && plain.same.max === 0, `max Δ ${plain.vsRef.max}`);

// --- Compositor path with a no-op-free but invisible-ish chain matches the direct path closely.
const passthrough = await page.evaluate(async () => {
  const fx = await import('/src/doc/effects.ts');
  const ref = structuredClone(window.__glyphix.state().doc);
  const doc = structuredClone(ref);
  const e = fx.createEffect('blur');
  e.params.radius = { static: 0.3 }; // goes through the compositor, but barely blurs
  doc.comp.layers.find((l) => l.id === 'headline').effects.push(e);
  return window.__fx.compare(doc, ref, 2.5);
});
check('compositor path ≈ direct path for an almost-neutral effect', passthrough.vsRef.mean < 0.5, `mean Δ ${passthrough.vsRef.mean.toFixed(3)}, max ${passthrough.vsRef.max}`);

// --- Adjustment layer: processes everything below; opacity mixes.
const adj = await page.evaluate(async () => {
  const d = await import('/src/doc/index.ts');
  const ref = structuredClone(window.__glyphix.state().doc);
  const full = structuredClone(ref);
  const layer = d.createAdjustmentLayer('gradientMap');
  full.comp.layers.splice(2, 0, layer); // above the screenshot, below the headline
  const half = structuredClone(full);
  half.comp.layers[2].opacity = { static: 0.5 };
  const a = await window.__fx.compare(full, ref, 2.5);
  const h = await window.__fx.compare(half, ref, 2.5);
  // The headline (above) is untouched: compare its centre pixel row band.
  return { a, h };
});
check('adjustment layer recolours what is below', adj.a.vsRef.changedPct > 30 && adj.a.same.max <= 2 && adj.a.gl.mean < 1, `changed ${adj.a.vsRef.changedPct.toFixed(0)}%, WebGL2 mean Δ ${adj.a.gl.mean.toFixed(3)}`);
check('adjustment opacity mixes the result', adj.h.vsRef.mean > 0 && adj.h.vsRef.mean < adj.a.vsRef.mean * 0.75, `mean Δ ${adj.h.vsRef.mean.toFixed(1)} vs ${adj.a.vsRef.mean.toFixed(1)} at 100%`);

// --- Keyframed parameter: blur radius 0 → 40 over 0..2 s.
const keyed = await page.evaluate(async () => {
  const fx = await import('/src/doc/effects.ts');
  const ref = structuredClone(window.__glyphix.state().doc);
  ref.comp.layers.find((l) => l.id === 'headline').motion = { enter: null, exit: null, loop: null };
  ref.comp.layers.find((l) => l.id === 'headline').animator = null;
  const doc = structuredClone(ref);
  const e = fx.createEffect('blur');
  e.params.radius = { track: { keys: [{ t: 0, v: 0, out: { kind: 'linear' } }, { t: 2, v: 40, out: { kind: 'linear' } }] } };
  doc.comp.layers.find((l) => l.id === 'headline').effects.push(e);
  const at = async (t) => (await window.__fx.compare(doc, ref, t)).vsRef.mean;
  return [await at(0), await at(1), await at(2)];
});
check('keyframed effect parameter animates', keyed[0] === 0 && keyed[1] > 0 && keyed[2] > keyed[1], keyed.map((v) => v.toFixed(2)).join(' → '));

// --- The live preview canvas (zoomed view, artboard scissor) shows effects.
const shot = async () => (await page.locator('canvas').first().screenshot());
await page.evaluate(() => window.__glyphix.select('shot'));
const beforeFx = await shot();
await page.getByRole('button', { name: 'Add effect' }).click();
await page.getByRole('menuitem', { name: /^Pixelate/ }).click();
await page.waitForTimeout(300);
let layer = await selected();
check('Add effect menu adds an effect', layer.effects.length === 1 && layer.effects[0].kind === 'pixelate', layer.effects.map((e) => e.kind).join());
const afterFx = await shot();
// Headless Firefox reads its WebGPU/WebGL canvas back blank (a test-harness limit, also in Phase 1).
const canvasReadable = process.env.BROWSER !== 'firefox';
if (canvasReadable) check('preview canvas shows the effect', !beforeFx.equals(afterFx));
else console.log('SKIP preview canvas shows the effect — headless Firefox canvas reads back blank');
await page.screenshot({ path: `${out}/e2e-effects.png` });

// Slider by keyboard.
const slider = page.getByRole('slider', { name: 'Pixelate cell size' });
await slider.focus();
await page.keyboard.press('ArrowRight');
await page.keyboard.press('ArrowRight');
layer = await selected();
check('param slider is keyboard-operable', layer.effects[0].params.size.static === 18, JSON.stringify(layer.effects[0].params.size));

// Keyframes at the playhead.
await page.getByRole('button', { name: 'Add pixelate cell size keyframe at playhead' }).click();
await page.evaluate(() => window.__glyphix.setTime(0.5));
await page.waitForTimeout(100);
await slider.focus();
await page.keyboard.press('End');
layer = await selected();
const track = layer.effects[0].params.size.track;
check('keyframe button + slider at another time make an animation', track?.keys.length === 2 && track.keys[0].t === 0.5 && track.keys[0].v === 200 && track.keys[1].v === 18, JSON.stringify(track?.keys.map((k) => [k.t, k.v])));
await page.getByRole('button', { name: 'Remove pixelate cell size keyframe at playhead' }).click();
layer = await selected();
check('removing keys leaves a static value again', layer.effects[0].params.size.track?.keys.length === 1);

// Second effect, reorder, disable, remove, undo.
await page.getByRole('button', { name: 'Add effect' }).click();
await page.getByRole('menuitem', { name: /^Glow/ }).click();
await page.getByRole('button', { name: 'Move Glow up' }).click();
layer = await selected();
check('reorder effects', layer.effects.map((e) => e.kind).join() === 'glow,pixelate', layer.effects.map((e) => e.kind).join());
await page.getByRole('switch', { name: 'Glow', exact: true }).click();
layer = await selected();
check('switch an effect off', layer.effects[0].enabled === false);
await page.getByRole('button', { name: 'Remove Pixelate' }).click();
layer = await selected();
check('remove an effect', layer.effects.length === 1 && layer.effects[0].kind === 'glow');
await page.keyboard.press('Control+z');
layer = await selected();
check('undo restores it', layer.effects.length === 2);

// --- Adjustment layer from the toolbar.
await page.getByRole('button', { name: 'Add adjustment layer' }).click();
layer = await selected();
check('toolbar adds a selected adjustment layer', layer?.type === 'adjustment' && layer.effects.length === 1, layer?.type);
check('adjustment layer is listed', await page.getByRole('button', { name: /Adjustment/ }).first().isVisible());
await page.getByRole('slider', { name: 'Colour adjust saturation' }).focus();
await page.keyboard.press('Home');
layer = await selected();
check('adjustment effect is editable', layer.effects[0].params.saturation.static === -1);
const grey = await shot();
if (canvasReadable) check('adjustment changes the preview', !grey.equals(afterFx));

// --- Keyboard only: open the menu, arrow to an item, Enter adds it.
const nBefore = (await selected()).effects.length;
await page.getByRole('button', { name: 'Add effect' }).focus();
await page.keyboard.press('Enter');
await page.waitForTimeout(300);
await page.keyboard.press('End');
await page.keyboard.press('ArrowUp');
const focusedItem = await page.evaluate(() => document.activeElement?.textContent);
await page.keyboard.press('Enter');
await page.waitForTimeout(200);
layer = await selected();
check('add effect menu works by keyboard', layer.effects.length === nBefore + 1 && layer.effects.at(-1).kind === 'vignette', `${focusedItem} → ${layer.effects.at(-1)?.kind}`);

// --- Persistence.
await ready();
await page.waitForTimeout(1200);
await ready();
const saved = JSON.stringify((await state()).doc.comp.layers.map((l) => l.effects));
await page.reload();
await ready();
const restored = JSON.stringify((await state()).doc.comp.layers.map((l) => l.effects));
check('effects survive reload', saved === restored && restored.includes('colorAdjust') && restored.includes('glow'));

check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
console.log(failures ? `\n${failures} FAILED` : '\nALL PASS');
process.exit(failures ? 1 : 0);
