import { useEffect, useRef, useState } from 'react';
import { evaluate, type Doc } from '@/doc';
import { assetStore } from '@/assets/assetStore';
import { fontLibrary } from '@/text/fontLibrary';
import { createBackend, type RenderBackend, type RenderStats } from '@/render/backend';
import { frameStats } from '@/bench/frameStats';

interface ViewportProps {
  doc: Doc;
  time: number;
  forceWebGL: boolean;
  /** Bench mode: render every frame even when nothing changed. */
  continuous?: boolean;
  onFrame?: (now: number) => void;
  onStats?: (s: RenderStats) => void;
  onError?: (msg: string | null) => void;
}

/**
 * Owns the preview canvas + backend. Fits the comp into the available space (letterboxed),
 * renders on demand, and rebuilds everything from the document after device/context loss.
 */
export function Viewport({ doc, time, forceWebGL, continuous, onFrame, onStats, onError }: ViewportProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [epoch, setEpoch] = useState(0); // bump to recreate the backend (device loss)
  const live = useRef({ doc, time, continuous, onFrame, onStats, dirty: true });
  live.current = { ...live.current, doc, time, continuous, onFrame, onStats };
  live.current.dirty = true;

  useEffect(() => {
    const host = hostRef.current!;
    const canvas = document.createElement('canvas');
    canvas.className = 'block rounded-sm shadow-2xl shadow-black/50';
    canvas.setAttribute('aria-label', 'Composition preview');
    canvas.setAttribute('role', 'img');
    host.appendChild(canvas);

    let backend: RenderBackend | null = null;
    let raf = 0;
    let disposed = false;
    const markDirty = () => (live.current.dirty = true);
    const unsubs = [fontLibrary.onChange(markDirty), assetStore.onChange(markDirty)];

    const fit = () => {
      if (!backend) return;
      const { width: cw, height: ch } = live.current.doc.comp;
      const pad = 32;
      const availW = Math.max(1, host.clientWidth - pad * 2);
      const availH = Math.max(1, host.clientHeight - pad * 2);
      const s = Math.min(availW / cw, availH / ch);
      const w = Math.max(1, Math.floor(cw * s));
      const h = Math.max(1, Math.floor(ch * s));
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      backend.setSize(w, h, Math.min(window.devicePixelRatio || 1, 2));
      markDirty();
    };
    const ro = new ResizeObserver(fit);

    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const l = live.current;
      l.onFrame?.(now);
      if (!backend || (!l.dirty && !l.continuous)) return;
      l.dirty = false;
      const t0 = performance.now();
      backend.render(evaluate(l.doc, live.current.time));
      frameStats.push(now, performance.now() - t0);
      l.onStats?.(backend.stats());
    };

    createBackend({ canvas, forceWebGL })
      .then((b) => {
        if (disposed) return b.dispose();
        backend = b;
        b.onLost = (reason) => {
          onError?.(`GPU device lost (${reason}). Recovering…`);
          setTimeout(() => setEpoch((e) => e + 1), 250);
        };
        onError?.(null);
        frameStats.reset();
        ro.observe(host);
        fit();
        raf = requestAnimationFrame(loop);
      })
      .catch((err: unknown) => onError?.(`Could not start the renderer: ${String(err)}`));

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      unsubs.forEach((u) => u());
      backend?.dispose();
      canvas.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [forceWebGL, epoch]);

  return <div ref={hostRef} className="relative flex h-full w-full items-center justify-center overflow-hidden" />;
}
