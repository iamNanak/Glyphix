import { BufferTarget, canEncodeVideo, CanvasSource, Mp4OutputFormat, Output, QUALITY_HIGH, WebMOutputFormat } from 'mediabunny';
import { evaluate, type Doc } from '@/doc';
import { createBackend, type RenderBackend } from '@/render/backend';
import { fontLibrary } from '@/text/fontLibrary';

// Milestone A: export runs on the main thread with its own backend instance and a fixed
// timestep (t = i / fps, never drops frames). Moving it into a Worker + OffscreenCanvas
// is Milestone C (export: full).

export interface ExportOptions {
  forceWebGL?: boolean;
  scale?: number;
  signal?: AbortSignal;
  onProgress?: (fraction: number) => void;
}

async function prepare(doc: Doc, opts: ExportOptions): Promise<{ backend: RenderBackend; canvas: HTMLCanvasElement; width: number; height: number }> {
  const fonts = new Set(doc.comp.layers.flatMap((l) => (l.type === 'text' ? [l.fontId] : [])));
  // Frame bars draw their URL text with the CSS Inter face; make sure it's ready so export matches preview.
  await Promise.all([...[...fonts].map((f) => fontLibrary.load(f)), document.fonts.load('500 12px Inter')]);
  const scale = opts.scale ?? 1;
  // Encoders need even dimensions.
  const width = Math.round((doc.comp.width * scale) / 2) * 2;
  const height = Math.round((doc.comp.height * scale) / 2) * 2;
  const canvas = document.createElement('canvas');
  const backend = await createBackend({ canvas, forceWebGL: opts.forceWebGL, fullResAssets: true });
  backend.setSize(width, height, 1);
  return { backend, canvas, width, height };
}

/** Render one frame and snapshot it synchronously (WebGPU canvases are only readable in the same task). */
export async function renderFrameBitmap(backend: RenderBackend, doc: Doc, t: number): Promise<ImageBitmap> {
  backend.render(evaluate(doc, t));
  return createImageBitmap(backend.canvas);
}

export async function exportPng(doc: Doc, t: number, opts: ExportOptions = {}): Promise<Blob> {
  const { backend, width, height } = await prepare(doc, opts);
  try {
    // Text layout happens on first render; render twice so freshly rasterised glyphs are in the atlas.
    backend.render(evaluate(doc, t));
    const bmp = await renderFrameBitmap(backend, doc, t);
    const out = new OffscreenCanvas(width, height);
    out.getContext('2d')!.drawImage(bmp, 0, 0);
    bmp.close();
    return await out.convertToBlob({ type: 'image/png' });
  } finally {
    backend.dispose();
  }
}

export interface VideoExportResult {
  blob: Blob;
  extension: string;
  codec: string;
  ms: number;
}

export async function exportVideo(doc: Doc, opts: ExportOptions = {}): Promise<VideoExportResult> {
  const started = performance.now();
  const { backend, canvas, width, height } = await prepare(doc, opts);
  try {
    const avc = await canEncodeVideo('avc', { width, height });
    const codec = avc ? 'avc' : 'vp9';
    const format = avc ? new Mp4OutputFormat({ fastStart: 'in-memory' }) : new WebMOutputFormat();
    const target = new BufferTarget();
    const output = new Output({ format, target });
    const source = new CanvasSource(canvas, { codec, quality: QUALITY_HIGH });
    const { fps, duration } = doc.comp;
    output.addVideoTrack(source, { frameRate: fps });
    await output.start();

    backend.render(evaluate(doc, 0)); // warm-up: shaders, glyph atlas
    const frames = Math.round(duration * fps);
    for (let i = 0; i < frames; i++) {
      if (opts.signal?.aborted) {
        await output.cancel();
        throw new DOMException('Export cancelled', 'AbortError');
      }
      const t = i / fps;
      backend.render(evaluate(doc, t));
      await source.add(t, 1 / fps);
      opts.onProgress?.((i + 1) / frames);
    }
    await output.finalize();
    return {
      blob: new Blob([target.buffer!], { type: format.mimeType }),
      extension: format.fileExtension,
      codec,
      ms: performance.now() - started,
    };
  } finally {
    backend.dispose();
  }
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
