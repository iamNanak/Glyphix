// Rolling frame-time samples for the bench overlay.

const SIZE = 240;

export class FrameStats {
  private intervals = new Float32Array(SIZE);
  private cpu = new Float32Array(SIZE);
  private n = 0;
  private last = 0;

  /** Call once per rendered frame with the rAF timestamp and CPU ms spent in evaluate+render. */
  push(now: number, cpuMs: number) {
    if (this.last) {
      const i = this.n % SIZE;
      this.intervals[i] = now - this.last;
      this.cpu[i] = cpuMs;
      this.n++;
    }
    this.last = now;
  }

  reset() {
    this.n = 0;
    this.last = 0;
  }

  summary() {
    const count = Math.min(this.n, SIZE);
    const pct = (arr: Float32Array, p: number) => {
      if (!count) return 0;
      const sorted = Array.from(arr.subarray(0, count)).sort((a, b) => a - b);
      return sorted[Math.min(count - 1, Math.floor(p * count))]!;
    };
    return {
      samples: count,
      frameP50: pct(this.intervals, 0.5),
      frameP95: pct(this.intervals, 0.95),
      cpuP50: pct(this.cpu, 0.5),
      cpuP95: pct(this.cpu, 0.95),
    };
  }
}

export const frameStats = new FrameStats();
