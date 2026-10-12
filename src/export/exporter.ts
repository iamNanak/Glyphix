import { BufferTarget, canEncodeVideo, CanvasSource, Mp4OutputFormat, Output, QUALITY_HIGH, WebMOutputFormat } from 'mediabunny';
import { GIFEncoder, applyPalette, quantize } from 'gifenc';
import { evaluate, type Doc } from '@/doc';
import { createBackend, type RenderBackend } from '@/render/backend';
import { fontLibrary } from '@/text/fontLibrary';

// Export runs on the main thread with its own backend instance (full-resolution assets) and a
// fixed timestep (t = i / fps, never drops frames). The same evaluator + renderer as the preview,
// so preview = export. It awaits the encoder between frames, so the UI stays responsive.

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
    // Let queued GPU work finish first, or WebGPU logs errors from pending error scopes.
    await backend.idle().catch(() => {});
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
    // Let queued GPU work finish first, or WebGPU logs errors from pending error scopes.
    await backend.idle().catch(() => {});
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

// ---------------------------------------------------------------------------
// Unified export (used by the Export dialog)

export type ExportFormat = 'png' | 'jpeg' | 'webp' | 'mp4' | 'gif';

export interface ExportSettings {
  format: ExportFormat;
  /** Output size relative to the comp (stills 1–4×, video 0.5–2×, GIF 0.25–1×). */
  scale: number;
  /** JPEG/WebP quality 0..1. */
  quality: number;
  /** PNG/WebP: hide background layers so the export has an alpha channel. */
  transparent: boolean;
  /** Stills: which moment to export. */
  time: number;
  /** GIF frame rate. Divisors of 100 keep GIF's 10 ms frame timing exact. */
  gifFps: 10 | 20 | 25;
}

export interface ExportResult {
  blob: Blob;
  filename: string;
  ms: number;
  width: number;
  height: number;
  /** e.g. "WebP isn't supported here; saved PNG instead". */
  note: string | null;
}

const STILL_MIME: Record<'png' | 'jpeg' | 'webp', string> = { png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp' };
const EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'video/mp4': 'mp4', 'video/webm': 'webm' };

const withoutBackground = (doc: Doc): Doc => ({
  ...doc,
  comp: { ...doc.comp, layers: doc.comp.layers.map((l) => (l.type === 'background' ? { ...l, visible: false } : l)) },
});

const safeName = (doc: Doc) => doc.name.trim().replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-').slice(0, 80) || 'Untitled';

export async function exportStill(doc: Doc, settings: Pick<ExportSettings, 'format' | 'scale' | 'quality' | 'transparent' | 'time'>, opts: ExportOptions = {}): Promise<ExportResult> {
  const started = performance.now();
  const format = settings.format as 'png' | 'jpeg' | 'webp';
  // JPEG has no alpha: transparency is ignored there.
  const source = settings.transparent && format !== 'jpeg' ? withoutBackground(doc) : doc;
  const { backend, width, height } = await prepare(source, { ...opts, scale: settings.scale });
  try {
    backend.render(evaluate(source, settings.time)); // warm-up: layout → atlas, texture uploads
    const bmp = await renderFrameBitmap(backend, source, settings.time);
    const out = new OffscreenCanvas(width, height);
    const g = out.getContext('2d')!;
    if (format === 'jpeg') {
      g.fillStyle = '#ffffff'; // JPEG can't store alpha; never let it turn black
      g.fillRect(0, 0, width, height);
    }
    g.drawImage(bmp, 0, 0);
    bmp.close();
    opts.onProgress?.(1);
    const wanted = STILL_MIME[format];
    const blob = await out.convertToBlob({ type: wanted, quality: settings.quality });
    const note = blob.type !== wanted ? `${format.toUpperCase()} isn't supported by this browser; saved ${EXT[blob.type]?.toUpperCase() ?? blob.type} instead.` : null;
    return { blob, filename: `${safeName(doc)}.${EXT[blob.type] ?? format}`, ms: performance.now() - started, width, height, note };
  } finally {
    await backend.idle().catch(() => {});
    backend.dispose();
  }
}

export async function exportGif(doc: Doc, settings: Pick<ExportSettings, 'scale' | 'gifFps'>, opts: ExportOptions = {}): Promise<ExportResult> {
  const started = performance.now();
  const { backend, width, height } = await prepare(doc, { ...opts, scale: settings.scale });
  const read = async (t: number) => {
    const bmp = await renderFrameBitmap(backend, doc, t);
    const c = new OffscreenCanvas(width, height);
    const g = c.getContext('2d', { willReadFrequently: true })!;
    g.drawImage(bmp, 0, 0);
    bmp.close();
    return g.getImageData(0, 0, width, height).data;
  };
  try {
    const fps = settings.gifFps;
    const frames = Math.max(1, Math.round(doc.comp.duration * fps));
    backend.render(evaluate(doc, 0)); // warm-up

    // One global palette, sampled from frames across the clip, so colours don't flicker.
    const samples = Math.min(8, frames);
    const sampleStep = 3; // every 3rd pixel keeps quantize fast
    const perFrame = Math.ceil((width * height) / sampleStep);
    const pool = new Uint8ClampedArray(samples * perFrame * 4);
    for (let k = 0; k < samples; k++) {
      if (opts.signal?.aborted) throw new DOMException('Export cancelled', 'AbortError');
      const px = await read(((k + 0.5) / samples) * doc.comp.duration);
      for (let i = 0, o = k * perFrame * 4; i < width * height; i += sampleStep, o += 4) pool.set(px.subarray(i * 4, i * 4 + 4), o);
      opts.onProgress?.((0.2 * (k + 1)) / samples);
    }
    const palette = quantize(pool, 256);

    const gif = GIFEncoder();
    for (let i = 0; i < frames; i++) {
      if (opts.signal?.aborted) throw new DOMException('Export cancelled', 'AbortError');
      const px = await read(i / fps);
      gif.writeFrame(applyPalette(px, palette), width, height, { palette, delay: 1000 / fps, repeat: 0 });
      opts.onProgress?.(0.2 + (0.8 * (i + 1)) / frames);
    }
    gif.finish();
    const blob = new Blob([gif.bytes() as Uint8Array<ArrayBuffer>], { type: 'image/gif' });
    return { blob, filename: `${safeName(doc)}.gif`, ms: performance.now() - started, width, height, note: null };
  } finally {
    await backend.idle().catch(() => {});
    backend.dispose();
  }
}

export async function runExport(doc: Doc, settings: ExportSettings, opts: ExportOptions = {}): Promise<ExportResult> {
  switch (settings.format) {
    case 'png':
    case 'jpeg':
    case 'webp':
      return exportStill(doc, settings, opts);
    case 'gif':
      return exportGif(doc, settings, opts);
    case 'mp4': {
      const r = await exportVideo(doc, { ...opts, scale: settings.scale });
      const width = Math.round((doc.comp.width * settings.scale) / 2) * 2;
      const height = Math.round((doc.comp.height * settings.scale) / 2) * 2;
      const note = r.codec === 'avc' ? null : "H.264 isn't available in this browser; saved WebM (VP9) instead.";
      return { blob: r.blob, filename: `${safeName(doc)}.${r.extension.replace(/^\./, '')}`, ms: r.ms, width, height, note };
    }
  }
}
