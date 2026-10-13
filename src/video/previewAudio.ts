// Preview sound: the same mix the export writes (every audible video layer, placed and faded on the
// timeline), played with Web Audio from the timeline position. One buffer for the whole comp, so there is no
// per-layer seeking; a media element per layer would also read the files and stall the frame decoder.
import { audioSegments, type Doc } from '@/doc';
import { mixAudio } from '@/export/audioMix';

/** Restart the sound when it is this far from the timeline (s): a timeline jump, a loop, or clock drift. */
const RESYNC = 0.06;
/** Wait this long after the last audio-relevant edit before re-mixing (ms). */
const REMIX_DELAY = 250;

export class PreviewAudio {
  private ctx: AudioContext | null = null;
  private buffer: AudioBuffer | null = null;
  private key = '';
  private doc: Doc | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private abort: AbortController | null = null;
  private src: AudioBufferSourceNode | null = null;
  /** ctx.currentTime when the source started, and the comp time it started from. */
  private startedAt = 0;
  private startOffset = 0;
  /** |sound position − timeline time| per update while playing (s), for tests. */
  drift: number[] = [];

  /** Re-mix when the audible clips (or the comp length) change. Cheap when nothing changed. */
  setDoc(doc: Doc) {
    if (doc === this.doc) return;
    this.doc = doc;
    const key = `${doc.comp.duration}|${JSON.stringify(audioSegments(doc))}`;
    if (key === this.key) return;
    this.key = key;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.remix(doc, key), this.buffer ? REMIX_DELAY : 0);
  }

  private async remix(doc: Doc, key: string) {
    this.abort?.abort();
    const abort = (this.abort = new AbortController());
    try {
      const mix = await mixAudio(doc, { signal: abort.signal });
      if (abort.signal.aborted || key !== this.key) return;
      this.buffer = mix?.buffer ?? null;
      this.stop(); // the next update() restarts with the new mix
    } catch (e) {
      if (!abort.signal.aborted) console.warn('[glyphix] preview audio', e);
    }
  }

  /** Call every frame: plays from `time` while `playing`, silent otherwise. */
  update(playing: boolean, time: number) {
    if (!playing || !this.buffer) return this.stop();
    if (this.src) {
      const pos = this.startOffset + (this.ctx!.currentTime - this.startedAt);
      const d = Math.abs(pos - time);
      this.drift.push(d);
      if (d <= RESYNC) return;
      this.stop();
    }
    this.ctx ??= new AudioContext({ latencyHint: 'interactive' });
    if (this.ctx.state === 'suspended') void this.ctx.resume().catch(() => undefined); // needs a user gesture
    if (time >= this.buffer.duration) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.buffer;
    src.connect(this.ctx.destination);
    src.start(0, time);
    this.src = src;
    this.startedAt = this.ctx.currentTime;
    this.startOffset = time;
  }

  private stop() {
    if (!this.src) return;
    this.src.onended = null;
    try {
      this.src.stop();
    } catch {
      // already stopped
    }
    this.src.disconnect();
    this.src = null;
  }

  dispose() {
    this.stop();
    this.abort?.abort();
    if (this.timer) clearTimeout(this.timer);
    void this.ctx?.close();
    this.ctx = null;
  }
}
