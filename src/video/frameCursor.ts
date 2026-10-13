// Frame selection over a decoded sample stream, kept free of WebCodecs so it can be unit tested.
// A cursor walks a presentation-ordered stream forward and holds the sample shown at a time:
// the last one whose start timestamp is at or before it (Mediabunny's VideoSampleSink semantics).

export interface TimedSample {
  /** Start (presentation) timestamp, seconds. */
  readonly timestamp: number;
  close(): void;
}

/** Forward jumps up to this far (s) decode through; farther ones re-seek to the nearest key frame. */
export const MAX_FORWARD_DECODE = 2;

/**
 * A frame whose start is at most this far after the requested time still counts as shown at it.
 * Covers float noise in i / fps and containers that round timestamps to milliseconds (WebM puts
 * frame 2 of a 30 fps clip at 67 ms, after 2 / 30 s); far below any real frame duration.
 */
export const TIME_EPSILON = 1e-3;

/**
 * Whether reaching `t` needs a new decode session instead of continuing the current one:
 * going backwards, jumping far ahead, or no frame held yet.
 */
export function needsRestart(heldTimestamp: number | null, t: number, maxForward = MAX_FORWARD_DECODE): boolean {
  if (heldTimestamp === null) return true;
  return t + TIME_EPSILON < heldTimestamp || t - heldTimestamp > maxForward;
}

export class FrameCursor<S extends TimedSample> {
  private held: S | null = null;
  private peek: S | null = null;
  private done = false;
  private closed = false;

  constructor(private readonly source: AsyncIterator<S>) {}

  /** The sample currently shown, or null before the first advance(). */
  get current(): S | null {
    return this.held;
  }

  /**
   * Walk forward to the sample shown at `t`. The first sample of the stream is always taken (times
   * before it show it); past the end the last sample stays. Never goes backwards (callers restart).
   * Returns true when the held sample changed. Skipped samples are closed.
   */
  async advance(t: number): Promise<boolean> {
    let changed = false;
    for (;;) {
      if (!this.peek && !this.done) {
        const r = await this.source.next();
        if (this.closed) {
          if (!r.done) r.value.close();
          return false;
        }
        if (r.done) this.done = true;
        else this.peek = r.value;
      }
      if (!this.peek) break;
      if (this.held && this.peek.timestamp > t + TIME_EPSILON) break;
      this.held?.close();
      this.held = this.peek;
      this.peek = null;
      changed = true;
    }
    return changed;
  }

  /** Stop decoding and close everything held. Safe to call twice and while advance() is pending. */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.held?.close();
    this.peek?.close();
    this.held = this.peek = null;
    void this.source.return?.();
  }
}
