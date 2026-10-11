import type { RenderList } from '@/doc';

export type BackendKind = 'webgpu' | 'webgl2';

export interface RenderStats {
  backend: BackendKind;
  drawCalls: number;
  glyphs: number;
  textures: number;
}

/** Renderer-agnostic interface. Everything a backend needs is in the RenderList + asset/font stores. */
export interface RenderBackend {
  readonly kind: BackendKind;
  readonly canvas: HTMLCanvasElement | OffscreenCanvas;
  /** Drawing-buffer size = width×height×pixelRatio. Comp space is always mapped to fill it. */
  setSize(width: number, height: number, pixelRatio: number): void;
  render(list: RenderList): void;
  stats(): RenderStats;
  /** Called when the GPU device/context is lost and the backend is unusable. */
  onLost: ((reason: string) => void) | null;
  dispose(): void;
}

export interface CreateBackendOptions {
  canvas?: HTMLCanvasElement | OffscreenCanvas;
  forceWebGL?: boolean;
  /** Keep the drawing buffer readable after present (export / pixel-diff). */
  preserveDrawingBuffer?: boolean;
  /** Always sample full-resolution assets (export). Preview picks ½/¼ proxies by on-screen size. */
  fullResAssets?: boolean;
}

export async function createBackend(opts: CreateBackendOptions = {}): Promise<RenderBackend> {
  const { ThreeBackend } = await import('./three/ThreeBackend');
  return ThreeBackend.create(opts);
}
