import { AudioBufferSource, BufferTarget, canEncodeAudio, Output, WebMOutputFormat } from 'mediabunny';
import { gzipSync, strToU8, zipSync } from 'fflate';
import { ASCII_BUILTIN_FONT, evaluate, resolveEffects, sampleProp, type Doc, type Effect } from '@/doc';
import { fontLibrary } from '@/text/fontLibrary';
import { fontBlob } from '@/assets/fontAssets';
import type { AsciiCells } from '@/render/backend';
import { mixAudio, type AudioMix } from './audioMix';
import { prepare, safeName, type ExportOptions } from './exporter';
import { PLAYER_ENGINE_DTS, PLAYER_ENGINE_JS } from './asciiPlayerEngine';

// ASCII text export: the characters (and colours) the GPU drew for one ASCII effect, frame by frame, as
// text. Each frame is rendered the way video export renders it (full comp, scale 1, t = i / fps) and the
// effect's cell texture is read back, so the text can't disagree with the picture.

export type AsciiOutput = 'copy' | 'txt-zip' | 'json' | 'html' | 'react';

export interface AsciiFrame {
  lines: string[];
  /** Colour mode ≠ Mono: one string per row, 6 hex digits ("rrggbb") per cell. */
  colors?: string[];
}

/** What the player (and the React data file) needs besides the frames. */
export interface AsciiStyle {
  /** CSS font-family the player uses for the embedded font. */
  family: string;
  weight: number;
  lineHeight: number;
  /** Mono glyph colour (#rrggbb). */
  ink: string;
  /** CSS colour of the grid background (the effect's background colour at its Background amount). */
  background: string;
}

export interface AsciiSequence {
  cols: number;
  rows: number;
  fps: number;
  /** Cell size in comp px. */
  cellWidth: number;
  cellHeight: number;
  mono: boolean;
  style: AsciiStyle;
  frames: AsciiFrame[];
}

export interface AsciiEffectRef {
  effect: Effect;
  layerId: string;
  /** e.g. "Adjustment · ASCII" (plus "(off)" when switched off). */
  label: string;
  enabled: boolean;
}

export const PLAYER_FONT_FAMILY = 'GlyphixAscii';

/** Every ASCII effect in the doc, topmost layer first. */
export function listAsciiEffects(doc: Doc): AsciiEffectRef[] {
  const out: AsciiEffectRef[] = [];
  for (const layer of [...doc.comp.layers].reverse()) {
    const own = layer.effects.filter((e) => e.kind === 'ascii');
    own.forEach((effect, i) => {
      const enabled = effect.enabled && layer.visible;
      const suffix = own.length > 1 ? ` ${i + 1}` : '';
      out.push({ effect, layerId: layer.id, enabled, label: `${layer.name} · ASCII${suffix}${enabled ? '' : ' (off)'}` });
    });
  }
  return out;
}

/** The effect to export by default: the topmost enabled one (else the topmost). */
export const defaultAsciiEffect = (doc: Doc): AsciiEffectRef | undefined => {
  const all = listAsciiEffects(doc);
  return all.find((r) => r.enabled) ?? all[0];
};

const hex2 = (v: number) => v.toString(16).padStart(2, '0');

function colorRows(c: AsciiCells): string[] {
  const rows: string[] = [];
  for (let y = 0; y < c.rows; y++) {
    let s = '';
    for (let x = 0; x < c.cols; x++) {
      const o = (y * c.cols + x) * 4;
      s += hex2(c.rgba[o]!) + hex2(c.rgba[o + 1]!) + hex2(c.rgba[o + 2]!);
    }
    rows.push(s);
  }
  return rows;
}

/** Pad or crop a frame to the first frame's grid (only matters when the cell size is animated). */
function fitFrame(f: AsciiFrame, cols: number, rows: number): AsciiFrame {
  const fix = (s: string, w: number, pad: string) => (s.length >= w ? s.slice(0, w) : s + pad.repeat(w - s.length));
  const blank = ' '.repeat(cols);
  const lines = Array.from({ length: rows }, (_, y) => fix(f.lines[y] ?? blank, cols, ' '));
  const colors = f.colors && Array.from({ length: rows }, (_, y) => fix(f.colors![y] ?? '', cols * 6, '0'));
  return colors ? { lines, colors } : { lines };
}

export interface CaptureOptions extends ExportOptions {
  /** Times to capture, in seconds. Default: every frame, i / fps. */
  times?: number[];
}

export interface CaptureResult {
  sequence: AsciiSequence;
  notes: string[];
}

export const frameCount = (doc: Doc) => Math.max(1, Math.round(doc.comp.duration * doc.comp.fps));

/** Render the doc and read back the chosen ASCII effect's cells at every requested time. */
export async function captureAsciiSequence(doc: Doc, effectId: string, opts: CaptureOptions = {}): Promise<CaptureResult> {
  const ref = listAsciiEffects(doc).find((r) => r.effect.id === effectId);
  if (!ref) throw new Error('That ASCII effect no longer exists.');
  const { fps } = doc.comp;
  const times = opts.times ?? Array.from({ length: frameCount(doc) }, (_, i) => i / fps);
  const colorMode = ref.effect.params.colorMode ?? { static: 1 };
  const isMono = (t: number) => Math.round(sampleProp(colorMode, t)) === 0;
  const notes: string[] = [];
  const { backend } = await prepare(doc, opts);
  const frames: AsciiFrame[] = [];
  let first: AsciiCells | null = null;
  try {
    backend.setView(null);
    backend.render(evaluate(doc, times[0] ?? 0)); // warm-up: shaders, glyph atlas
    let resized = false;
    for (let i = 0; i < times.length; i++) {
      if (opts.signal?.aborted) throw new DOMException('Export cancelled', 'AbortError');
      const list = evaluate(doc, times[i]!);
      await backend.prepare(list);
      const cells = await backend.captureAscii(list, effectId);
      if (!cells) throw new Error('The ASCII effect is switched off (or its layer is hidden) at this time, so there is no text to export.');
      first ??= cells;
      const frame: AsciiFrame = { lines: cells.lines };
      if (!isMono(times[i]!)) frame.colors = colorRows(cells);
      if (cells.cols !== first.cols || cells.rows !== first.rows) {
        resized = true;
        frames.push(fitFrame(frame, first.cols, first.rows));
      } else {
        frames.push(frame);
      }
      opts.onProgress?.((i + 1) / times.length);
    }
    if (resized) notes.push("The cell size changes over time; every frame was fitted to the first frame's grid.");
  } finally {
    // Let queued GPU work finish first, or WebGPU logs errors from pending error scopes.
    await backend.idle().catch(() => {});
    backend.dispose();
  }
  const cells = first!;
  // Colours are kept for the whole sequence as soon as any frame uses a colour mode.
  const mono = frames.every((f) => !f.colors);
  if (!mono) for (const f of frames) f.colors ??= Array.from({ length: cells.rows }, () => '000000'.repeat(cells.cols));
  const r = resolveEffects([ref.effect], times[0] ?? 0, sampleProp)[0]!;
  const bg = r.colors.bg ?? [0, 0, 0, 1];
  const sequence: AsciiSequence = {
    cols: cells.cols,
    rows: cells.rows,
    fps,
    cellWidth: cells.cellWidth,
    cellHeight: cells.cellHeight,
    mono,
    style: {
      family: PLAYER_FONT_FAMILY,
      weight: Math.round(r.params.weight ?? 500),
      lineHeight: r.params.lineHeight ?? 1.2,
      ink: `#${[0, 1, 2].map((i) => hex2(cells.rgba[i]!)).join('')}`,
      background: `rgba(${bg.slice(0, 3).map((v) => Math.round(v * 255)).join(',')},${(r.params.background ?? 1).toFixed(3)})`,
    },
    frames,
  };
  return { sequence, notes };
}

export const frameText = (f: AsciiFrame) => f.lines.join('\n');

/** The effect's ASCII at time `t`, as plain text (for the clipboard). */
export async function asciiFrameText(doc: Doc, effectId: string, t: number, opts: ExportOptions = {}): Promise<string> {
  const { sequence } = await captureAsciiSequence(doc, effectId, { ...opts, times: [t] });
  return frameText(sequence.frames[0]!);
}

// ---------------------------------------------------------------------------
// Pure builders (unit-tested)

/** `frame-0001.txt`, `frame-0002.txt`, … (one-based, at least four digits). */
export const txtFrameName = (i: number, total: number) => `frame-${String(i + 1).padStart(Math.max(4, String(total).length), '0')}.txt`;

/** One .txt per frame, in a zip. Every line ends with \n. */
export function buildTxtZip(seq: AsciiSequence): Uint8Array {
  const files: Record<string, Uint8Array> = {};
  seq.frames.forEach((f, i) => (files[txtFrameName(i, seq.frames.length)] = strToU8(`${frameText(f)}\n`)));
  return zipSync(files);
}

/** `{cols, rows, fps, cellWidth, cellHeight, frames: [{lines, colors?}]}`; colours are "rrggbb" per cell, per row. */
export function buildJson(seq: AsciiSequence, extra: Record<string, unknown> = {}): string {
  const { cols, rows, fps, cellWidth, cellHeight } = seq;
  const head = JSON.stringify({ cols, rows, fps, cellWidth, cellHeight, ...extra }).slice(0, -1);
  return `${head},"frames":[\n${seq.frames.map((f) => JSON.stringify(f)).join(',\n')}\n]}\n`;
}

export function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

const escapeHtml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export interface PlayerAssets {
  font: Uint8Array;
  /** Encoded audio and its MIME type; null = silent. */
  audio: { bytes: Uint8Array; mime: string; ext: string } | null;
}

/** A single self-contained .html file: gzip+base64 frames, base64 font (and audio), the player script. */
export function buildHtmlPlayer(seq: AsciiSequence, assets: PlayerAssets, title: string): string {
  const data = toBase64(gzipSync(strToU8(buildJson(seq, { mono: seq.mono, style: seq.style })), { level: 9 }));
  const script = PLAYER_ENGINE_JS.replace(/^export /, '');
  const aspect = (seq.cols * seq.cellWidth) / (seq.rows * seq.cellHeight);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
@font-face{font-family:${PLAYER_FONT_FAMILY};src:url(data:font/ttf;base64,${toBase64(assets.font)});font-weight:100 900}
html{background:#000}
body{margin:0;min-height:100vh;display:grid;place-items:center;color:#ddd;color-scheme:dark}
#app{width:min(100vw,calc((100vh - 56px) * ${aspect.toFixed(4)}));outline-offset:4px}
</style>
</head>
<body>
<div id="app"></div>
<script type="application/octet-stream" id="d">${data}</script>
${assets.audio ? `<script type="application/octet-stream" id="s">${toBase64(assets.audio.bytes)}</script>\n` : ''}<script>
${script}
(async function () {
  var bin = function (id) { return Uint8Array.from(atob(document.getElementById(id).textContent), function (c) { return c.charCodeAt(0); }); };
  var json = await new Response(new Blob([bin('d')]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
  var audioSrc = ${assets.audio ? `URL.createObjectURL(new Blob([bin('s')], { type: '${assets.audio.mime}' }))` : 'undefined'};
  window.asciiPlayer = createAsciiPlayer(document.getElementById('app'), JSON.parse(json), { autoPlay: true, loop: true, audioSrc: audioSrc });
})();
</script>
</body>
</html>
`;
}

const reactComponent = (audioExt: string | null) => `import { useEffect, useRef } from 'react';
import { createAsciiPlayer } from './ascii-player-engine';
import { asciiData } from './ascii-data';

// The font${audioExt ? ' and audio are' : ' is'} resolved by your bundler (Vite and webpack 5 support new URL(…, import.meta.url)).
const fontSrc = new URL('./ascii-font.ttf', import.meta.url).href;
${audioExt ? `const audioSrc: string | undefined = new URL('./ascii-audio.${audioExt}', import.meta.url).href;` : 'const audioSrc: string | undefined = undefined; // exported without sound'}

export interface AsciiPlayerProps {
  autoPlay?: boolean;
  loop?: boolean;
  className?: string;
}

/** Plays the exported ASCII animation at its original frame rate. Space pauses it when it has focus. */
export function AsciiPlayer({ autoPlay = true, loop = true, className }: AsciiPlayerProps) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const player = createAsciiPlayer(root, asciiData, { autoPlay, loop, audioSrc, fontSrc });
    return () => player.destroy();
  }, [autoPlay, loop]);
  return <div ref={ref} className={className} />;
}

export default AsciiPlayer;
`;

/** AsciiPlayer.tsx + data + engine (+ font, + audio) in one zip. */
export function buildReactZip(seq: AsciiSequence, assets: PlayerAssets): Uint8Array {
  const data = `import type { AsciiPlayerData } from './ascii-player-engine';\n\nexport const asciiData: AsciiPlayerData = ${buildJson(seq, { mono: seq.mono, style: seq.style }).trim()};\n`;
  const files: Record<string, Uint8Array> = {
    'AsciiPlayer.tsx': strToU8(reactComponent(assets.audio?.ext ?? null)),
    'ascii-data.ts': strToU8(data),
    'ascii-player-engine.js': strToU8(PLAYER_ENGINE_JS),
    'ascii-player-engine.d.ts': strToU8(PLAYER_ENGINE_DTS),
    'ascii-font.ttf': assets.font,
  };
  if (assets.audio) files[`ascii-audio.${assets.audio.ext}`] = assets.audio.bytes;
  return zipSync(files);
}

export interface SizeInput {
  cols: number;
  rows: number;
  frames: number;
  /** Colour mode isn't Mono. */
  color: boolean;
  output: Exclude<AsciiOutput, 'copy'>;
  fontBytes: number;
  /** Seconds of embedded audio (0 = none). */
  audioSeconds: number;
}

/** Opus bitrate of the player's audio, in bytes per second. */
export const AUDIO_BYTES_PER_SECOND = 12_000;
/** Rough compression ratios for ASCII frames; the real size is shown after saving. */
const RATIO = { zip: 0.15, gzip: 0.1, gzipColor: 0.25, zipColor: 0.3 };

/** Estimated output size in bytes (roughly ±50%: it depends on how much the picture changes). */
export function estimateAsciiBytes(s: SizeInput): number {
  const text = s.frames * s.rows * (s.cols + 1);
  const colors = s.color ? s.frames * s.rows * (s.cols * 6 + 4) : 0;
  const audio = s.audioSeconds * AUDIO_BYTES_PER_SECOND;
  const engine = PLAYER_ENGINE_JS.length;
  switch (s.output) {
    case 'txt-zip':
      return Math.round(text * RATIO.zip) + s.frames * 100;
    case 'json':
      return text + colors + s.frames * 24;
    case 'html':
      return Math.round(((text + colors) * (s.color ? RATIO.gzipColor : RATIO.gzip) + s.fontBytes + audio) * (4 / 3)) + engine + 1000;
    case 'react':
      return Math.round((text + colors + s.frames * 24) * (s.color ? RATIO.zipColor : RATIO.zip) + s.fontBytes * 0.6 + audio) + engine + 3000;
  }
}

// ---------------------------------------------------------------------------
// Browser side

const BUILTIN_FONT_URL = '/fonts/JetBrainsMono.ttf';

/** The font file the effect draws with (its `fontId`; '' or an unavailable font = the built-in JetBrains Mono). */
export async function loadAsciiFontBytes(fontId: string): Promise<Uint8Array> {
  const info = fontId === ASCII_BUILTIN_FONT ? undefined : fontLibrary.info(fontId);
  if (info?.url) {
    const r = await fetch(info.url);
    if (r.ok) return new Uint8Array(await r.arrayBuffer());
  }
  const blob = fontId === ASCII_BUILTIN_FONT ? null : fontBlob(fontId);
  if (blob) return new Uint8Array(await blob.arrayBuffer());
  return new Uint8Array(await (await fetch(BUILTIN_FONT_URL)).arrayBuffer());
}

/** The mix as Opus in an audio-only WebM (Chrome, Firefox and recent Safari play it). null if it can't be encoded. */
export async function encodeAudio(mix: AudioMix): Promise<PlayerAssets['audio']> {
  if (!(await canEncodeAudio('opus', { numberOfChannels: mix.buffer.numberOfChannels, sampleRate: mix.buffer.sampleRate }))) return null;
  const target = new BufferTarget();
  const output = new Output({ format: new WebMOutputFormat(), target });
  const source = new AudioBufferSource({ codec: 'opus', bitrate: AUDIO_BYTES_PER_SECOND * 8 });
  output.addAudioTrack(source);
  await output.start();
  await source.add(mix.buffer);
  await output.finalize();
  return { bytes: new Uint8Array(target.buffer!), mime: 'audio/webm', ext: 'webm' };
}

export interface AsciiExportSettings {
  effectId: string;
  output: AsciiOutput;
  /** HTML / React only. */
  sound: boolean;
  /** 'copy' only: which moment. */
  time?: number;
}

export interface AsciiExportResult {
  /** Text for 'copy'; null for files. */
  text: string | null;
  blob: Blob | null;
  filename: string;
  notes: string[];
  ms: number;
  frames: number;
}

export async function runAsciiExport(doc: Doc, settings: AsciiExportSettings, opts: ExportOptions = {}): Promise<AsciiExportResult> {
  const started = performance.now();
  const name = safeName(doc);
  if (settings.output === 'copy') {
    const text = await asciiFrameText(doc, settings.effectId, settings.time ?? 0, opts);
    return { text, blob: null, filename: '', notes: [], ms: performance.now() - started, frames: 1 };
  }
  const player = settings.output === 'html' || settings.output === 'react';
  const sound = player && settings.sound;
  const { sequence, notes } = await captureAsciiSequence(doc, settings.effectId, { ...opts, onProgress: (f) => opts.onProgress?.(f * (sound ? 0.85 : 1)) });
  const file = (blob: Blob, filename: string): AsciiExportResult => ({ text: null, blob, filename, notes, ms: performance.now() - started, frames: sequence.frames.length });
  if (settings.output === 'txt-zip') return file(new Blob([buildTxtZip(sequence) as Uint8Array<ArrayBuffer>], { type: 'application/zip' }), `${name}-ascii-txt.zip`);
  if (settings.output === 'json') return file(new Blob([buildJson(sequence)], { type: 'application/json' }), `${name}-ascii.json`);

  const ref = listAsciiEffects(doc).find((r) => r.effect.id === settings.effectId)!;
  const font = await loadAsciiFontBytes(ref.effect.text.fontId ?? ASCII_BUILTIN_FONT);
  let audio: PlayerAssets['audio'] = null;
  if (sound) {
    const mix = await mixAudio(doc, { signal: opts.signal });
    if (!mix) notes.push('No sound to include: no video layer here has audio.');
    else if (!(audio = await encodeAudio(mix))) notes.push("This browser can't encode audio; saved without sound.");
    opts.onProgress?.(1);
  }
  if (settings.output === 'html') return file(new Blob([buildHtmlPlayer(sequence, { font, audio }, name)], { type: 'text/html' }), `${name}-ascii.html`);
  return file(new Blob([buildReactZip(sequence, { font, audio }) as Uint8Array<ArrayBuffer>], { type: 'application/zip' }), `${name}-ascii-react.zip`);
}
