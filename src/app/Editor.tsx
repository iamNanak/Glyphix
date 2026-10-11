import { useCallback, useEffect, useRef, useState } from 'react';
import { Activity, Download, Film, Pause, Play, Redo2, Undo2, X } from 'lucide-react';
import { useEditor } from './store';
import { Viewport } from './Viewport';
import { LayersPanel } from './LayersPanel';
import { Inspector } from './Inspector';
import { Button, IconButton } from './ui';
import { downloadBlob, exportPng, exportVideo } from '@/export/exporter';
import { assetStore, decodeImage } from '@/assets/assetStore';
import { layerIndex } from './store';

export function Editor() {
  const doc = useEditor((s) => s.doc);
  const time = useEditor((s) => s.time);
  const forceWebGL = useEditor((s) => s.forceWebGL);
  const [backend, setBackend] = useState<string>('…');
  const [error, setError] = useState<string | null>(null);
  usePlaybackClock();
  useShortcuts();
  usePasteImage(setError);

  return (
    <div className="grid h-full grid-rows-[48px_1fr_88px] bg-surface text-sm">
      <Toolbar backend={backend} />
      <div className="grid min-h-0 grid-cols-[220px_1fr_288px]">
        <LayersPanel />
        <main className="relative min-h-0 min-w-0 bg-[radial-gradient(circle_at_center,#16161f_0,#0b0b0f_70%)]">
          <Viewport doc={doc} time={time} forceWebGL={forceWebGL} onStats={(s) => setBackend(s.backend)} onError={setError} />
          {error && (
            <div role="alert" className="absolute top-3 left-1/2 -translate-x-1/2 rounded-md bg-red-500/15 px-3 py-2 text-xs text-red-200 ring-1 ring-red-500/40">
              {error}
            </div>
          )}
          <p className="pointer-events-none absolute bottom-2 left-1/2 -translate-x-1/2 text-xs text-muted">Paste or drop a screenshot to replace the image</p>
        </main>
        <Inspector />
      </div>
      <Timeline />
    </div>
  );
}

// ---------------------------------------------------------------------------

function Toolbar({ backend }: { backend: string }) {
  const { undo, redo, canUndo, canRedo, forceWebGL, setForceWebGL } = useEditor();
  const doc = useEditor((s) => s.doc);
  const time = useEditor((s) => s.time);
  const [progress, setProgress] = useState<number | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const onPng = async () => {
    setStatus('Rendering PNG…');
    try {
      const blob = await exportPng(doc, time, { forceWebGL });
      downloadBlob(blob, `${doc.name}.png`);
      setStatus(null);
    } catch (e) {
      setStatus(`PNG export failed: ${String(e)}`);
    }
  };

  const onVideo = async () => {
    const ac = new AbortController();
    abortRef.current = ac;
    setProgress(0);
    setStatus(null);
    try {
      const res = await exportVideo(doc, { forceWebGL, signal: ac.signal, onProgress: setProgress });
      downloadBlob(res.blob, `${doc.name}.${res.extension.replace(/^\./, '')}`);
      setStatus(`Exported ${res.codec.toUpperCase()} in ${(res.ms / 1000).toFixed(1)} s`);
    } catch (e) {
      setStatus((e as Error).name === 'AbortError' ? 'Export cancelled' : `Video export failed: ${String(e)}`);
    } finally {
      setProgress(null);
      abortRef.current = null;
    }
  };

  return (
    <header className="flex items-center gap-2 border-b border-line bg-panel px-3">
      <span className="mr-3 text-[15px] font-semibold tracking-tight">
        Glyph<span className="text-accent">ix</span>
      </span>
      <IconButton label="Undo (Ctrl+Z)" onClick={undo} disabled={!canUndo}>
        <Undo2 size={16} />
      </IconButton>
      <IconButton label="Redo (Ctrl+Shift+Z)" onClick={redo} disabled={!canRedo}>
        <Redo2 size={16} />
      </IconButton>

      <div className="ml-auto flex items-center gap-2">
        {status && <span className="text-xs text-muted" role="status">{status}</span>}
        <label className="flex items-center gap-2 rounded-md px-2 py-1 text-xs text-muted ring-1 ring-line">
          <input type="checkbox" checked={forceWebGL} onChange={(e) => setForceWebGL(e.target.checked)} />
          Force WebGL2
          <span className="rounded bg-white/8 px-1.5 py-0.5 font-mono text-[10px] text-zinc-300 uppercase">{backend}</span>
        </label>
        <a href="#/bench" className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-xs text-muted hover:text-white">
          <Activity size={14} /> Bench
        </a>
        <Button onClick={onPng} disabled={progress !== null}>
          <Download size={14} /> PNG
        </Button>
        {progress === null ? (
          <Button variant="primary" onClick={onVideo}>
            <Film size={14} /> Export video
          </Button>
        ) : (
          <Button variant="primary" onClick={() => abortRef.current?.abort()} aria-label="Cancel export">
            <X size={14} /> {Math.round(progress * 100)}%
          </Button>
        )}
      </div>
    </header>
  );
}

// ---------------------------------------------------------------------------

function Timeline() {
  const { time, playing, setPlaying, setTime } = useEditor();
  const { duration, fps } = useEditor((s) => s.doc.comp);
  const frame = Math.floor(time * fps);
  return (
    <footer className="flex items-center gap-4 border-t border-line bg-panel px-4">
      <IconButton label={playing ? 'Pause (Space)' : 'Play (Space)'} onClick={() => setPlaying(!playing)} className="h-10 w-10">
        {playing ? <Pause size={18} /> : <Play size={18} />}
      </IconButton>
      <div className="flex-1">
        <input
          type="range"
          aria-label="Playhead"
          className="w-full"
          min={0}
          max={duration}
          step={1 / fps}
          value={time}
          onChange={(e) => {
            setPlaying(false);
            setTime(Number(e.target.value));
          }}
        />
        <div className="mt-1 flex justify-between font-mono text-[11px] text-muted tabular-nums">
          <span>
            {time.toFixed(2)}s · frame {frame}
          </span>
          <span>
            {duration.toFixed(1)}s @ {fps}fps
          </span>
        </div>
      </div>
    </footer>
  );
}

// ---------------------------------------------------------------------------

function usePlaybackClock() {
  useEffect(() => {
    let raf = 0;
    let last = 0;
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const s = useEditor.getState();
      if (s.playing && last) {
        const dur = s.doc.comp.duration;
        let t = s.time + (now - last) / 1000;
        if (t >= dur) t = s.loop ? t % dur : dur;
        s.setTime(t);
        if (!s.loop && t >= dur) s.setPlaying(false);
      }
      last = now;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
}

function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const typing = target.closest('input, textarea, select, [contenteditable]') && !(target instanceof HTMLInputElement && target.type === 'range');
      const s = useEditor.getState();
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'z' && !typing) {
        e.preventDefault();
        if (e.shiftKey) s.redo();
        else s.undo();
      } else if (mod && e.key.toLowerCase() === 'y' && !typing) {
        e.preventDefault();
        s.redo();
      } else if (e.key === ' ' && !typing) {
        e.preventDefault();
        s.setPlaying(!s.playing);
      } else if (e.key === 'Home' && !typing) {
        s.setTime(0);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

function usePasteImage(onError: (msg: string | null) => void) {
  const place = useCallback(
    async (file: File) => {
      try {
        const bmp = await decodeImage(file);
        const id = `img-${Date.now().toString(36)}`;
        assetStore.put(id, bmp);
        const s = useEditor.getState();
        const idx = layerIndex(s.doc, 'shot');
        if (idx < 0) return;
        // Fit inside the comp with a 10% margin, never upscaling past 1:1.
        const { width: cw, height: ch } = s.doc.comp;
        const fit = Math.min(1, (cw * 0.72) / bmp.width, (ch * 0.72) / bmp.height);
        s.set('Replace screenshot', [
          { path: ['comp', 'layers', idx, 'assetId'], value: id },
          { path: ['comp', 'layers', idx, 'width'], value: Math.round(bmp.width * fit) },
          { path: ['comp', 'layers', idx, 'height'], value: Math.round(bmp.height * fit) },
        ]);
      } catch (e) {
        onError(`Could not read that image: ${String(e)}`);
      }
    },
    [onError],
  );

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const file = [...(e.clipboardData?.files ?? [])].find((f) => f.type.startsWith('image/'));
      if (file) {
        e.preventDefault();
        void place(file);
      }
    };
    const onDragOver = (e: DragEvent) => e.preventDefault();
    const onDrop = (e: DragEvent) => {
      const file = [...(e.dataTransfer?.files ?? [])].find((f) => f.type.startsWith('image/'));
      if (file) {
        e.preventDefault();
        void place(file);
      }
    };
    window.addEventListener('paste', onPaste);
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('paste', onPaste);
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('drop', onDrop);
    };
  }, [place]);
}
