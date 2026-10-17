import type { RenderList } from '@/doc';
import type { VideoFrameProvider } from '@/video/provider';

export type BackendKind = 'webgpu' | 'webgl2';

export interface RenderStats {
  backend: BackendKind;
  drawCalls: number;
  glyphs: number;
  textures: number;
}

/** Renderer-agnostic interface. Everything a backend needs is in the RenderList + asset/font stores. */
/** Where the comp sits on the canvas: comp origin at (offsetX, offsetY) CSS px, `zoom` CSS px per comp px. */
export interface View {
  offsetX: number;
  offsetY: number;
  zoom: number;
}

/** The characters (and colours) an ASCII effect drew, row by row from the top-left cell. */
export interface AsciiCells {
  cols: number;
  rows: number;
  /** One string per row, `cols` characters each (empty cells are the charset's lightest glyph). */
  lines: string[];
  /** Per cell: glyph colour (sRGB 0..255) and cell alpha (0..255), row-major. */
  rgba: Uint8Array;
}

export interface RenderBackend {
  readonly kind: BackendKind;
  readonly canvas: HTMLCanvasElement | OffscreenCanvas;
  /** Drawing-buffer size = width×height×pixelRatio. Comp space is always mapped to fill it. */
  setSize(width: number, height: number, pixelRatio: number): void;
  /** null = the comp exactly fills the canvas (export). */
  setView(view: View | null): void;
  /** Await before render(list) so video layers show their exact frame (no-op without video). */
  prepare(list: RenderList): Promise<void>;
  render(list: RenderList): void;
  /**
   * Render the list, then read back the cell grid one ASCII effect drew (text export). Await prepare(list)
   * first. null when that effect drew nothing this frame (disabled, no-op, or layer not visible).
   */
  captureAscii(list: RenderList, effectId: string): Promise<AsciiCells | null>;
  stats(): RenderStats;
  /** Called when the GPU device/context is lost and the backend is unusable. */
  onLost: ((reason: string) => void) | null;
  /** Resolves when the GPU has finished all submitted work (call before dispose()). */
  idle(): Promise<void>;
  dispose(): void;
}

export interface CreateBackendOptions {
  canvas?: HTMLCanvasElement | OffscreenCanvas;
  forceWebGL?: boolean;
  /** Keep the drawing buffer readable after present (export / pixel-diff). */
  preserveDrawingBuffer?: boolean;
  /** Always sample full-resolution assets (export). Preview picks ½/¼ proxies by on-screen size. */
  fullResAssets?: boolean;
  /** Video frames. Default: frame-exact decoding (export, thumbnails, tests); the editor passes its live provider. */
  frames?: VideoFrameProvider;
}

export async function createBackend(opts: CreateBackendOptions = {}): Promise<RenderBackend> {
  const { ThreeBackend } = await import('./three/ThreeBackend');
  return ThreeBackend.create(opts);
}
