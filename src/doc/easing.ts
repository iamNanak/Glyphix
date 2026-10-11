import type { Easing } from './types';

/** CSS cubic-bezier(x1, y1, x2, y2) evaluated at x ∈ [0,1]. */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number, x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const sampleX = (s: number) => ((ax * s + bx) * s + cx) * s;
  const sampleY = (s: number) => ((ay * s + by) * s + cy) * s;
  const slopeX = (s: number) => (3 * ax * s + 2 * bx) * s + cx;

  // Newton-Raphson, then bisection as a fallback.
  let s = x;
  for (let i = 0; i < 8; i++) {
    const err = sampleX(s) - x;
    if (Math.abs(err) < 1e-6) return sampleY(s);
    const d = slopeX(s);
    if (Math.abs(d) < 1e-6) break;
    s -= err / d;
  }
  let lo = 0;
  let hi = 1;
  s = x;
  for (let i = 0; i < 32; i++) {
    const v = sampleX(s);
    if (Math.abs(v - x) < 1e-6) break;
    if (v < x) lo = s;
    else hi = s;
    s = (lo + hi) / 2;
  }
  return sampleY(s);
}

/**
 * Closed-form damped spring from 0 → 1, as a function of normalised progress p ∈ [0,1].
 * p is mapped to `settle` seconds of spring time so the curve always lands on 1 at p = 1.
 */
export function spring(mass: number, stiffness: number, damping: number, p: number): number {
  if (p <= 0) return 0;
  if (p >= 1) return 1;
  const w0 = Math.sqrt(stiffness / mass);
  const zeta = damping / (2 * Math.sqrt(stiffness * mass));
  const settle = 6 / (Math.max(zeta, 0.1) * w0);
  const t = p * settle;
  if (zeta < 1) {
    const wd = w0 * Math.sqrt(1 - zeta * zeta);
    return 1 - Math.exp(-zeta * w0 * t) * (Math.cos(wd * t) + ((zeta * w0) / wd) * Math.sin(wd * t));
  }
  // Critically / over-damped: use the critically damped form.
  return 1 - Math.exp(-w0 * t) * (1 + w0 * t);
}

export function ease(e: Easing, p: number): number {
  const x = Math.min(1, Math.max(0, p));
  switch (e.kind) {
    case 'linear':
      return x;
    case 'hold':
      return x < 1 ? 0 : 1;
    case 'bezier':
      return cubicBezier(e.x1, e.y1, e.x2, e.y2, x);
    case 'spring':
      return spring(e.mass, e.stiffness, e.damping, x);
    case 'steps':
      return Math.min(1, Math.floor(x * e.n) / e.n);
  }
}

export const Easings = {
  linear: { kind: 'linear' } as Easing,
  easeOutCubic: { kind: 'bezier', x1: 0.33, y1: 1, x2: 0.68, y2: 1 } as Easing,
  easeInOutCubic: { kind: 'bezier', x1: 0.65, y1: 0, x2: 0.35, y2: 1 } as Easing,
  easeOutBack: { kind: 'bezier', x1: 0.34, y1: 1.56, x2: 0.64, y2: 1 } as Easing,
} as const;
