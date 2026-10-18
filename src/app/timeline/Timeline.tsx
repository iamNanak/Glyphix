// The timeline dock under the canvas: transport header, time ruler, one row per layer. Only the playhead line
// and timecode follow the clock (store subscriptions writing to the DOM); nothing here re-renders while playing.
import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Blend, ChevronDown, ChevronUp, Eye, EyeOff, Film, Image, Lock, Maximize2, Pause, Play, Repeat, Square, Type, Unlock, ZoomIn, ZoomOut } from 'lucide-react';
import { useEditor } from '../store';
import { Select } from '@/components/wensity/select';
import { IconButton, inputClass } from '../ui';
import { LayerBar } from './LayerBar';
import { Ruler } from './Ruler';
import { END_PAD, fitZoom, HEADER_H, NAME_W, ROW_H, RULER_H, useTimelineView, zoomLimits } from './view';

export function Timeline() {
  const collapsed = useTimelineView((s) => s.collapsed);
  const height = useTimelineView((s) => s.height);
  return (
    <footer aria-label="Timeline" className="relative flex min-h-0 flex-col border-t border-line bg-panel" style={{ height: collapsed ? HEADER_H : height }}>
      {!collapsed && <ResizeHandle />}
      <Header />
      {!collapsed && <Tracks />}
    </footer>
  );
}

function ResizeHandle() {
  const height = useTimelineView((s) => s.height);
  const { setHeight } = useTimelineView.getState();
  const start = useRef<{ y: number; h: number } | null>(null);
  return (
    <div
      role="separator"
      tabIndex={0}
      aria-orientation="horizontal"
      aria-label="Resize timeline"
      aria-valuenow={height}
      className="absolute inset-x-0 -top-1 z-40 h-2 cursor-ns-resize touch-none outline-none hover:bg-accent/40 focus-visible:bg-accent/60"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        start.current = { y: e.clientY, h: useTimelineView.getState().height };
      }}
      onPointerMove={(e) => start.current && setHeight(start.current.h - (e.clientY - start.current.y))}
      onPointerUp={() => (start.current = null)}
      onKeyDown={(e) => {
        const d = { ArrowUp: 24, ArrowDown: -24 }[e.key];
        if (!d) return;
        e.preventDefault();
        e.stopPropagation();
        setHeight(height + d);
      }}
    />
  );
}

// ---------------------------------------------------------------------------

function Header() {
  const playing = useEditor((s) => s.playing);
  const duration = useEditor((s) => s.doc.comp.duration);
  const fps = useEditor((s) => s.doc.comp.fps);
  const loop = useEditor((s) => s.loop);
  const collapsed = useTimelineView((s) => s.collapsed);
  const { setPlaying, setTime, setLoop, set } = useEditor.getState();
  const view = useTimelineView.getState();
  return (
    <div className="flex shrink-0 items-center gap-3 border-b border-line px-3" style={{ height: HEADER_H }}>
      <IconButton label={playing ? 'Pause (Space)' : 'Play (Space)'} onClick={() => setPlaying(!playing)} className="h-8 w-8">
        {playing ? <Pause size={16} /> : <Play size={16} />}
      </IconButton>
      <Timecode fps={fps} duration={duration} />
      <IconButton label={loop ? 'Looping playback (on)' : 'Looping playback (off)'} active={loop} onClick={() => setLoop(!loop)}>
        <Repeat size={15} />
      </IconButton>
      <span className="h-5 w-px bg-line" aria-hidden />
      <label className="flex items-center gap-1.5 text-[11px] text-dim">
        Length
        <input
          type="number"
          aria-label="Video length in seconds"
          className={`${inputClass} w-16 py-0.5`}
          min={0.5}
          max={60}
          step={0.5}
          value={duration}
          onChange={(e) => {
            const v = Number(e.target.value);
            if (v >= 0.5 && v <= 60) {
              set('Video length', [{ path: ['comp', 'duration'], value: v }], 'comp-duration');
              if (useEditor.getState().time > v) setTime(v);
            }
          }}
        />
        s
      </label>
      <div className="w-24">
        <Select
          aria-label="Frame rate"
          selectSize="sm"
          fullWidth
          value={String(fps)}
          options={[24, 30, 60].map((f) => ({ value: String(f), label: `${f} fps` }))}
          onValueChange={(f) => set('Frame rate', [{ path: ['comp', 'fps'], value: Number(f) }])}
        />
      </div>
      <div className="ml-auto flex items-center gap-1">
        {!collapsed && (
          <>
            <IconButton label="Zoom out (Ctrl+wheel)" onClick={() => view.setZoom(stepZoom(1 / 1.5))}>
              <ZoomOut size={15} />
            </IconButton>
            <IconButton label="Fit timeline" onClick={() => view.setZoom(null)}>
              <Maximize2 size={14} />
            </IconButton>
            <IconButton label="Zoom in (Ctrl+wheel)" onClick={() => view.setZoom(stepZoom(1.5))}>
              <ZoomIn size={15} />
            </IconButton>
          </>
        )}
        <IconButton label={collapsed ? 'Expand timeline' : 'Collapse timeline'} onClick={() => view.setCollapsed(!collapsed)}>
          {collapsed ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </IconButton>
      </div>
    </div>
  );
}

/** Current zoom × factor, within limits (the tracks publish their fit zoom for this). */
let lastFit = 100;
function stepZoom(factor: number) {
  const { zoom } = useTimelineView.getState();
  const [lo, hi] = zoomLimits(lastFit, useEditor.getState().doc.comp.fps);
  return Math.max(lo, Math.min(hi, (zoom ?? lastFit) * factor));
}

function Timecode({ fps, duration }: { fps: number; duration: number }) {
  const el = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const show = (t: number) => {
      el.current!.textContent = `${t.toFixed(2)}s · frame ${Math.round(t * fps)} / ${Math.round(duration * fps)}`;
    };
    show(useEditor.getState().time);
    return useEditor.subscribe((s, prev) => s.time !== prev.time && show(s.time));
  }, [fps, duration]);
  return <span ref={el} className="w-44 font-mono text-[11px] text-zinc-300 tabular-nums" />;
}

// ---------------------------------------------------------------------------

function Tracks() {
  const scroller = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ width: 0, scrollLeft: 0 });
  const duration = useEditor((s) => s.doc.comp.duration);
  const fps = useEditor((s) => s.doc.comp.fps);
  const zoom = useTimelineView((s) => s.zoom);
  // Top of the list = front-most layer, as in the Layers panel.
  const ids = useEditor((s) => s.doc.comp.layers.map((l) => l.id).join('\u0001'));
  const rows = ids.split('\u0001').reverse();

  const fit = fitZoom(box.width, duration);
  lastFit = fit;
  const [lo, hi] = zoomLimits(fit, fps);
  const pps = zoom === null ? fit : Math.max(lo, Math.min(hi, zoom));

  useLayoutEffect(() => {
    const node = scroller.current!;
    let raf = 0;
    const measure = () => setBox({ width: node.clientWidth, scrollLeft: node.scrollLeft });
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(measure);
    };
    const ro = new ResizeObserver(measure);
    ro.observe(node);
    node.addEventListener('scroll', onScroll, { passive: true });
    measure();
    return () => {
      ro.disconnect();
      node.removeEventListener('scroll', onScroll);
      cancelAnimationFrame(raf);
    };
  }, []);

  // Ctrl/Cmd + wheel zooms around the pointer.
  const anchor = useRef<{ t: number; x: number } | null>(null);
  const ppsRef = useRef(pps);
  ppsRef.current = pps;
  useEffect(() => {
    const node = scroller.current!;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const x = e.clientX - node.getBoundingClientRect().left;
      const cur = ppsRef.current;
      anchor.current = { t: (x + node.scrollLeft - NAME_W) / cur, x };
      const [a, b] = zoomLimits(lastFit, useEditor.getState().doc.comp.fps);
      useTimelineView.getState().setZoom(Math.max(a, Math.min(b, cur * Math.exp(-e.deltaY * 0.002))));
    };
    node.addEventListener('wheel', onWheel, { passive: false });
    return () => node.removeEventListener('wheel', onWheel);
  }, []);
  useLayoutEffect(() => {
    const a = anchor.current;
    if (!a) return;
    anchor.current = null;
    scroller.current!.scrollLeft = a.t * pps + NAME_W - a.x;
  }, [pps]);

  return (
    <div ref={scroller} role="region" aria-label="Timeline tracks" className="relative min-h-0 flex-1 overflow-auto overscroll-contain" tabIndex={-1}>
      <div className="relative" style={{ width: NAME_W + duration * pps + END_PAD, minHeight: '100%' }}>
        <div className="sticky top-0 z-20 flex border-b border-line bg-panel">
          <div className="sticky left-0 z-30 shrink-0 border-r border-line bg-panel" style={{ width: NAME_W, height: RULER_H }} />
          <Ruler pps={pps} duration={duration} fps={fps} scrollLeft={box.scrollLeft} viewWidth={box.width} />
        </div>
        <ul aria-label="Timeline layers">
          {rows.map((id) => (
            <LayerRow key={id} id={id} pps={pps} />
          ))}
        </ul>
        <Playhead pps={pps} scroller={scroller} />
      </div>
    </div>
  );
}

/** The red line: positioned by a store subscription so playback never re-renders the panel. */
function Playhead({ pps, scroller }: { pps: number; scroller: React.RefObject<HTMLDivElement | null> }) {
  const el = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const place = (t: number, playing: boolean) => {
      const x = NAME_W + t * pps;
      el.current!.style.transform = `translateX(${x}px)`;
      // While playing, page along so the line stays in view.
      const node = scroller.current;
      if (playing && node && (x < node.scrollLeft + NAME_W || x > node.scrollLeft + node.clientWidth - 8)) node.scrollLeft = x - NAME_W - 8;
    };
    const s0 = useEditor.getState();
    place(s0.time, false);
    return useEditor.subscribe((s, prev) => s.time !== prev.time && place(s.time, s.playing));
  }, [pps, scroller]);
  return (
    <div ref={el} aria-hidden className="pointer-events-none absolute top-0 bottom-0 left-0 z-25 w-px bg-red-500">
      <div className="absolute -top-px -left-[5px] h-0 w-0 border-x-[5.5px] border-t-[7px] border-x-transparent border-t-red-500" />
    </div>
  );
}

// ---------------------------------------------------------------------------

const icons = { background: Square, image: Image, video: Film, text: Type, adjustment: Blend } as const;

const LayerRow = memo(function LayerRow({ id, pps }: { id: string; pps: number }) {
  const layer = useEditor((s) => s.doc.comp.layers.find((l) => l.id === id));
  const selected = useEditor((s) => s.selectedId === id);
  const duration = useEditor((s) => s.doc.comp.duration);
  if (!layer) return null;
  const s = useEditor.getState();
  const Icon = icons[layer.type === 'image' && layer.video ? 'video' : layer.type];
  return (
    <li aria-label={layer.name} className={`flex border-b border-line/60 ${selected ? 'bg-accent/10' : ''}`} style={{ height: ROW_H }}>
      <div className={`group sticky left-0 z-30 flex shrink-0 items-center gap-1 border-r border-line px-2 ${selected ? 'bg-[color-mix(in_srgb,var(--color-accent)_10%,var(--color-panel))]' : 'bg-panel'}`} style={{ width: NAME_W }}>
        <button type="button" aria-pressed={selected} className={`flex min-w-0 flex-1 items-center gap-1.5 text-left text-xs ${selected ? 'text-white' : 'text-zinc-300'}`} onClick={() => s.select(id)}>
          <Icon size={13} className="shrink-0 text-dim" />
          <span className={`truncate ${layer.visible ? '' : 'opacity-40'}`}>{layer.name}</span>
        </button>
        <button
          type="button"
          aria-label={layer.locked ? `Unlock ${layer.name}` : `Lock ${layer.name}`}
          className={`rounded p-0.5 text-dim hover:text-white ${layer.locked ? '' : 'opacity-0 group-hover:opacity-70 focus-visible:opacity-100'}`}
          onClick={() => s.toggleLayer(id, 'locked')}
        >
          {layer.locked ? <Lock size={12} /> : <Unlock size={12} />}
        </button>
        <button type="button" aria-label={layer.visible ? `Hide ${layer.name}` : `Show ${layer.name}`} className="rounded p-0.5 text-dim hover:text-white" onClick={() => s.toggleLayer(id, 'visible')}>
          {layer.visible ? <Eye size={13} /> : <EyeOff size={13} />}
        </button>
      </div>
      <div className="relative flex-1">
        <LayerBar layer={layer} pps={pps} duration={duration} />
      </div>
    </li>
  );
});
