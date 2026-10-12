// Asset store: images keyed by content hash, with ½ and ¼ proxies for fast preview.
// Originals are kept as compressed blobs (for persistence in Milestone C), never as raw pixels in history.

export type AssetSource = ImageBitmap | HTMLCanvasElement | OffscreenCanvas;

export interface AssetLevel {
  source: AssetSource;
  width: number;
  height: number;
}

export interface Asset {
  id: string;
  /** levels[0] is full resolution; following levels halve each time. */
  levels: AssetLevel[];
  width: number;
  height: number;
  /** Original encoded file, when the asset came from the user. */
  blob: Blob | null;
  /** Bumps when the pixels behind an id change, so GPU caches re-upload. */
  version: number;
}

export const MAX_TEXTURE_DIM = 8192;
/** Don't make proxies smaller than this (longest side). */
const MIN_PROXY_DIM = 512;

class AssetStore {
  private assets = new Map<string, Asset>();
  private listeners = new Set<() => void>();

  get(id: string): Asset | undefined {
    return this.assets.get(id);
  }

  has(id: string): boolean {
    return this.assets.has(id);
  }

  ids(): string[] {
    return [...this.assets.keys()];
  }

  put(id: string, source: AssetSource, opts: { levels?: AssetLevel[]; blob?: Blob } = {}): Asset {
    const prev = this.assets.get(id);
    const full = { source, width: source.width, height: source.height };
    const asset: Asset = {
      id,
      levels: [full, ...(opts.levels ?? [])],
      width: source.width,
      height: source.height,
      blob: opts.blob ?? null,
      version: (prev?.version ?? 0) + 1,
    };
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

/** Smallest level whose width still covers `neededWidth` device pixels. */
export function pickLevel(asset: Asset, neededWidth: number): number {
  for (let i = asset.levels.length - 1; i > 0; i--) {
    if (asset.levels[i]!.width >= neededWidth) return i;
  }
  return 0;
}

async function sha256Hex(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Decode a user-supplied image file (off the main thread) and clamp it to the GPU limit. */
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

async function makeProxies(full: ImageBitmap): Promise<AssetLevel[]> {
  const levels: AssetLevel[] = [];
  let w = full.width;
  let h = full.height;
  for (let i = 0; i < 2; i++) {
    w = Math.round(w / 2);
    h = Math.round(h / 2);
    if (Math.max(w, h) < MIN_PROXY_DIM) break;
    const source = await createImageBitmap(full, { resizeWidth: w, resizeHeight: h, resizeQuality: 'high' });
    levels.push({ source, width: w, height: h });
  }
  return levels;
}

export interface ImportedImage {
  id: string;
  width: number;
  height: number;
  /** True when this exact file was already in the store. */
  reused: boolean;
}

/** Import an image file: content-hash id (dedupes), decode, build proxies. */
export async function importImage(blob: Blob): Promise<ImportedImage> {
  const id = `img-${(await sha256Hex(blob)).slice(0, 20)}`;
  const existing = assetStore.get(id);
  if (existing) return { id, width: existing.width, height: existing.height, reused: true };
  const full = await decodeImage(blob);
  const levels = await makeProxies(full);
  assetStore.put(id, full, { levels, blob });
  return { id, width: full.width, height: full.height, reused: false };
}

/** Load a stored file back under its original asset id (projects reference assets by id). */
export async function loadAssetBlob(id: string, blob: Blob): Promise<Asset> {
  const existing = assetStore.get(id);
  if (existing) return existing;
  const full = await decodeImage(blob);
  const levels = await makeProxies(full);
  return assetStore.put(id, full, { levels, blob });
}

/** The asset as an encoded file. Canvas-only assets (e.g. the procedural demo) are encoded to PNG once. */
export async function assetBlob(id: string): Promise<Blob | null> {
  const asset = assetStore.get(id);
  if (!asset) return null;
  if (asset.blob) return asset.blob;
  const src = asset.levels[0]!.source;
  const canvas = new OffscreenCanvas(asset.width, asset.height);
  canvas.getContext('2d')!.drawImage(src as CanvasImageSource, 0, 0);
  const blob = await canvas.convertToBlob({ type: 'image/png' });
  asset.blob = blob; // cache: don't re-encode on every save
  return blob;
}
