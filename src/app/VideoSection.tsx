// Video clip controls for an image layer that shows a video: timing, trim, loop, sound.
import { useState } from 'react';
import { Switch } from '@/components/wensity/switch';
import { clipLength, type ImageLayer, type VideoClip } from '@/doc';
import { videoMeta } from '@/video/videoAssets';
import { videoToAscii } from './asciiStudio';
import { useEditor } from './store';
import { Button, Field, inputClass, Section, SliderField } from './ui';

type Edit = (label: string, path: (string | number)[], value: unknown) => void;

const secs = (v: number) => `${v.toFixed(2)} s`;

export function VideoSection({ layer, edit }: { layer: ImageLayer & { video: VideoClip }; edit: Edit }) {
  const clip = layer.video;
  const meta = videoMeta(layer.assetId);
  const fps = useEditor((s) => s.doc.comp.fps);
  const compDuration = useEditor((s) => s.doc.comp.duration);
  const set = useEditor((s) => s.set);
  const duration = meta?.duration ?? clip.out;
  const frame = 1 / (meta?.fps || fps);
  const setClip = (label: string, patch: Partial<VideoClip>) => edit(label, ['video'], { ...clip, ...patch });
  const len = clipLength(clip);
  const [error, setError] = useState<string | null>(null);
  return (
    <Section title="Video">
      {meta && (
        <p className="text-xs text-dim">
          {meta.width}×{meta.height} · {meta.duration.toFixed(1)} s · {meta.codec.toUpperCase()} · {meta.hasAudio ? 'with sound' : 'no sound'}
        </p>
      )}
      <Field label="Starts at (s)">
        <input
          type="number"
          className={`${inputClass} py-1 tabular-nums`}
          step={frame}
          value={Number(clip.start.toFixed(2))}
          onChange={(e) => {
            const v = Number(e.target.value);
            if (Number.isFinite(v) && e.target.value !== '') setClip('Video start', { start: v });
          }}
        />
      </Field>
      <SliderField label="Trim start" hint={secs(clip.in)} min={0} max={Math.max(0, clip.out - frame)} step={frame} value={clip.in} onValueChange={(v) => setClip('Trim video', { in: v })} />
      <SliderField label="Trim end" hint={secs(clip.out)} min={Math.min(duration, clip.in + frame)} max={duration} step={frame} value={clip.out} onValueChange={(v) => setClip('Trim video', { out: v })} />
      <Switch switchSize="sm" label="Loop" checked={clip.loop} onCheckedChange={(on) => setClip(on ? 'Loop video' : 'Play video once', { loop: on })} />
      {meta?.hasAudio === false ? (
        <p className="text-xs text-dim">This video has no sound track.</p>
      ) : (
        <>
          <Switch switchSize="sm" label="Mute" checked={clip.muted} onCheckedChange={(on) => setClip(on ? 'Mute video' : 'Unmute video', { muted: on })} />
          {!clip.muted && (
            <SliderField label="Volume" hint={`${Math.round(clip.volume * 100)}%`} min={0} max={1} step={0.01} value={clip.volume} onValueChange={(v) => setClip('Video volume', { volume: v })} />
          )}
        </>
      )}
      {Math.abs(len - compDuration) > frame / 2 && (
        <Button className="w-full justify-center" onClick={() => set('Match video length', [{ path: ['comp', 'duration'], value: Math.max(frame, Math.round(len / frame) * frame) }])}>
          Make the canvas {len.toFixed(1)} s long
        </Button>
      )}
      <Button
        className="w-full justify-center"
        onClick={() => {
          try {
            videoToAscii();
            setError(null);
          } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
          }
        }}
      >
        Turn into ASCII
      </Button>
      {error && <p className="text-xs text-red-400">{error}</p>}
    </Section>
  );
}
