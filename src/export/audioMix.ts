// Audio for video exports: decode exactly the stretches of each video file that play (audioSegments),
// place them on the comp timeline with their volumes and mix them into one 48 kHz stereo buffer
// covering 0..comp.duration. Resampling and up/down-mixing are left to an OfflineAudioContext.
import { ALL_FORMATS, AudioBufferSink, BlobSource, Input } from 'mediabunny';
import { audioSegments, type AudioSegment, type Doc } from '@/doc';
import { assetBlob } from '@/assets/assetStore';

export const MIX_RATE = 48000;
export const MIX_CHANNELS = 2;
/** Fade at every segment edge (s): a hard cut in the middle of a waveform clicks. */
export const EDGE_FADE = 0.005;

/** Samples in `seconds` of audio at `rate` (at least one: an AudioBuffer can't be empty). */
export const sampleCount = (seconds: number, rate: number) => Math.max(1, Math.round(seconds * rate));

/**
 * Where a decoded chunk starting at source time `chunkTime` (`chunkLength` samples) lands in a segment
 * buffer that starts at source time `segStart` and holds `segLength` samples. Chunks may begin before the
 * segment (decoders return whole packets) or run past its end; both are trimmed. count ≤ 0 → nothing to copy.
 */
export function placeChunk(chunkTime: number, chunkLength: number, segStart: number, segLength: number, rate: number) {
  const at = Math.round((chunkTime - segStart) * rate);
  const srcOffset = Math.max(0, -at);
  const destOffset = Math.max(0, at);
  const count = Math.min(chunkLength - srcOffset, segLength - destOffset);
  return { srcOffset, destOffset, count };
}

/** Gain automation for one segment: [comp time, gain] points, a short ramp in and out around `volume`. */
export function fadeEnvelope(seg: Pick<AudioSegment, 'compStart' | 'duration' | 'volume'>, fade = EDGE_FADE): [number, number][] {
  const f = Math.min(fade, seg.duration / 2);
  const a = seg.compStart;
  const b = seg.compStart + seg.duration;
  return [
    [a, 0],
    [a + f, seg.volume],
    [b - f, seg.volume],
    [b, 0],
  ];
}

interface Decoded {
  channels: Float32Array[];
  rate: number;
}

/** One video file's audio, opened once and read per segment. */
interface AudioFile {
  read(seg: AudioSegment): Promise<Decoded | null>;
  dispose(): void;
}

async function openAudio(blob: Blob): Promise<AudioFile | null> {
  const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
  const track = await input.getPrimaryAudioTrack().catch(() => null);
  if (!track) {
    input.dispose();
    return null;
  }
  if (await track.canDecode()) {
    const sink = new AudioBufferSink(track);
    return {
      async read(seg) {
        let out: Decoded | null = null;
        const end = seg.sourceStart + seg.duration;
        for await (const { buffer, timestamp } of sink.buffers(seg.sourceStart, end)) {
          // Allocate at the decoder's output rate (can differ from the container's, e.g. HE-AAC).
          out ??= { rate: buffer.sampleRate, channels: Array.from({ length: buffer.numberOfChannels }, () => new Float32Array(sampleCount(seg.duration, buffer.sampleRate))) };
          const p = placeChunk(timestamp, buffer.length, seg.sourceStart, out.channels[0]!.length, out.rate);
          if (p.count <= 0) continue;
          out.channels.forEach((ch, c) => ch.set(buffer.getChannelData(Math.min(c, buffer.numberOfChannels - 1)).subarray(p.srcOffset, p.srcOffset + p.count), p.destOffset));
        }
        return out;
      },
      dispose: () => input.dispose(),
    };
  }
  // No WebCodecs decoder for this codec (e.g. AAC in Firefox): the Web Audio decoder reads the whole file.
  input.dispose();
  let whole: AudioBuffer;
  try {
    whole = await new OfflineAudioContext(1, 1, MIX_RATE).decodeAudioData(await blob.arrayBuffer());
  } catch {
    return null;
  }
  return {
    async read(seg) {
      const n = sampleCount(seg.duration, whole.sampleRate);
      const p = placeChunk(0, whole.length, seg.sourceStart, n, whole.sampleRate);
      if (p.count <= 0) return null;
      const channels = Array.from({ length: whole.numberOfChannels }, (_, c) => {
        const ch = new Float32Array(n);
        ch.set(whole.getChannelData(c).subarray(p.srcOffset, p.srcOffset + p.count), p.destOffset);
        return ch;
      });
      return { channels, rate: whole.sampleRate };
    },
    dispose: () => {},
  };
}

export interface AudioMix {
  buffer: AudioBuffer;
  /** Asset ids whose audio couldn't be decoded (left out of the mix). */
  failed: string[];
}

/**
 * Mix every audible video layer of `doc` into one buffer covering exactly 0..comp.duration.
 * null when nothing plays sound (no segments, or none of the files has an audio track).
 */
export async function mixAudio(doc: Doc, opts: { signal?: AbortSignal } = {}): Promise<AudioMix | null> {
  const segments = audioSegments(doc);
  if (!segments.length) return null;
  const aborted = () => {
    if (opts.signal?.aborted) throw new DOMException('Export cancelled', 'AbortError');
  };
  const ctx = new OfflineAudioContext(MIX_CHANNELS, sampleCount(doc.comp.duration, MIX_RATE), MIX_RATE);
  const files = new Map<string, Promise<AudioFile | null>>();
  const failed = new Set<string>();
  let placed = 0;
  try {
    for (const seg of segments) {
      aborted();
      if (!files.has(seg.assetId)) {
        files.set(
          seg.assetId,
          assetBlob(seg.assetId).then((b) => (b ? openAudio(b) : null)).catch(() => null),
        );
      }
      const file = await files.get(seg.assetId)!;
      if (!file) continue; // no audio track (or no decodable audio): silent
      const data = await file.read(seg).catch(() => {
        failed.add(seg.assetId);
        return null;
      });
      if (!data) continue;
      const buf = ctx.createBuffer(data.channels.length, data.channels[0]!.length, data.rate);
      data.channels.forEach((ch, c) => buf.copyToChannel(ch as Float32Array<ArrayBuffer>, c));
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const gain = ctx.createGain();
      const env = fadeEnvelope(seg);
      gain.gain.setValueAtTime(env[0]![1], env[0]![0]);
      for (const [t, v] of env.slice(1)) gain.gain.linearRampToValueAtTime(v, t);
      src.connect(gain).connect(ctx.destination); // mono → both channels, 5.1 → stereo ("speakers" mixing)
      src.start(seg.compStart, 0, seg.duration);
      placed++;
    }
    aborted();
    if (!placed) return failed.size ? { buffer: ctx.createBuffer(MIX_CHANNELS, ctx.length, MIX_RATE), failed: [...failed] } : null;
    const buffer = await ctx.startRendering();
    aborted();
    return { buffer, failed: [...failed] };
  } finally {
    for (const f of files.values()) void f.then((x) => x?.dispose());
  }
}
