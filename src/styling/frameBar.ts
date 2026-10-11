// Draws the window / browser bar that sits above a framed image. Rendered once per
// (kind, url, size) into a canvas and used as a texture by the image shader.
import type { FrameKind } from '@/doc';

const THEMES = {
  light: { bar: '#ececef', line: '#d6d6db', pill: '#ffffff', text: '#55555f', icon: '#9a9aa5' },
  dark: { bar: '#22232a', line: '#33343d', pill: '#2e2f38', text: '#c9c9d2', icon: '#7c7d88' },
};

const LIGHTS = ['#ff5f57', '#febc2e', '#28c840'];

/** @param w,h bar size in pixels (already multiplied by the resolution factor) */
export function drawFrameBar(kind: Exclude<FrameKind, 'none'>, url: string, w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  const g = c.getContext('2d')!;
  const theme = THEMES[kind.endsWith('dark') ? 'dark' : 'light'];

  g.fillStyle = theme.bar;
  g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = theme.line;
  g.fillRect(0, c.height - Math.max(1, h * 0.02), c.width, Math.max(1, h * 0.02));

  // Traffic lights.
  const r = h * 0.16;
  const cy = h / 2;
  LIGHTS.forEach((col, i) => {
    g.fillStyle = col;
    g.beginPath();
    g.arc(h * 0.5 + i * r * 3.2, cy, r, 0, Math.PI * 2);
    g.fill();
  });

  if (kind.startsWith('browser')) {
    const pillH = h * 0.56;
    const pillW = Math.min(w * 0.56, w - h * 6);
    const px = (w - pillW) / 2;
    const py = (h - pillH) / 2;
    g.fillStyle = theme.pill;
    g.beginPath();
    g.roundRect(px, py, pillW, pillH, pillH * 0.32);
    g.fill();
    // Lock icon.
    const lx = px + pillH * 0.55;
    const ls = pillH * 0.32;
    g.strokeStyle = theme.icon;
    g.lineWidth = Math.max(1, ls * 0.16);
    g.beginPath();
    g.arc(lx, cy - ls * 0.25, ls * 0.32, Math.PI, 0);
    g.stroke();
    g.fillStyle = theme.icon;
    g.fillRect(lx - ls * 0.45, cy - ls * 0.2, ls * 0.9, ls * 0.75);
    // URL.
    g.fillStyle = theme.text;
    g.font = `500 ${Math.round(pillH * 0.46)}px Inter, system-ui, sans-serif`;
    g.textBaseline = 'middle';
    g.textAlign = 'center';
    g.fillText(url || 'glyphix.app', px + pillW / 2, cy + pillH * 0.02, pillW - pillH * 2);
  }
  return c;
}
