import { useEffect, useRef, useState } from 'react';
import { Download, X } from 'lucide-react';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/wensity/dialog';
import { Progress } from '@/components/wensity/progress';
import { Switch } from '@/components/wensity/switch';
import { downloadBlob, runExport, type ExportFormat, type ExportResult, type ExportSettings } from '@/export/exporter';
import { useEditor } from './store';
import { Button, PresetGrid, SelectField, SliderField } from './ui';

const FORMATS: { value: ExportFormat; label: string }[] = [
  { value: 'png', label: 'PNG' },
  { value: 'jpeg', label: 'JPEG' },
  { value: 'webp', label: 'WebP' },
  { value: 'mp4', label: 'MP4 video' },
  { value: 'gif', label: 'GIF' },
];

const SCALES: Record<'still' | 'mp4' | 'gif', number[]> = { still: [1, 2, 3, 4], mp4: [0.5, 1, 2], gif: [0.25, 0.5, 0.75, 1] };
const kind = (f: ExportFormat) => (f === 'mp4' ? 'mp4' : f === 'gif' ? 'gif' : 'still');
/** H.264 encoders top out around 4096 px wide on common hardware. */
const MAX_VIDEO_DIM = 4096;

const DEFAULTS: Omit<ExportSettings, 'time'> = { format: 'png', scale: 1, quality: 0.92, transparent: false, gifFps: 20 };
const STORAGE_KEY = 'glyphix.exportSettings';

function loadSettings(): Omit<ExportSettings, 'time'> {
  try {
    return { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Partial<ExportSettings>) };
  } catch {
    return DEFAULTS; // storage blocked/private mode: defaults are fine
  }
}

function saveSettings(s: Omit<ExportSettings, 'time'>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    /* per-viewer convenience only */
  }
}

const fmtBytes = (n: number) => (n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`);

export function ExportDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const comp = useEditor((s) => s.doc.comp);
  const time = useEditor((s) => s.time);
  const forceWebGL = useEditor((s) => s.forceWebGL);
  const [settings, setSettings] = useState(loadSettings);
  const [progress, setProgress] = useState<number | null>(null);
  const [result, setResult] = useState<ExportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  const k = kind(settings.format);
  const scales = SCALES[k].filter((s) => k !== 'mp4' || Math.max(comp.width, comp.height) * s <= MAX_VIDEO_DIM);
  const scale = scales.includes(settings.scale) ? settings.scale : (scales.find((s) => s === 1) ?? scales[0]!);
  const w = Math.round(comp.width * scale);
  const h = Math.round(comp.height * scale);

  useEffect(() => saveSettings(settings), [settings]);
  useEffect(() => {
    if (open) {
      setResult(null);
      setError(null);
    }
  }, [open]);

  const update = (patch: Partial<typeof settings>) => setSettings((s) => ({ ...s, ...patch }));

  const start = async () => {
    const ac = new AbortController();
    abort.current = ac;
    setProgress(0);
    setResult(null);
    setError(null);
    try {
      const { doc } = useEditor.getState();
      const r = await runExport(doc, { ...settings, scale, time }, { forceWebGL, signal: ac.signal, onProgress: setProgress });
      downloadBlob(r.blob, r.filename);
      setResult(r);
    } catch (e) {
      setError((e as Error).name === 'AbortError' ? 'Export cancelled.' : `Export failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setProgress(null);
      abort.current = null;
    }
  };

  const busy = progress !== null;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o && busy) abort.current?.abort(); // closing cancels a running export
        onOpenChange(o);
      }}
    >
      <DialogContent variant="form">
        <DialogHeader>
          <DialogTitle>Export</DialogTitle>
          <DialogDescription>
            {k === 'still'
              ? `The frame at ${time.toFixed(2)}s, exactly as previewed.`
              : `The whole ${comp.duration}s, frame by frame, exactly as previewed.`}
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4">
          <PresetGrid label="Format" value={settings.format} options={FORMATS} onChange={(format) => update({ format })} columns={5} />
          <div className="space-y-1.5">
            <div className="flex items-baseline justify-between text-xs font-medium text-dim">
              <span>Size</span>
              <span className="tabular-nums text-zinc-400">
                {w} × {h} px
              </span>
            </div>
            <PresetGrid label="Scale" value={String(scale)} options={scales.map((s) => ({ value: String(s), label: `${s}×` }))} onChange={(v) => update({ scale: Number(v) })} columns={4} />
          </div>
          {(settings.format === 'png' || settings.format === 'webp') && (
            <Switch
              switchSize="sm"
              checked={settings.transparent}
              onCheckedChange={(transparent) => update({ transparent })}
              label="Transparent background"
              labelClassName="text-sm text-zinc-300"
            />
          )}
          {(settings.format === 'jpeg' || settings.format === 'webp') && (
            <SliderField label="Quality" hint={`${Math.round(settings.quality * 100)}%`} min={0.5} max={1} step={0.01} value={settings.quality} onValueChange={(quality) => update({ quality })} />
          )}
          {settings.format === 'gif' && (
            <>
              <SelectField
                label="Frame rate"
                value={String(settings.gifFps)}
                options={[10, 20, 25].map((f) => ({ value: String(f), label: `${f} fps` }))}
                onValueChange={(f) => update({ gifFps: Number(f) as ExportSettings['gifFps'] })}
              />
              <p className="text-xs text-dim">GIF has 256 colours and no partial transparency. Use MP4 for the best quality and smallest files.</p>
            </>
          )}
          {busy && <Progress value={Math.round((progress ?? 0) * 100)} max={100} label="Export progress" showValue size="sm" />}
          {result && (
            <p role="status" className="text-sm text-emerald-300">
              Saved {result.filename} · {result.width}×{result.height} · {fmtBytes(result.blob.size)} · {(result.ms / 1000).toFixed(1)}s
              {result.note && <span className="mt-1 block text-amber-300">{result.note}</span>}
            </p>
          )}
          {error && (
            <p role="alert" className="text-sm text-red-300">
              {error}
            </p>
          )}
        </DialogBody>
        <DialogFooter>
          {busy ? (
            <Button onClick={() => abort.current?.abort()}>
              <X size={14} /> Cancel
            </Button>
          ) : (
            <Button variant="primary" onClick={start}>
              <Download size={14} /> Export {FORMATS.find((f) => f.value === settings.format)!.label}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
