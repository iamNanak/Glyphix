// Milestone F+ (F+2) end to end: ASCII glyphs. Any font (built-in, bundled mono, bundled proportional) with a
// custom charset renders identically on WebGPU and WebGL2 and on a fresh export backend (fonts load in
// prepare(), never a wrong-font frame); columns and the density threshold change the grid as read back; the
// inspector's font picker, custom characters field and missing-glyph note work by keyboard.
// Usage: node scripts/e2e-ascii-glyphs.mjs [baseUrl]
import { browserName, launch } from './browser.mjs';

const base = process.argv[2] ?? 'http://localhost:5173';
const browser = await launch();
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => (m.type() === 'error' || /leaked render targets/.test(m.text())) && errors.push(m.text()));
let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

await page.goto(base);
await page.waitForFunction(() => window.__glyphix && window.__glyphix.saveState() === 'saved');
await page.keyboard.press('Space'); // pause

await page.evaluate(async () => {
  const d = await import('/src/doc/index.ts');
  const mk = async (forceWebGL) => {
    const b = await window.__glyphix.render.createBackend({ canvas: document.createElement('canvas'), fullResAssets: true, forceWebGL });
    b.setSize(960, 540, 1);
    b.setView(null);
    return b;
  };
  const pixels = async (b, doc, t) => {
    const bmp = await window.__glyphix.render.renderFrameBitmap(b, doc, t);
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    const g = c.getContext('2d');
    g.drawImage(bmp, 0, 0);
    return g.getImageData(0, 0, bmp.width, bmp.height).data;
  };
  const diff = (a, b) => {
    let sum = 0;
    let max = 0;
    for (let i = 0; i < a.length; i++) {
      const v = Math.abs(a[i] - b[i]);
      sum += v;
      if (v > max) max = v;
    }
    return { mean: sum / a.length, max };
  };
  /** Demo doc with an ASCII adjustment layer (params, text overridden). */
  const doc = (params = {}, text = {}) => {
    const out = structuredClone(window.__glyphix.state().doc);
    const layer = d.createAdjustmentLayer('ascii');
    const e = layer.effects[0];
    for (const [k, v] of Object.entries(params)) e.params[k] = { static: v };
    Object.assign(e.text, text);
    out.comp.layers.push(layer);
    return { doc: out, id: e.id };
  };
  await window.__glyphix.fonts.loadAll(window.__glyphix.state().doc.comp.layers.flatMap((l) => (l.type === 'text' ? [l.fontId] : [])));
  window.__g = { d, mk, pixels, diff, doc, A: await mk(false), G: await mk(true) };
});

// --- Fonts × custom charset: WebGPU = WebGL2, and a fresh backend (font not loaded yet) draws the same frame.
const fonts = await page.evaluate(async () => {
  const { A, G, mk, pixels, diff, doc, d } = window.__g;
  const out = [];
  let builtin = null;
  for (const fontId of ['', 'geist-mono', 'fraunces']) {
    const { doc: dd } = doc({ charset: d.ASCII_CUSTOM_CHARSET, size: 18 }, { fontId, charset: ' .oO@#' });
    const fresh = await mk(false); // prepare() must load the font before the first frame
    const first = await pixels(fresh, dd, 1);
    fresh.dispose();
    const a = await pixels(A, dd, 1);
    const g = await pixels(G, dd, 1);
    if (fontId === '') builtin = a;
    out.push({ fontId: fontId || 'built-in', gl: diff(a, g).mean, fresh: diff(a, first).max, vsBuiltin: builtin && fontId ? diff(a, builtin).mean : null });
  }
  return out;
});
for (const f of fonts) console.log(`  ${f.fontId.padEnd(10)} WebGPU↔WebGL2 mean Δ ${f.gl.toFixed(3)}; fresh backend max Δ ${f.fresh}; vs built-in mean Δ ${f.vsBuiltin?.toFixed(2) ?? '—'}`);
check('3 fonts × custom charset: WebGPU ≈ WebGL2 (mean Δ < 0.1)', fonts.every((f) => f.gl < 0.1));
check('first frame on a fresh backend already uses the font (max Δ 0)', fonts.every((f) => f.fresh === 0));
check('other fonts look different from the built-in one', fonts.slice(1).every((f) => f.vsBuiltin > 1));

// --- Grid read back: columns, cell shape, density threshold, charset.
const grid = await page.evaluate(async () => {
  const { A, d, doc } = window.__g;
  const cap = async (params, text) => {
    const { doc: dd, id } = doc(params, text);
    A.setSize(dd.comp.width / 2, dd.comp.height / 2, 1);
    const list = d.evaluate(dd, 1);
    await A.prepare(list);
    const cells = await A.captureAscii(list, id);
    A.setSize(960, 540, 1);
    return cells;
  };
  const blanks = (c) => c.lines.join('').split('').filter((ch) => ch === ' ').length / (c.cols * c.rows);
  const cols120 = await cap({ columns: 120 });
  const square = await cap({ columns: 120, square: 1 });
  const lh2 = await cap({ columns: 120, lineHeight: 2.4 });
  const loose = await cap({ size: 20 });
  const strict = await cap({ size: 20, threshold: 0.6 });
  const custom = await cap({ charset: d.ASCII_CUSTOM_CHARSET, size: 20 }, { charset: ' xX' });
  return {
    cols120: [cols120.cols, cols120.rows, cols120.cellWidth],
    square: [square.cols, square.rows],
    lh2: [lh2.cols, lh2.rows],
    blanks: [blanks(loose), blanks(strict)],
    customChars: [...new Set(custom.lines.join(''))].sort().join(''),
  };
});
check('columns = 120 → 120 cells across, rows from the font shape (0.5 wide)', grid.cols120[0] === 120 && grid.cols120[1] === Math.ceil(1080 / 32), JSON.stringify(grid.cols120));
check('square cells → rows = columns × height / width', grid.square[0] === 120 && grid.square[1] === Math.ceil(1080 / 16), JSON.stringify(grid.square));
check('line height 2.4 → half as many rows', grid.lh2[1] === Math.ceil(1080 / 64), JSON.stringify(grid.lh2));
check('density threshold blanks the dark cells', grid.blanks[1] > grid.blanks[0] + 0.1, grid.blanks.map((v) => `${(v * 100).toFixed(1)}%`).join(' → '));
check('custom charset: only its glyphs (plus edge glyphs) appear', /^[ xX|\-/\\]+$/.test(grid.customChars), JSON.stringify(grid.customChars));

// --- Inspector: add ASCII to the screenshot layer, choose Custom, type characters, see the missing-glyph note.
const ui = await page.evaluate(async () => {
  const s = window.__glyphix.editor.getState();
  s.select('shot');
  return !!s.doc.comp.layers.find((l) => l.id === 'shot');
});
if (ui) {
  await page.getByRole('button', { name: 'Add effect' }).click();
  await page.getByRole('menuitem', { name: /^ASCII/ }).click();
  await page.getByRole('combobox', { name: 'ASCII characters' }).focus();
  await page.keyboard.press('Enter');
  await page.getByRole('option', { name: 'Custom' }).click();
  const field = page.getByRole('textbox', { name: 'ASCII custom characters' });
  await field.fill('');
  await field.pressSequentially(' .:Ж@');
  await page.waitForTimeout(200);
  const note = await page.getByText(/Not in this font/).textContent().catch(() => '');
  const fx = await page.evaluate(() => window.__glyphix.state().doc.comp.layers.find((l) => l.id === 'shot').effects.at(-1));
  check('custom characters typed by keyboard', fx.text.charset === ' .:Ж@' && fx.params.charset.static === 4, JSON.stringify(fx.text));
  // The built-in font embeds only the preset glyphs; others come from JetBrains Mono, which has Cyrillic.
  check('missing-glyph note only for glyphs the font lacks', !/Ж/.test(note ?? ''), note || 'no note');
  await field.pressSequentially('😀');
  await page.waitForTimeout(300);
  const note2 = await page.getByText(/Not in this font/).textContent().catch(() => '');
  check('a glyph the font lacks is reported', /😀/.test(note2 ?? ''), note2 || 'no note');
  await page.getByRole('combobox', { name: 'ASCII look preset' }).click();
  await page.getByRole('option', { name: 'Matrix' }).click();
  await page.waitForTimeout(200);
  const looked = await page.evaluate(() => window.__glyphix.state().doc.comp.layers.find((l) => l.id === 'shot').effects.at(-1));
  check('look preset applies (Matrix) and the picker resets', looked.params.charset.static !== 4 && (await page.getByRole('combobox', { name: 'ASCII look preset' }).textContent()).includes('Apply a look'), JSON.stringify(looked.colors.ink));
} else check('demo doc has the screenshot layer', false);

check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
console.log(failures ? `\n${failures} FAILED (${browserName})` : `\nALL PASSED (${browserName})`);
await browser.close();
process.exit(failures ? 1 : 0);
