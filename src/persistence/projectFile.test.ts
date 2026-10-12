import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { createDemoDoc, SCHEMA_VERSION } from '@/doc';
import { projectFileName, readProjectFile, writeProjectFile } from './projectFile';

const zip = (files: Record<string, Uint8Array>) => new Blob([zipSync(files) as Uint8Array<ArrayBuffer>]);
const json = (v: unknown) => strToU8(JSON.stringify(v));

describe('.glyphix files', () => {
  it('round-trips the document exactly and deterministically', async () => {
    const doc = createDemoDoc();
    const a = await writeProjectFile(doc);
    const b = await writeProjectFile(doc);
    expect(new Uint8Array(await a.arrayBuffer())).toEqual(new Uint8Array(await b.arrayBuffer()));
    const back = await readProjectFile(a);
    expect(JSON.stringify(back.doc)).toBe(JSON.stringify(doc));
  });

  it('reads asset files listed in the manifest', async () => {
    const png = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);
    const file = zip({
      'project.json': json({ format: 'glyphix', schemaVersion: SCHEMA_VERSION, doc: createDemoDoc(), assets: [{ id: 'img-abc', path: 'assets/img-abc.png', type: 'image/png' }] }),
      'assets/img-abc.png': png,
    });
    const { assets } = await readProjectFile(file);
    expect(assets).toHaveLength(1);
    expect(assets[0]!.blob.type).toBe('image/png');
    expect(new Uint8Array(await assets[0]!.blob.arrayBuffer())).toEqual(png);
  });

  it('migrates old documents', async () => {
    const old = JSON.parse(JSON.stringify(createDemoDoc()));
    old.schemaVersion = 1;
    old.comp.layers.forEach((l: Record<string, unknown>) => delete l.motion);
    const { doc } = await readProjectFile(zip({ 'project.json': json({ format: 'glyphix', schemaVersion: 1, doc: old, assets: [] }) }));
    expect(doc.schemaVersion).toBe(SCHEMA_VERSION);
  });

  it('rejects hostile or broken input with a readable error', async () => {
    await expect(readProjectFile(new Blob(['not a zip']))).rejects.toThrow(/couldn't be unzipped/);
    await expect(readProjectFile(zip({ 'readme.txt': strToU8('hi') }))).rejects.toThrow(/project.json is missing/);
    await expect(readProjectFile(zip({ 'project.json': strToU8('{oops') }))).rejects.toThrow(/not valid JSON/);
    await expect(readProjectFile(zip({ 'project.json': json({ format: 'other', doc: createDemoDoc() }) }))).rejects.toThrow(/isn't a Glyphix/);
    await expect(readProjectFile(zip({ 'project.json': json({ format: 'glyphix', doc: { ...createDemoDoc(), schemaVersion: 999 }, assets: [] }) }))).rejects.toThrow(/newer version/);
  });

  it('ignores assets with unsafe ids or paths', async () => {
    const file = zip({
      'project.json': json({
        format: 'glyphix',
        schemaVersion: SCHEMA_VERSION,
        doc: createDemoDoc(),
        assets: [
          { id: '../../etc', path: 'assets/x.png', type: 'image/png' },
          { id: 'ok', path: '../outside.png', type: 'image/png' },
        ],
      }),
      'assets/x.png': new Uint8Array([1]),
    });
    expect((await readProjectFile(file)).assets).toEqual([]);
  });

  it('refuses archives that expand beyond the limit', async () => {
    // 2 MB of zeros compresses to a few KB; the guard trips on the declared (uncompressed) size.
    const big = new Uint8Array(2 * 1024 * 1024);
    const file = new Blob([zipSync({ 'project.json': json({ format: 'glyphix' }), 'assets/huge.bin': big }) as Uint8Array<ArrayBuffer>]);
    expect(file.size).toBeLessThan(64 * 1024);
    await expect(readProjectFile(file, { maxUnzippedBytes: 1024 * 1024 })).rejects.toThrow(/too large/);
  });

  it('makes safe file names', () => {
    expect(projectFileName({ name: 'Launch: v2/final?' })).toBe('Launch- v2-final-.glyphix');
    expect(projectFileName({ name: '   ' })).toBe('Untitled.glyphix');
  });
});
