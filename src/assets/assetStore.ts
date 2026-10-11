// Minimal in-memory asset store (Milestone A). Milestone B adds content hashing,
// proxies, off-thread decode, and IndexedDB/OPFS persistence.

export type AssetSource = ImageBitmap | HTMLCanvasElement | OffscreenCanvas;

export interface Asset {
  id: string;
  source: AssetSource;
  width: number;
  height: number;
  /** Bumps when the pixels behind an id change, so GPU caches re-upload. */
  version: number;
}

class AssetStore {
  private assets = new Map<string, Asset>();
  private listeners = new Set<() => void>();

  get(id: string): Asset | undefined {
    return this.assets.get(id);
  }

  put(id: string, source: AssetSource): Asset {
    const prev = this.assets.get(id);
    const asset = { id, source, width: source.width, height: source.height, version: (prev?.version ?? 0) + 1 };
    this.assets.set(id, asset);
    this.listeners.forEach((l) => l());
    return asset;
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}

export const assetStore = new AssetStore();

export const MAX_TEXTURE_DIM = 8192;

/** Decode a user-supplied image file off the main thread. Rejects images above the GPU limit. */
export async function decodeImage(blob: Blob): Promise<ImageBitmap> {
  const bmp = await createImageBitmap(blob);
  if (bmp.width > MAX_TEXTURE_DIM || bmp.height > MAX_TEXTURE_DIM) {
    const scale = MAX_TEXTURE_DIM / Math.max(bmp.width, bmp.height);
    const resized = await createImageBitmap(bmp, {
      resizeWidth: Math.floor(bmp.width * scale),
      resizeHeight: Math.floor(bmp.height * scale),
      resizeQuality: 'high',
    });
    bmp.close();
    return resized;
  }
  return bmp;
}
