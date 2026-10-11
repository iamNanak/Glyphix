// Procedural "app screenshot" so the editor has content before the user pastes their own.

export function createDemoScreenshot(width = 1280, height = 760, scale = 2): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = width * scale;
  c.height = height * scale;
  const g = c.getContext('2d')!;
  g.scale(scale, scale);

  g.fillStyle = '#0f1117';
  g.fillRect(0, 0, width, height);

  // Title bar
  g.fillStyle = '#171a22';
  g.fillRect(0, 0, width, 40);
  ['#ff5f57', '#febc2e', '#28c840'].forEach((col, i) => {
    g.fillStyle = col;
    g.beginPath();
    g.arc(22 + i * 20, 20, 6, 0, Math.PI * 2);
    g.fill();
  });

  // Sidebar
  g.fillStyle = '#13151c';
  g.fillRect(0, 40, 220, height - 40);
  g.font = '600 15px system-ui, sans-serif';
  g.fillStyle = '#e6e8ee';
  g.fillText('Acme Analytics', 24, 78);
  g.font = '14px system-ui, sans-serif';
  ['Overview', 'Revenue', 'Customers', 'Experiments', 'Settings'].forEach((label, i) => {
    if (i === 0) {
      g.fillStyle = '#262a36';
      roundRect(g, 12, 100 + i * 40, 196, 32, 8);
      g.fill();
    }
    g.fillStyle = i === 0 ? '#ffffff' : '#8b90a0';
    g.fillText(label, 28, 121 + i * 40);
  });

  // KPI cards
  const kpis: [string, string, string][] = [
    ['Revenue', '$84,210', '+12.4%'],
    ['Active users', '23,904', '+4.1%'],
    ['Conversion', '3.82%', '+0.6%'],
  ];
  kpis.forEach(([label, value, delta], i) => {
    const x = 248 + i * 334;
    g.fillStyle = '#171a22';
    roundRect(g, x, 64, 314, 120, 14);
    g.fill();
    g.fillStyle = '#8b90a0';
    g.font = '14px system-ui, sans-serif';
    g.fillText(label, x + 20, 96);
    g.fillStyle = '#ffffff';
    g.font = '700 32px system-ui, sans-serif';
    g.fillText(value, x + 20, 140);
    g.fillStyle = '#3ddc97';
    g.font = '600 13px system-ui, sans-serif';
    g.fillText(delta, x + 20, 166);
  });

  // Chart card
  const cx = 248, cy = 204, cw = 1004, ch = 520;
  g.fillStyle = '#171a22';
  roundRect(g, cx, cy, cw, ch, 14);
  g.fill();
  g.fillStyle = '#e6e8ee';
  g.font = '600 16px system-ui, sans-serif';
  g.fillText('Weekly revenue', cx + 24, cy + 40);
  g.strokeStyle = '#232735';
  g.lineWidth = 1;
  for (let i = 0; i < 5; i++) {
    const y = cy + 90 + i * 95;
    g.beginPath();
    g.moveTo(cx + 24, y);
    g.lineTo(cx + cw - 24, y);
    g.stroke();
  }
  const pts = Array.from({ length: 24 }, (_, i) => {
    const v = 0.35 + 0.25 * Math.sin(i * 0.55) + i * 0.018 + 0.05 * Math.cos(i * 1.7);
    return [cx + 24 + (i / 23) * (cw - 48), cy + ch - 40 - v * 380] as const;
  });
  const grad = g.createLinearGradient(0, cy + 60, 0, cy + ch - 40);
  grad.addColorStop(0, 'rgba(124,92,255,0.45)');
  grad.addColorStop(1, 'rgba(124,92,255,0)');
  g.beginPath();
  g.moveTo(pts[0]![0], cy + ch - 40);
  pts.forEach(([x, y]) => g.lineTo(x, y));
  g.lineTo(pts[pts.length - 1]![0], cy + ch - 40);
  g.closePath();
  g.fillStyle = grad;
  g.fill();
  g.beginPath();
  pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
  g.strokeStyle = '#8f7bff';
  g.lineWidth = 3;
  g.stroke();
  return c;
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.roundRect(x, y, w, h, r);
}
