// One GPUDevice shared by every renderer (preview, export, bench). three.js doesn't destroy a
// device it was handed, so short-lived export renderers don't pay for adapter/device creation.

/* Minimal WebGPU typings so we don't need @webgpu/types for a handful of calls. */
interface GPUAdapterLike {
  features: Set<string>;
  requestDevice(desc: { requiredFeatures: string[] }): Promise<GPUDeviceLike>;
}
export interface GPUDeviceLike {
  lost: Promise<{ reason: string | null; message: string }>;
  queue: { onSubmittedWorkDone(): Promise<void> };
}
interface GPULike {
  requestAdapter(opts: { featureLevel: string }): Promise<GPUAdapterLike | null>;
}

let shared: Promise<GPUDeviceLike | null> | null = null;
/** Keep the adapter reachable for as long as its device is in use. */
const keepAlive: { adapter: GPUAdapterLike | null } = { adapter: null };

/** Resolves to null when WebGPU isn't available (the renderer then falls back to WebGL2). */
export function getSharedDevice(): Promise<GPUDeviceLike | null> {
  shared ??= (async () => {
    const gpu = (navigator as Navigator & { gpu?: GPULike }).gpu;
    if (!gpu) return null;
    // Same request three.js makes on its own: compatibility feature level, every supported feature.
    const adapter = await gpu.requestAdapter({ featureLevel: 'compatibility' });
    if (!adapter) return null;
    keepAlive.adapter = adapter;
    const device = await adapter.requestDevice({ requiredFeatures: [...adapter.features] });
    void device.lost.then(() => {
      shared = null; // next renderer gets a fresh device; live ones recover via onDeviceLost
      keepAlive.adapter = null;
    });
    return device;
  })().catch(() => {
    shared = null;
    return null;
  });
  return shared;
}
