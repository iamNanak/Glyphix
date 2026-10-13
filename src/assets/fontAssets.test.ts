import { zlibSync } from 'fflate';
import interDataUrl from '../../public/fonts/Inter.ttf?inline';
import { describe, expect, it } from 'vitest';
import { FontFileError, importFont, woffToSfnt } from './fontAssets';

const ttf = Uint8Array.from(atob(interDataUrl.slice(interDataUrl.indexOf(',') + 1)), (c) => c.charCodeAt(0));
const same = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i]);

interface Table {
  tag: number;
  checksum: number;
  data: Uint8Array;
}

function sfntTables(b: Uint8Array): Table[] {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const n = dv.getUint16(4);
  return Array.from({ length: n }, (_, i) => {
    const at = 12 + i * 16;
    const offset = dv.getUint32(at + 8);
    return { tag: dv.getUint32(at), checksum: dv.getUint32(at + 4), data: b.subarray(offset, offset + dv.getUint32(at + 12)) };
  });
}

/** Minimal WOFF 1.0 writer (the inverse of woffToSfnt), for the test only. */
function toWoff(sfnt: Uint8Array): Uint8Array {
  const tables = sfntTables(sfnt).map((t) => {
    const z = zlibSync(t.data);
    return { ...t, comp: z.length < t.data.length ? z : t.data };
  });
  const dirEnd = 44 + tables.length * 20;
  const size = tables.reduce((n, t) => n + ((t.comp.length + 3) & ~3), dirEnd);
  const out = new Uint8Array(size);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0x774f4646); // 'wOFF'
  dv.setUint32(4, new DataView(sfnt.buffer, sfnt.byteOffset).getUint32(0));
  dv.setUint32(8, size);
  dv.setUint16(12, tables.length);
  let offset = dirEnd;
  tables.forEach((t, i) => {
    const at = 44 + i * 20;
    dv.setUint32(at, t.tag);
    dv.setUint32(at + 4, offset);
    dv.setUint32(at + 8, t.comp.length);
    dv.setUint32(at + 12, t.data.length);
    dv.setUint32(at + 16, t.checksum);
    out.set(t.comp, offset);
    offset += (t.comp.length + 3) & ~3;
  });
  return out;
}

describe('font files', () => {
  it('WOFF unpacks to the same tables as the original TTF', () => {
    const woff = toWoff(ttf);
    expect(woff.length).toBeLessThan(ttf.length);
    const back = sfntTables(woffToSfnt(woff));
    const orig = sfntTables(ttf);
    expect(back.map((t) => t.tag)).toEqual(orig.map((t) => t.tag));
    back.forEach((t, i) => expect(same(t.data, orig[i]!.data)).toBe(true));
  });

  it('rejects damaged WOFF, WOFF2 and non-fonts with a readable message', async () => {
    const woff = toWoff(ttf);
    expect(() => woffToSfnt(woff.subarray(0, 200))).toThrow(FontFileError);
    await expect(importFont(new Blob([new Uint8Array([0x77, 0x4f, 0x46, 0x32, 0, 0, 0, 0, 0, 0, 0, 0])]))).rejects.toThrow(/WOFF2/);
    await expect(importFont(new Blob(['hello, this is not a font']))).rejects.toThrow(/font file/);
  });
});
