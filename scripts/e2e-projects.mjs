// Projects + .glyphix files: new, recent list, save file, open in a fresh profile (identical doc
// and images), open again as a copy, delete. Usage: node scripts/e2e-projects.mjs [baseUrl] [outDir]
import { readFileSync } from 'node:fs';
import { launch } from './browser.mjs';

const base = process.argv[2] ?? 'http://localhost:5173';
const out = process.argv[3] ?? '.';
const browser = await launch();
let failures = 0;
const errors = [];
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

async function freshPage() {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('dialog', (d) => d.accept()); // confirm() for deletes
  await page.goto(base);
  await page.waitForFunction(() => window.__glyphix && document.querySelector('[aria-label="Project name"]'));
  await page.waitForFunction(() => window.__glyphix.saveState() === 'saved');
  return page;
}
const docOf = (page) => page.evaluate(() => window.__glyphix.state().doc);
const projects = (page) => page.getByRole('list', { name: 'Recent projects' }).getByRole('listitem');

// --- Profile A: demo project + a new one.
const a = await freshPage();
await a.getByLabel('Project name').fill('Launch visual');
await a.keyboard.press('Enter');
await a.evaluate(() => window.__glyphix.select('shot'));
await a.getByRole('group', { name: 'Enter animation' }).getByRole('button', { name: '3D tilt in', exact: true }).click();
await a.keyboard.press('Control+s');
await a.waitForFunction(() => window.__glyphix.saveState() === 'saved');
const launchDoc = await docOf(a);

await a.getByRole('button', { name: 'Projects' }).click();
await a.getByRole('button', { name: 'New project' }).click();
await a.waitForFunction((id) => window.__glyphix.state().doc.id !== id, launchDoc.id);
const blank = await docOf(a);
check('new project is blank with a rising headline', blank.comp.layers.length === 2 && blank.comp.layers[1].motion.enter?.preset === 'rise');
await a.getByRole('button', { name: 'Projects' }).click();
await a.waitForTimeout(300);
check('recent list shows both projects', (await projects(a).count()) === 2);

// Re-open the first project from the list.
await a.getByRole('button', { name: 'Open Launch visual' }).click();
await a.waitForFunction((id) => window.__glyphix.state().doc.id === id, launchDoc.id);
check('reopening from the list restores it', JSON.stringify(await docOf(a)) === JSON.stringify(launchDoc));

// Save as a .glyphix file (Ctrl+Shift+S → download).
const [download] = await Promise.all([a.waitForEvent('download'), a.keyboard.press('Control+Shift+s')]);
const path = `${out}/${download.suggestedFilename()}`;
await download.saveAs(path);
check('save downloads a .glyphix file', download.suggestedFilename() === 'Launch visual.glyphix', `${(readFileSync(path).length / 1024).toFixed(0)} KB`);

// --- Profile B (empty storage): open the file.
const b = await freshPage();
const input = b.locator('input[type=file]');
await input.setInputFiles(path);
await b.waitForFunction((id) => window.__glyphix.state().doc.id === id, launchDoc.id, { timeout: 15000 });
const opened = await docOf(b);
check('opening the file in a fresh profile gives the identical document', JSON.stringify(opened) === JSON.stringify(launchDoc));
const imgs = launchDoc.comp.layers.filter((l) => l.type === 'image').map((l) => l.assetId);
check('…with its images', await b.evaluate((ids) => ids.every((id) => window.__glyphix.assets().includes(id)), imgs), imgs.join(','));
await b.reload();
await b.waitForFunction(() => window.__glyphix && document.querySelector('[aria-label="Project name"]'));
check('the opened project persists across reload', (await docOf(b)).id === launchDoc.id);

// Opening the same file again makes a copy instead of overwriting.
await b.locator('input[type=file]').setInputFiles(path);
await b.waitForFunction((id) => window.__glyphix.state().doc.id !== id, launchDoc.id, { timeout: 15000 });
check('opening it again opens a copy', (await docOf(b)).name === 'Launch visual (copy)');

// Delete the copy from the dialog.
await b.getByRole('button', { name: 'Projects' }).click();
await b.waitForTimeout(300);
const before = await projects(b).count();
await b.getByRole('button', { name: 'Delete Launch visual (copy)' }).click({ force: true });
await b.waitForFunction((id) => window.__glyphix.state().doc.id === id, launchDoc.id, { timeout: 10000 });
await b.getByRole('button', { name: 'Projects' }).click();
await b.waitForTimeout(300);
check('deleting the open project switches to the remaining one', (await projects(b).count()) === before - 1);

// A broken file shows a readable error instead of crashing.
await b.keyboard.press('Escape');
await b.locator('input[type=file]').setInputFiles({ name: 'broken.glyphix', mimeType: 'application/zip', buffer: Buffer.from('not a zip') });
const alert = await b.getByRole('alert').textContent({ timeout: 5000 }).catch(() => '');
check('a broken file shows a readable error', /couldn't be unzipped/.test(alert), alert);

console.log(errors.length ? `page errors:\n${errors.slice(0, 10).join('\n')}` : 'no page errors');
if (errors.length) failures++;
await browser.close();
process.exit(failures ? 1 : 0);
