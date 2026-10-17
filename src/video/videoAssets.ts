// Imported videos. Like images they are content-addressed assets (`vid-<sha20>`): the original file
// is the asset blob (IndexedDB + .glyphix), and the first frame is stored as the asset's poster
// image so texture fallback and thumbnails work unchanged. Files are untrusted input: size,
// container and codec are checked, and the browser must be able to decode the video track.
import { ALL_FORMATS, BlobSource, Input, VideoSampleSink, type InputVideoTrack } from 'mediabunny';
import { VIDEO_ASSET_PREFIX } from '@/doc/assets';
import { assetStore, makeProxies, sha256Hex } from '@/assets/assetStore';
import { decodeGif, GifError } from './gifDecoder';
import { registerGif, sniffGif } from './gifAssets';

export const MAX_VIDEO_BYTES = 1024 * 1024 * 1024;
export const VIDEO_ACCEPT = '.mp4,.m4v,.webm,.mov,.mkv,video/mp4,video/webm,video/quicktime';

export class VideoFileError extends Error {}

export interface VideoMeta {
  /** Display size (after pixel aspect ratio and rotation). */
  width: number;
  height: number;
  /** End of the video track, seconds. */
  duration: number;
  /** Estimated frame rate (30 when it can't be measured). */
  fps: number;
  /** An audio track exists and this browser can decode it. */
  hasAudio: boolean;
  /** Video codec, e.g. 'avc', 'vp9'. */
  codec: string;
  /** Clockwise rotation from the file's metadata, degrees (omitted when 0). */
  rotation?: number;
}

/** An open video file: one Mediabunny Input per asset, shared by every decoder that reads it. */
export interface VideoSource {
  input: Input;
  track: InputVideoTrack;
  /** Timestamp of the first frame (s); requests before it show the first frame. */
  firstTimestamp: number;
}

const metas = new Map<string, VideoMeta>();
const sources = new Map<string, Promise<VideoSource>>();
/** Registrations in flight, so the same file imported twice at once is opened once. */
const pending = new Map<string, Promise<VideoMeta>>();

const CODEC_NAMES: Record<string, string> = { avc: 'H.264', hevc: 'HEVC (H.265)', vp8: 'VP8', vp9: 'VP9', av1: 'AV1' };
const VIDEO_EXT = /\.(mp4|m4v|webm|mov|mkv)$/i;

export function isVideoFile(file: Blob & { name?: string }): boolean {
  return file.type.startsWith('video/') || VIDEO_EXT.test(file.name ?? '');
}

/** Metadata of a loaded video asset. */
export const videoMeta = (id: string): VideoMeta | null => metas.get(id) ?? null;

/** Round a measured frame rate: exact integers stay integers, others keep 3 decimals (29.97). */
function roundFps(rate: number): number {
  if (!Number.isFinite(rate) || rate <= 0) return 30;
  return Math.abs(rate - Math.round(rate)) < 0.01 ? Math.round(rate) : Math.round(rate * 1000) / 1000;
}

/** Open and validate a file; throws VideoFileError with a message for the user. */
async function open(blob: Blob): Promise<{ source: VideoSource; meta: VideoMeta; mime: string }> {
  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(blob) });
  try {
    let mime: string;
    try {
      mime = (await input.getFormat()).mimeType;
    } catch {
      throw new VideoFileError('This isn’t a video file Glyphix can read (use MP4, WebM or MOV).');
    }
    const track = await input.getPrimaryVideoTrack();
    if (!track) throw new VideoFileError('This file has no video track.');
    if (!(await track.canDecode())) {
      const codec = await track.getCodec();
      const name = codec ? (CODEC_NAMES[codec] ?? codec.toUpperCase()) : 'an unknown codec';
      throw new VideoFileError(`This video uses ${name}, which this browser can’t decode. Convert it to H.264 (MP4) or VP9 (WebM).`);
    }
    const audio = await input.getPrimaryAudioTrack();
    const [width, height, duration, stats, firstTimestamp, rotation, codec, hasAudio] = await Promise.all([
      track.getDisplayWidth(),
      track.getDisplayHeight(),
      track.computeDuration(),
      track.computePacketStats(120).catch(() => null),
      track.getFirstTimestamp(),
      track.getRotation(),
      track.getCodec(),
      audio ? audio.canDecode() : false,
    ]);
    const meta: VideoMeta = { width, height, duration, fps: roundFps(stats?.averagePacketRate ?? 30), hasAudio, codec: codec ?? 'unknown' };
    if (rotation) meta.rotation = rotation;
    return { source: { input, track, firstTimestamp }, meta, mime: mime.startsWith('video/') ? mime : 'video/mp4' };
  } catch (e) {
    input.dispose();
    if (e instanceof VideoFileError) throw e;
    throw new VideoFileError('This video file is damaged or can’t be read.');
  }
}

/** The first frame at display size (rotation applied), as the asset's poster image. */
async function decodePoster(source: VideoSource, meta: VideoMeta): Promise<ImageBitmap> {
  const sample = await new VideoSampleSink(source.track).getSample(source.firstTimestamp);
  if (!sample) throw new VideoFileError('This video has no frames.');
  try {
    const canvas = new OffscreenCanvas(meta.width, meta.height);
    sample.drawWithFit(canvas.getContext('2d')!, { fit: 'fill' });
    return await createImageBitmap(canvas);
  } finally {
    sample.close();
  }
}

/** Validate, register and store a video under `id`. */
function register(id: string, blob: Blob): Promise<VideoMeta> {
  let p = pending.get(id);
  if (!p) {
    p = registerNow(id, blob).finally(() => pending.delete(id));
    pending.set(id, p);
  }
  return p;
}

/** An animated GIF: decode every frame now (small files), the first one is the poster. */
async function registerGifAsset(id: string, blob: Blob): Promise<VideoMeta> {
  let gif;
  try {
    gif = decodeGif(new Uint8Array(await blob.arrayBuffer()));
  } catch (e) {
    throw new VideoFileError(e instanceof GifError ? e.message : 'This GIF is damaged or can’t be read.');
  }
  const first = gif.frames[0]!;
  const poster = await createImageBitmap(new ImageData(first.rgba, gif.width, gif.height));
  const meta: VideoMeta = { width: gif.width, height: gif.height, duration: gif.duration, fps: roundFps(gif.frames.length / gif.duration), hasAudio: false, codec: 'gif' };
  registerGif(id, gif);
  metas.set(id, meta);
  assetStore.put(id, poster, { levels: await makeProxies(poster), blob: blob.type === 'image/gif' ? blob : new Blob([blob], { type: 'image/gif' }) });
  return meta;
}

async function registerNow(id: string, blob: Blob): Promise<VideoMeta> {
  if (await sniffGif(blob)) return registerGifAsset(id, blob);
  const { source, meta, mime } = await open(blob);
  let poster: ImageBitmap;
  try {
    poster = await decodePoster(source, meta);
  } catch (e) {
    source.input.dispose();
    throw e instanceof VideoFileError ? e : new VideoFileError('This video’s first frame couldn’t be decoded.');
  }
  metas.set(id, meta);
  sources.set(id, Promise.resolve(source));
  // Keep the container type on the blob: persistence picks the file extension from it.
  const file = blob.type === mime ? blob : new Blob([blob], { type: mime });
  assetStore.put(id, poster, { levels: await makeProxies(poster), blob: file });
  return meta;
}

export interface ImportedVideo {
  id: string;
  meta: VideoMeta;
  /** True when this exact file was already in the store. */
  reused: boolean;
}

/** Import a video file the user picked or dropped. */
export async function importVideo(blob: Blob): Promise<ImportedVideo> {
  if (blob.size > MAX_VIDEO_BYTES) throw new VideoFileError('This video is too large (over 1 GB).');
  if (blob.size === 0) throw new VideoFileError('This video file is empty.');
  const id = `${VIDEO_ASSET_PREFIX}${(await sha256Hex(blob)).slice(0, 20)}`;
  const known = metas.get(id);
  if (known && assetStore.has(id)) return { id, meta: known, reused: true };
  return { id, meta: await register(id, blob), reused: false };
}

/** Restore a stored video under its id (projects reference assets by id). */
export async function loadVideoBlob(id: string, blob: Blob): Promise<void> {
  if (metas.has(id) && assetStore.has(id)) return;
  await register(id, blob);
}

/** The open file behind a video asset, or null when it isn't loaded. */
export function videoSource(id: string): Promise<VideoSource> | null {
  return sources.get(id) ?? null;
}
