// Signed distance field from an anti-aliased coverage bitmap.
// Felzenszwalb & Huttenlocher 1-D squared EDT, seeded with sub-pixel offsets from
// AA coverage (the same idea Mapbox's TinySDF uses). Our own implementation.

const INF = 1e20;

function edt1d(grid: Float64Array, offset: number, stride: number, length: number, f: Float64Array, v: Uint16Array, z: Float64Array) {
  v[0] = 0;
  z[0] = -INF;
  z[1] = INF;
  f[0] = grid[offset]!;
  for (let q = 1, k = 0, s = 0; q < length; q++) {
    f[q] = grid[offset + q * stride]!;
    const q2 = q * q;
    do {
      const r = v[k]!;
      s = (f[q]! - f[r]! + q2 - r * r) / (q - r) / 2;
    } while (s <= z[k]! && --k > -1);
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = INF;
  }
  for (let q = 0, k = 0; q < length; q++) {
    while (z[k + 1]! < q) k++;
    const r = v[k]!;
    const qr = q - r;
    grid[offset + q * stride] = f[r]! + qr * qr;
  }
}

function edt2d(grid: Float64Array, w: number, h: number) {
  const n = Math.max(w, h);
  const f = new Float64Array(n);
  const v = new Uint16Array(n);
  const z = new Float64Array(n + 1);
  for (let x = 0; x < w; x++) edt1d(grid, x, w, h, f, v, z);
  for (let y = 0; y < h; y++) edt1d(grid, y * w, 1, w, f, v, z);
}

/**
 * @param alpha coverage 0..255, row-major w×h
 * @param spread distance in px that maps to the full 0..1 range on each side of the edge
 * @returns 0..255 where 128 ≈ edge, >128 inside
 */
export function coverageToSDF(alpha: Uint8ClampedArray | Uint8Array, w: number, h: number, spread: number, stride = 1): Uint8Array {
  const size = w * h;
  const outer = new Float64Array(size);
  const inner = new Float64Array(size);
  for (let i = 0; i < size; i++) {
    const a = alpha[i * stride]! / 255;
    // outer: squared distance to the nearest inside pixel; inner: to the nearest outside pixel.
    if (a === 1) {
      outer[i] = 0;
      inner[i] = INF;
    } else if (a === 0) {
      outer[i] = INF;
      inner[i] = 0;
    } else {
      const d = 0.5 - a;
      outer[i] = d > 0 ? d * d : 0;
      inner[i] = d < 0 ? d * d : 0;
    }
  }
  edt2d(outer, w, h);
  edt2d(inner, w, h);
  const out = new Uint8Array(size);
  for (let i = 0; i < size; i++) {
    const dist = Math.sqrt(outer[i]!) - Math.sqrt(inner[i]!); // >0 outside
    out[i] = Math.max(0, Math.min(255, Math.round(255 * (0.5 - dist / (2 * spread)))));
  }
  return out;
}
