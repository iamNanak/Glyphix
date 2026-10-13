import { useEffect, useRef, useState, type ReactNode } from 'react';
import { evaluate, type Doc } from '@/doc';
import { assetStore } from '@/assets/assetStore';
import { fontLibrary } from '@/text/fontLibrary';
import { createBackend, type RenderBackend, type RenderStats, type View } from '@/render/backend';
import { frameStats } from '@/bench/frameStats';
import { fitView } from '@/editor/viewStore';
import { createPreviewFrames, type PreviewFrames } from '@/video/previewFrames';
import { PreviewAudio } from '@/video/previewAudio';

interface ViewportProps {
  doc: Doc;
  time: number;
  /** The timeline is playing (video layers play live, with sound). */
  playing?: boolean;
  forceWebGL: boolean;
  /** Where the comp sits in the panel. Omit to always fit. */
  view?: View;
  onHostResize?: (width: number, height: number) => void;
  /** Bench mode: render every frame even when nothing changed. */
  continuous?: boolean;
  onFrame?: (now: number) => void;
  onStats?: (s: RenderStats) => void;
  onError?: (msg: string | null) => void;
  /** Overlay content (selection handles etc.), positioned over the canvas. */
  children?: ReactNode;
}

/**
 * Owns the preview canvas + backend. The canvas fills the panel; the comp is placed by `view`.
 * Renders on demand and rebuilds everything from the document after device/context loss.
 */
export function Viewport({ doc, time, playing = false, forceWebGL, view, onHostResize, continuous, onFrame, onStats, onError, children }: ViewportProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasHostRef = useRef<HTMLDivElement>(null);
  const [epoch, setEpoch] = useState(0); // bump to recreate the backend (device loss)
  const [hostSize, setHostSize] = useState({ width: 1, height: 1 });
  const effectiveView = view ?? fitView(hostSize, doc.comp);
  const live = useRef({ doc, time, playing, view: effectiveView, continuous, onFrame, onStats, dirty: true });
  live.current = { ...live.current, doc, time, playing, view: effectiveView, continuous, onFrame, onStats, dirty: true };

  useEffect(() => {
    const host = hostRef.current!;
    const canvasHost = canvasHostRef.current!;
    const canvas = document.createElement('canvas');
    canvas.className = 'absolute inset-0 block h-full w-full';
    canvas.setAttribute('aria-label', 'Composition preview');
    canvas.setAttribute('role', 'img');
    canvasHost.appendChild(canvas);

    let backend: RenderBackend | null = null;
    let raf = 0;
    let disposed = false;
    const markDirty = () => (live.current.dirty = true);
    const frames: PreviewFrames = createPreviewFrames();
    const audio = new PreviewAudio();
    // Dev only: tests read playback sync stats from here.
    if (import.meta.env.DEV) Object.assign(window, { __glyphixFrames: frames, __glyphixAudio: audio });
    // Video frames: render now with what's there, and once more when prepare() brings new frames.
    // One prepare in flight at a time; the latest request wins.
    let preparing = false;
    let pending: ReturnType<typeof evaluate> | null = null;
    const prepare = (list: ReturnType<typeof evaluate>) => {
      if (!list.items.some((i) => i.kind === 'image' && i.video)) return;
      if (preparing) return void (pending = list);
      preparing = true;
      const before = frames.version;
      backend!
        .prepare(list)
        .catch((e: unknown) => console.warn('[glyphix] video frame', e))
        .finally(() => {
          preparing = false;
          if (frames.version !== before) markDirty();
          const next = pending;
          pending = null;
          if (next && !disposed) prepare(next);
        });
    };
    const unsubs = [fontLibrary.onChange(markDirty), assetStore.onChange(markDirty)];

    const resize = () => {
      const w = Math.max(1, host.clientWidth);
      const h = Math.max(1, host.clientHeight);
      backend?.setSize(w, h, Math.min(window.devicePixelRatio || 1, 2));
      setHostSize({ width: w, height: h });
      onHostResize?.(w, h);
      markDirty();
    };
    const ro = new ResizeObserver(resize);

    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const l = live.current;
      l.onFrame?.(now);
      if (!backend || (!l.dirty && !l.continuous)) return;
      l.dirty = false;
      const t0 = performance.now();
      backend.setView(l.view);
      frames.setPlaying(l.playing);
      audio.setDoc(l.doc);
      audio.update(l.playing, l.time);
      const list = evaluate(l.doc, l.time);
      prepare(list);
      backend.render(list);
      frameStats.push(now, performance.now() - t0);
      l.onStats?.(backend.stats());
    };

    createBackend({ canvas, forceWebGL, frames })
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
        resize();
        raf = requestAnimationFrame(loop);
      })
      .catch((err: unknown) => onError?.(`Could not start the renderer: ${String(err)}`));

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      unsubs.forEach((u) => u());
      backend?.dispose();
      frames.dispose();
      audio.dispose();
      canvas.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [forceWebGL, epoch]);

  const v = effectiveView;
  return (
    <div ref={hostRef} className="relative h-full w-full overflow-hidden">
      {/* Comp backdrop: checkerboard shows transparency; shadow frames the artboard. */}
      <div
        aria-hidden
        className="absolute shadow-2xl shadow-black/60"
        style={{
          left: v.offsetX,
          top: v.offsetY,
          width: doc.comp.width * v.zoom,
          height: doc.comp.height * v.zoom,
          backgroundColor: '#1c1c24',
          backgroundImage: 'conic-gradient(#24242e 25%, transparent 0 50%, #24242e 0 75%, transparent 0)',
          backgroundSize: '16px 16px',
        }}
      />
      <div ref={canvasHostRef} className="absolute inset-0" />
      {children}
    </div>
  );
}
