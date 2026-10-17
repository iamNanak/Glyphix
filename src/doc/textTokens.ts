// Frame-counter tokens in text layers: {frame}, {frames}, {time}. Substituted per frame when the render
// list is built, so "Frame {frame} / {frames}" counts up as the timeline plays and in exports.
import type { Comp } from './types';

const TOKEN = /\{(frames?|time)\}/g;

/** Total frames of the comp, and the 1-based frame number shown at time `t` (clamped to 1..total). */
export function frameNumbers(comp: Pick<Comp, 'fps' | 'duration'>, t: number): { frame: number; frames: number } {
  const frames = Math.max(1, Math.round(comp.duration * comp.fps));
  const frame = Math.min(frames, Math.max(1, Math.floor(t * comp.fps + 1e-6) + 1));
  return { frame, frames };
}

/** `text` with {frame} (zero-padded to the width of {frames}), {frames} and {time} (seconds, 2 decimals) replaced. */
export function expandTextTokens(text: string, comp: Pick<Comp, 'fps' | 'duration'>, t: number): string {
  if (!text.includes('{')) return text;
  const { frame, frames } = frameNumbers(comp, t);
  return text.replace(TOKEN, (_, name: string) => {
    if (name === 'frames') return String(frames);
    if (name === 'time') return Math.max(0, t).toFixed(2);
    return String(frame).padStart(String(frames).length, '0');
  });
}
