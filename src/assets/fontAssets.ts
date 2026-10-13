// Uploaded fonts. Like images, they are content-addressed assets: stored in IndexedDB with the
// project, written into .glyphix files, and restored by id. Files are untrusted input: format and
// size are checked, WOFF is unpacked to a plain sfnt, and HarfBuzz must be able to read the face.
import { unzlibSync } from 'fflate';
import { FONT_ASSET_PREFIX } from '@/doc/assets';
import { fontLibrary } from '@/text/fontLibrary';
import type { WeightRange } from '@/text/fonts';

export const MAX_FONT_BYTES = 30 * 1024 * 1024;
export const FONT_ACCEPT = '.ttf,.otf,.woff,font/ttf,font/otf,font/woff';

export class FontFileError extends Error {}

const blobs = new Map<string, Blob>();

const tag = (b: Uint8Array, at = 0) => String.fromCharCode(b[at]!, b[at + 1]!, b[at + 2]!, b[at + 3]!);

/** sfnt (TrueType / OpenType) flavour of a font file, or the reason it can't be used. */
function sniff(b: Uint8Array): 'ttf' | 'otf' | 'woff' | 'woff2' | null {
  if (b.length < 12) return null;
  const t = tag(b);
  if (t === 'wOFF') return 'woff';
  if (t === 'wOF2') return 'woff2';
  if (t === 'OTTO') return 'otf';
  if (t === 'true' || (b[0] === 0 && b[1] === 1 && b[2] === 0 && b[3] === 0)) return 'ttf';
  return null;
}

/** Unpack WOFF 1.0 into the sfnt it wraps (tables are zlib-compressed individually). */
export function woffToSfnt(woff: Uint8Array): Uint8Array {
  const dv = new DataView(woff.buffer, woff.byteOffset, woff.byteLength);
  const flavor = dv.getUint32(4);
  const numTables = dv.getUint16(12);
  if (numTables === 0 || numTables > 512 || 44 + numTables * 20 > woff.length) throw new FontFileError('The WOFF file is damaged.');
  const tables: { tag: number; checksum: number; data: Uint8Array }[] = [];
  for (let i = 0; i < numTables; i++) {
    const at = 44 + i * 20;
    const offset = dv.getUint32(at + 4);
    const compLength = dv.getUint32(at + 8);
    const origLength = dv.getUint32(at + 12);
    if (offset + compLength > woff.length || origLength > MAX_FONT_BYTES) throw new FontFileError('The WOFF file is damaged.');
    const raw = woff.subarray(offset, offset + compLength);
    const data = compLength < origLength ? unzlibSync(raw) : raw;
    if (data.length !== origLength) throw new FontFileError('The WOFF file is damaged.');
    tables.push({ tag: dv.getUint32(at), checksum: dv.getUint32(at + 16), data });
  }
  const headerSize = 12 + numTables * 16;
  const total = tables.reduce((n, t) => n + ((t.data.length + 3) & ~3), headerSize);
  const out = new Uint8Array(total);
  const ov = new DataView(out.buffer);
  const pow2 = 2 ** Math.floor(Math.log2(numTables));
  ov.setUint32(0, flavor);
  ov.setUint16(4, numTables);
  ov.setUint16(6, pow2 * 16);
  ov.setUint16(8, Math.log2(pow2));
  ov.setUint16(10, numTables * 16 - pow2 * 16);
  let offset = headerSize;
  tables.forEach((t, i) => {
    const at = 12 + i * 16;
    ov.setUint32(at, t.tag);
    ov.setUint32(at + 4, t.checksum);
    ov.setUint32(at + 8, offset);
    ov.setUint32(at + 12, t.data.length);
    out.set(t.data, offset);
    offset += (t.data.length + 3) & ~3;
  });
  return out;
}

async function sha256Hex(data: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', data as Uint8Array<ArrayBuffer>);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Register sfnt bytes under an id: shaping (HarfBuzz) + a CSS FontFace for UI previews. */
async function register(id: string, sfnt: Uint8Array, kind: 'ttf' | 'otf'): Promise<{ family: string; weights: WeightRange | null }> {
  const bytes = sfnt.slice().buffer;
  const meta = await fontLibrary.inspect(bytes);
  if (!meta) throw new FontFileError("This font file couldn't be read.");
  blobs.set(id, new Blob([bytes], { type: kind === 'otf' ? 'font/otf' : 'font/ttf' }));
  fontLibrary.registerUserFont(id, meta.family, bytes, meta.weights);
  if (typeof document !== 'undefined' && typeof FontFace !== 'undefined') {
    try {
      const face = new FontFace(cssFamily(id), bytes, meta.weights ? { weight: `${meta.weights.min} ${meta.weights.max}` } : {});
      document.fonts.add(await face.load());
    } catch {
      // Previews fall back to the system font; rendering uses HarfBuzz and is unaffected.
    }
  }
  return meta;
}

/** CSS font-family under which an uploaded font is available to the UI. */
export const cssFamily = (id: string) => `glyphix-${id}`;

export interface ImportedFont {
  id: string;
  family: string;
  reused: boolean;
}

/** Import a font file the user picked or dropped. */
export async function importFont(file: Blob): Promise<ImportedFont> {
  if (file.size > MAX_FONT_BYTES) throw new FontFileError('This font file is too large (over 30 MB).');
  let bytes = new Uint8Array(await file.arrayBuffer());
  const kind = sniff(bytes);
  if (kind === 'woff2') throw new FontFileError('WOFF2 fonts aren’t supported yet. Use the TTF or OTF version of the font.');
  if (!kind) throw new FontFileError('This isn’t a font file Glyphix can read (use TTF, OTF or WOFF).');
  if (kind === 'woff') bytes = woffToSfnt(bytes) as Uint8Array<ArrayBuffer>;
  const flavor = sniff(bytes) === 'otf' ? 'otf' : 'ttf';
  const id = `${FONT_ASSET_PREFIX}${(await sha256Hex(bytes)).slice(0, 20)}`;
  const known = fontLibrary.info(id);
  if (known && blobs.has(id)) return { id, family: known.family, reused: true };
  const { family } = await register(id, bytes, flavor);
  return { id, family, reused: false };
}

/** Restore a stored font under its id (projects reference fonts by id). */
export async function loadFontBlob(id: string, blob: Blob): Promise<void> {
  if (blobs.has(id)) return;
  const bytes = new Uint8Array(await blob.arrayBuffer());
  await register(id, bytes, sniff(bytes) === 'otf' ? 'otf' : 'ttf');
}

export const fontBlob = (id: string): Blob | null => blobs.get(id) ?? null;
