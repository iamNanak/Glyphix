import { describe, expect, it } from 'vitest';
import { gunzipSync, strFromU8, unzipSync } from 'fflate';
import { createAdjustmentLayer, createDemoDoc, type Doc } from '@/doc';
import { buildHtmlPlayer, buildJson, buildReactZip, buildTxtZip, defaultAsciiEffect, estimateAsciiBytes, listAsciiEffects, txtFrameName, type AsciiSequence } from './asciiText';

const seq = (color: boolean): AsciiSequence => ({
  cols: 3,
  rows: 2,
  fps: 10,
  cellWidth: 8,
  cellHeight: 12,
  mono: !color,
  style: { family: 'GlyphixAscii', weight: 500, lineHeight: 1.2, ink: '#ffffff', background: 'rgba(0,0,0,1.000)' },
  frames: [
    { lines: ['ab ', '#@.'], ...(color ? { colors: ['ff0000'.repeat(3), '00ff00'.repeat(3)] } : {}) },
    { lines: ['   ', '...'], ...(color ? { colors: ['000000'.repeat(3), '0000ff'.repeat(3)] } : {}) },
  ],
});

describe('ASCII text outputs', () => {
  it('names frames from 0001 with at least four digits', () => {
    expect(txtFrameName(0, 10)).toBe('frame-0001.txt');
    expect(txtFrameName(11, 12)).toBe('frame-0012.txt');
    expect(txtFrameName(0, 123456)).toBe('frame-000001.txt');
  });

  it('puts one text file per frame in the zip', () => {
    const files = unzipSync(buildTxtZip(seq(false)));
    expect(Object.keys(files)).toEqual(['frame-0001.txt', 'frame-0002.txt']);
    expect(strFromU8(files['frame-0001.txt']!)).toBe('ab \n#@.\n');
  });

  it('writes the JSON shape, with colours only for colour sequences', () => {
    const mono = JSON.parse(buildJson(seq(false)));
    expect(Object.keys(mono)).toEqual(['cols', 'rows', 'fps', 'cellWidth', 'cellHeight', 'frames']);
    expect(mono.frames[0]).toEqual({ lines: ['ab ', '#@.'] });
    const color = JSON.parse(buildJson(seq(true)));
    expect(color.frames[1].colors).toEqual(['000000'.repeat(3), '0000ff'.repeat(3)]);
  });

  it('builds a self-contained HTML player whose data decodes back to the frames', () => {
    const html = buildHtmlPlayer(seq(true), { font: new Uint8Array([1, 2, 3]), audio: null }, 'My <clip>');
    expect(html).toContain('<title>My &lt;clip&gt;</title>');
    expect(html).toContain('DecompressionStream');
    expect(html).not.toMatch(/(src|href)="http/);
    const b64 = /id="d">([^<]+)</.exec(html)![1]!;
    const json = JSON.parse(strFromU8(gunzipSync(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)))));
    expect(json.frames).toEqual(seq(true).frames);
    expect(json.mono).toBe(false);
  });

  it('adds the audio script and file only when there is sound', () => {
    const silent = buildHtmlPlayer(seq(false), { font: new Uint8Array(1), audio: null }, 't');
    const loud = buildHtmlPlayer(seq(false), { font: new Uint8Array(1), audio: { bytes: new Uint8Array([9]), mime: 'audio/webm', ext: 'webm' } }, 't');
    expect(silent).not.toContain('id="s"');
    expect(loud).toContain('id="s"');
    expect(Object.keys(unzipSync(buildReactZip(seq(false), { font: new Uint8Array(1), audio: null })))).not.toContain('ascii-audio.webm');
  });

  it('zips the React component with its data, engine, types and font', () => {
    const files = unzipSync(buildReactZip(seq(false), { font: new Uint8Array(4), audio: { bytes: new Uint8Array(2), mime: 'audio/webm', ext: 'webm' } }));
    expect(Object.keys(files).sort()).toEqual(['AsciiPlayer.tsx', 'ascii-audio.webm', 'ascii-data.ts', 'ascii-font.ttf', 'ascii-player-engine.d.ts', 'ascii-player-engine.js']);
    expect(strFromU8(files['AsciiPlayer.tsx']!)).toContain('export function AsciiPlayer');
    expect(strFromU8(files['ascii-data.ts']!)).toContain('"lines":["ab ","#@."]');
  });
});

describe('size estimate', () => {
  const base = { cols: 160, rows: 90, frames: 240, color: false, fontBytes: 187_208, audioSeconds: 0 };
  it('grows with frames, colour and sound', () => {
    const a = estimateAsciiBytes({ ...base, output: 'html' });
    expect(estimateAsciiBytes({ ...base, frames: 480, output: 'html' })).toBeGreaterThan(a);
    expect(estimateAsciiBytes({ ...base, color: true, output: 'html' })).toBeGreaterThan(a * 2);
    expect(estimateAsciiBytes({ ...base, audioSeconds: 10, output: 'html' })).toBeGreaterThan(a + 100_000);
  });
  it('JSON is the raw text plus colours', () => {
    const mono = estimateAsciiBytes({ ...base, output: 'json' });
    expect(mono).toBeGreaterThan(240 * 90 * 161);
    expect(estimateAsciiBytes({ ...base, color: true, output: 'json' })).toBeGreaterThan(mono * 5);
  });
  it('a zip is smaller than the raw text', () => {
    expect(estimateAsciiBytes({ ...base, output: 'txt-zip' })).toBeLessThan(240 * 90 * 161);
  });
});

describe('listing ASCII effects', () => {
  const docWith = (): Doc => {
    const doc = createDemoDoc();
    doc.comp.layers.push(createAdjustmentLayer('ascii'), createAdjustmentLayer('ascii'));
    return doc;
  };
  it('lists them topmost first and defaults to the topmost enabled one', () => {
    const doc = docWith();
    const refs = listAsciiEffects(doc);
    expect(refs).toHaveLength(2);
    expect(refs[0]!.layerId).toBe(doc.comp.layers[doc.comp.layers.length - 1]!.id);
    expect(defaultAsciiEffect(doc)!.effect.id).toBe(refs[0]!.effect.id);
    doc.comp.layers[doc.comp.layers.length - 1]!.effects[0]!.enabled = false;
    const after = listAsciiEffects(doc);
    expect(after[0]!.label).toMatch(/\(off\)$/);
    expect(defaultAsciiEffect(doc)!.effect.id).toBe(after[1]!.effect.id);
  });
  it('is empty for a doc without ASCII', () => expect(listAsciiEffects(createDemoDoc())).toEqual([]));
});
