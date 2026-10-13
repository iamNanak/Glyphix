import { createDemoDoc, createEffect, defaultEnter, defaultExit, defaultLoop, Easings, REST_POSE, type Doc, type ImageLayer, type TextLayer } from '@/doc';
import { assetStore } from '@/assets/assetStore';
import { createDemoScreenshot } from '@/assets/demoScreenshot';

const LOREM =
  'Glyphix renders every letter on the GPU so headlines can ripple, cascade and glow without dropping frames. ';

function textOfLength(n: number, perLine: number): string {
  let s = '';
  while (s.replace(/\s/g, '').length < n) s += LOREM;
  // Trim to exactly n non-space glyphs, then wrap.
  let count = 0;
  let out = '';
  for (const ch of s) {
    if (count >= n) break;
    out += ch;
    if (!/\s/.test(ch)) count++;
  }
  const words = out.split(' ');
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    if ((line + ' ' + w).length > perLine && line) {
      lines.push(line);
      line = w;
    } else line = line ? `${line} ${w}` : w;
  }
  if (line) lines.push(line);
  return lines.join('\n');
}

function glyphScene(n: number, kinetic = false): Doc {
  const doc = createDemoDoc();
  doc.name = `${n} glyphs`;
  const headline = doc.comp.layers.find((l) => l.id === 'headline') as TextLayer;
  headline.text = textOfLength(n, n > 500 ? 64 : 44);
  headline.fontSize = n > 500 ? 26 : 40;
  headline.transform.y = { static: 540 };
  headline.align = 'center';
  headline.animator = {
    unit: 'glyph',
    order: 'random',
    start: 0.1,
    duration: 0.8,
    stagger: 3 / n,
    falloff: Easings.linear,
    seed: 3,
    easing: Easings.easeOutBack,
    pose: { ...REST_POSE, offsetY: 40, scaleX: 0.2, scaleY: 0.2, rotation: -30, opacity: 0 },
  };
  if (kinetic) {
    // Enter + exit + emphasis running at once: the Phase 2 stress case.
    headline.animator = null;
    headline.motion = {
      enter: { ...defaultEnter('flip-up', 0), duration: 2.5 },
      exit: { ...defaultExit('scatter-out'), duration: 2.5 },
      loop: defaultLoop('wave', doc.comp),
    };
    headline.outline = { width: 2, color: [0, 0, 0, 1] };
    headline.shadow = { offsetX: 0, offsetY: 4, blur: 6, color: [0, 0, 0, 0.5] };
  }
  doc.comp.layers = doc.comp.layers.filter((l) => l.id !== 'shot');
  return doc;
}

const BIG_ASSETS = 10;

function bigScene(): Doc {
  const doc = createDemoDoc();
  doc.name = '4K × 10 layers';
  doc.comp.width = 3840;
  doc.comp.height = 2160;
  const template = doc.comp.layers.find((l) => l.id === 'shot') as ImageLayer;
  const layers: ImageLayer[] = [];
  for (let i = 0; i < BIG_ASSETS; i++) {
    const id = `bench-4k-${i}`;
    // Each layer gets its own 4K texture so VRAM and upload costs are real.
    if (!assetStore.get(id)) assetStore.put(id, createDemoScreenshot(1920, 1080, 2));
    layers.push({
      ...template,
      id: `shot-${i}`,
      name: `Screenshot ${i + 1}`,
      assetId: id,
      width: 1920,
      height: 1080,
      radius: 24,
      shadow: { blur: 80, offsetX: 0, offsetY: 40, color: [0, 0, 0, 0.5] },
      opacity: { static: 1 },
      transform: {
        x: { track: { keys: [{ t: 0, v: 900 + i * 200, out: Easings.easeInOutCubic }, { t: 2.5, v: 1100 + i * 200, out: Easings.easeInOutCubic }, { t: 5, v: 900 + i * 200, out: Easings.linear }] } },
        y: { static: 700 + i * 80 },
        scale: { static: 1 },
        rotation: { static: (i - 5) * 2 },
      },
    });
  }
  const bg = doc.comp.layers[0]!;
  const headline = doc.comp.layers.find((l) => l.id === 'headline') as TextLayer;
  doc.comp.layers = [bg, ...layers, { ...headline, fontSize: 192, transform: { ...headline.transform, x: { static: 1920 }, y: { static: 260 } } }];
  return doc;
}

/** One 4K image with three effects (blur-based glow, animated displacement, animated grain). */
function fxScene(): Doc {
  const doc = createDemoDoc();
  doc.name = '4K layer + 3 effects';
  doc.comp.width = 3840;
  doc.comp.height = 2160;
  const shot = doc.comp.layers.find((l) => l.id === 'shot') as ImageLayer;
  const id = 'bench-4k-fx';
  if (!assetStore.get(id)) assetStore.put(id, createDemoScreenshot(1920, 1080, 2));
  const glow = createEffect('glow');
  glow.params.radius = { static: 40 };
  const displace = createEffect('displace');
  displace.params.speed = { static: 1 };
  Object.assign(shot, {
    assetId: id,
    width: 3200,
    height: 1800,
    effects: [glow, displace, createEffect('grain')],
    transform: { ...shot.transform, x: { static: 1920 }, y: { static: 1140 }, rotation: { track: { keys: [{ t: 0, v: -2, out: Easings.easeInOutCubic }, { t: 2.5, v: 2, out: Easings.easeInOutCubic }, { t: 5, v: -2, out: Easings.linear }] } } },
  });
  const headline = doc.comp.layers.find((l) => l.id === 'headline') as TextLayer;
  Object.assign(headline, { fontSize: 160, transform: { ...headline.transform, x: { static: 1920 }, y: { static: 140 } } });
  return doc;
}

export const SCENES: Record<string, { label: string; build: () => Doc }> = {
  demo: { label: 'Demo', build: () => createDemoDoc() },
  g300: { label: '300 glyphs', build: () => glyphScene(300) },
  g1000: { label: '1000 glyphs', build: () => glyphScene(1000) },
  k300: { label: '300 glyphs, enter + exit + wave', build: () => glyphScene(300, true) },
  big: { label: '4K + 10 layers', build: bigScene },
  fx: { label: '4K layer + 3 effects', build: fxScene },
};

/** Rough VRAM estimate in MB: textures (with mips) + glyph atlas + drawing buffer. */
export function estimateVramMB(doc: Doc, canvasPixels: number): number {
  let bytes = 2048 * 2048; // R8 glyph atlas, first page
  const seen = new Set<string>();
  for (const l of doc.comp.layers) {
    if (l.type !== 'image' || seen.has(l.assetId)) continue;
    seen.add(l.assetId);
    const a = assetStore.get(l.assetId);
    if (a) bytes += a.width * a.height * 4 * 1.33;
  }
  bytes += canvasPixels * 4 * 3; // colour + MSAA resolve + depth, approximately
  return bytes / (1024 * 1024);
}
