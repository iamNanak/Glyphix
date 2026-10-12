import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { Viewport } from '@/app/Viewport';
import { Button } from '@/app/ui';
import type { RenderStats } from '@/render/backend';
import { createBackend } from '@/render/backend';
import { exportVideo, renderFrameBitmap } from '@/export/exporter';
import { fontLibrary } from '@/text/fontLibrary';
import { evaluate, type Doc } from '@/doc';
import { frameStats } from './frameStats';
import { estimateVramMB, SCENES } from './scenes';

export default function Bench() {
  const [sceneId, setSceneId] = useState('g300');
  const [forceWebGL, setForceWebGL] = useState(new URLSearchParams(location.search).has('webgl'));
  const doc = useMemo(() => SCENES[sceneId]!.build(), [sceneId]);
  const [time, setTime] = useState(0);
  const [stats, setStats] = useState<RenderStats | null>(null);
  const [summary, setSummary] = useState(frameStats.summary());
  const [results, setResults] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const log = (line: string) => setResults((r) => [line, ...r].slice(0, 12));

  useEffect(() => {
    frameStats.reset();
    const id = setInterval(() => setSummary(frameStats.summary()), 500);
    return () => clearInterval(id);
  }, [sceneId, forceWebGL]);

  const onFrame = useMemo(() => {
    let start = 0;
    return (now: number) => {
      if (!start) start = now;
      setTime((((now - start) / 1000) % doc.comp.duration));
    };
  }, [doc]);

  const run = async (name: string, fn: () => Promise<string>) => {
    setBusy(true);
    try {
      log(`${name}: ${await fn()}`);
    } catch (e) {
      log(`${name}: FAILED — ${String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const fps = summary.frameP50 ? 1000 / summary.frameP50 : 0;
  const vram = estimateVramMB(doc, 1920 * 1080);

  return (
    <div className="grid h-full grid-cols-[1fr_340px] bg-app text-sm">
      <main className="relative min-h-0">
        <Viewport doc={doc} time={time} forceWebGL={forceWebGL} continuous onFrame={onFrame} onStats={setStats} />
      </main>
      <aside className="space-y-5 overflow-y-auto border-l border-line bg-panel p-4" aria-label="Benchmark controls">
        <a href="#/" className="inline-flex items-center gap-1.5 text-xs text-dim hover:text-white">
          <ArrowLeft size={14} /> Back to editor
        </a>
        <h1 className="text-lg font-semibold">Bench</h1>

        <div className="grid grid-cols-2 gap-2">
          {Object.entries(SCENES).map(([id, s]) => (
            <Button key={id} variant={id === sceneId ? 'primary' : 'secondary'} onClick={() => setSceneId(id)}>
              {s.label}
            </Button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-xs text-dim">
          <input type="checkbox" checked={forceWebGL} onChange={(e) => setForceWebGL(e.target.checked)} /> Force WebGL2
        </label>

        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-lg bg-panel-2 p-3 font-mono text-xs ring-1 ring-line">
          <Stat k="backend" v={stats?.backend ?? '…'} />
          <Stat k="fps (p50)" v={fps.toFixed(0)} good={fps >= 58} />
          <Stat k="frame p50" v={`${summary.frameP50.toFixed(1)} ms`} />
          <Stat k="frame p95" v={`${summary.frameP95.toFixed(1)} ms`} good={summary.frameP95 <= 20} />
          <Stat k="cpu p50" v={`${summary.cpuP50.toFixed(2)} ms`} />
          <Stat k="cpu p95" v={`${summary.cpuP95.toFixed(2)} ms`} />
          <Stat k="glyphs" v={String(stats?.glyphs ?? 0)} />
          <Stat k="draw calls" v={String(stats?.drawCalls ?? 0)} />
          <Stat k="textures" v={String(stats?.textures ?? 0)} />
          <Stat k="VRAM est." v={`${vram.toFixed(0)} MB`} />
        </dl>
        <p className="text-xs text-dim">Frame time is the rAF interval while rendering continuously (display-capped). CPU is evaluate + render submit.</p>

        <div className="space-y-2">
          <h2 className="text-[11px] font-semibold tracking-wider text-dim uppercase">Gates</h2>
          <Button className="w-full" disabled={busy} onClick={() => run('Determinism', () => determinismCheck(doc, forceWebGL))}>
            Preview = export pixel check
          </Button>
          <Button className="w-full" disabled={busy} onClick={() => run('Backends', () => backendDiff(doc))}>
            WebGPU vs WebGL2 diff
          </Button>
          <Button
            className="w-full"
            disabled={busy}
            onClick={() =>
              run('Export', async () => {
                const r = await exportVideo(doc, { forceWebGL, scale: 1920 / doc.comp.width });
                return `${r.codec} ${doc.comp.duration}s 1080p${doc.comp.fps} in ${(r.ms / 1000).toFixed(2)} s (${(r.blob.size / 1e6).toFixed(1)} MB) ${r.ms <= doc.comp.duration * 1000 ? 'PASS' : 'SLOW'}`;
              })
            }
          >
            Time video export
          </Button>
        </div>
        <ol className="space-y-1 font-mono text-[11px] text-zinc-300" aria-live="polite">
          {results.map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ol>
      </aside>
    </div>
  );
}

function Stat({ k, v, good }: { k: string; v: string; good?: boolean }) {
  return (
    <>
      <dt className="text-dim">{k}</dt>
      <dd className={good === undefined ? '' : good ? 'text-emerald-400' : 'text-amber-400'}>{v}</dd>
    </>
  );
}

// ---------------------------------------------------------------------------

async function pixels(bmp: ImageBitmap): Promise<Uint8ClampedArray> {
  const c = new OffscreenCanvas(bmp.width, bmp.height);
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(bmp, 0, 0);
  return g.getImageData(0, 0, bmp.width, bmp.height).data;
}

/** Share of pixels that are mostly opaque: guards against "two blank frames match". */
function opaqueShare(px: Uint8ClampedArray): number {
  let n = 0;
  for (let i = 3; i < px.length; i += 4) if (px[i]! > 200) n++;
  return n / (px.length / 4);
}

function diff(a: Uint8ClampedArray, b: Uint8ClampedArray) {
  let max = 0;
  let over1 = 0;
  for (let i = 0; i < a.length; i++) {
    const d = Math.abs(a[i]! - b[i]!);
    if (d > max) max = d;
    if (d > 1) over1++;
  }
  return { max, pctOver1: (100 * over1) / a.length };
}

async function renderWith(doc: Doc, t: number, forceWebGL: boolean): Promise<Uint8ClampedArray> {
  await fontLibrary.load('inter');
  const canvas = document.createElement('canvas');
  const b = await createBackend({ canvas, forceWebGL });
  try {
    b.setSize(1920, 1080, 1);
    b.render(evaluate(doc, t)); // warm-up (layout → atlas)
    return await pixels(await renderFrameBitmap(b, doc, t));
  } finally {
    await b.idle().catch(() => {});
    b.dispose();
  }
}

/** Two independent backends (as preview and export use) must agree on the same (doc, t). */
async function determinismCheck(doc: Doc, forceWebGL: boolean): Promise<string> {
  const t = 1.234;
  const [a, b] = [await renderWith(doc, t, forceWebGL), await renderWith(doc, t, forceWebGL)];
  const d = diff(a, b);
  const filled = opaqueShare(a);
  if (filled < 0.5) return `FAIL — rendered frame is ${(filled * 100).toFixed(0)}% opaque (blank readback?)`;
  return `max Δ ${d.max}, ${d.pctOver1.toFixed(3)}% > 1 LSB, ${(filled * 100).toFixed(0)}% opaque → ${d.max <= 1 ? 'PASS' : 'FAIL'}`;
}

async function backendDiff(doc: Doc): Promise<string> {
  const t = 1.234;
  const a = await renderWith(doc, t, false);
  const b = await renderWith(doc, t, true);
  const d = diff(a, b);
  return `max Δ ${d.max}, ${d.pctOver1.toFixed(3)}% of channels > 1 LSB (informational)`;
}
