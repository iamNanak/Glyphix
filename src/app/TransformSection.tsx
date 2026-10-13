// Numeric transform + crop: everything the canvas handles do, reachable by keyboard.
import { isPlaced, offsetProp, sampleProp, scaleProp, type CropRect, type ImageLayer, type TextLayer } from '@/doc';
import { useEditor } from './store';
import { Field, inputClass, Section, SliderField } from './ui';

type Edit = (label: string, path: (string | number)[], value: unknown) => void;

/** A number box that edits an (optionally animated) prop by shifting/scaling it as a whole. */
function NumberBox({ label, value, step = 1, onCommit }: { label: string; value: number; step?: number; onCommit: (v: number) => void }) {
  return (
    <Field label={label}>
      <input
        type="number"
        className={`${inputClass} py-1 tabular-nums`}
        step={step}
        value={Number(value.toFixed(step < 1 ? 2 : 0))}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (Number.isFinite(v) && e.target.value !== '') onCommit(v);
        }}
      />
    </Field>
  );
}

export function TransformSection({ layer, edit }: { layer: ImageLayer | TextLayer; edit: Edit }) {
  // The inspector ignores position-only changes (fast drags); this small section follows them live.
  const tr = useEditor((st) => {
    const l = st.doc.comp.layers.find((x) => x.id === layer.id);
    return isPlaced(l) ? l.transform : layer.transform;
  });
  // Values shown at the end of the timeline = the layer's resting pose (after any keyframes).
  const rest = Number.POSITIVE_INFINITY;
  const x = sampleProp(tr.x, rest);
  const y = sampleProp(tr.y, rest);
  const s = sampleProp(tr.scale, rest);
  const r = sampleProp(tr.rotation, rest);
  return (
    <Section title="Transform">
      <div className="grid grid-cols-2 gap-2">
        <NumberBox label="X" value={x} onCommit={(v) => edit('Move X', ['transform', 'x'], offsetProp(tr.x, v - x))} />
        <NumberBox label="Y" value={y} onCommit={(v) => edit('Move Y', ['transform', 'y'], offsetProp(tr.y, v - y))} />
        <NumberBox label="Scale %" value={s * 100} onCommit={(v) => v > 0 && edit('Scale', ['transform', 'scale'], scaleProp(tr.scale, v / 100 / s))} />
        <NumberBox label="Rotation °" value={r} onCommit={(v) => edit('Rotate', ['transform', 'rotation'], offsetProp(tr.rotation, v - r))} />
      </div>
    </Section>
  );
}

/** Crop insets in % of the source; the visible pixels never rescale (width/height follow the crop). */
export function CropSection({ layer, index }: { layer: ImageLayer; index: number }) {
  const set = useEditor((st) => st.set);
  const { crop, width, height } = layer;
  const pxPerU = width / crop.w;
  const pxPerV = height / crop.h;
  const apply = (label: string, next: CropRect) => {
    const base = ['comp', 'layers', index];
    set(
      label,
      [
        { path: [...base, 'crop'], value: next },
        { path: [...base, 'width'], value: next.w * pxPerU },
        { path: [...base, 'height'], value: next.h * pxPerV },
      ],
      `${layer.id}:crop`,
    );
  };
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  const MIN = 0.05; // keep at least 5% of the image
  const left = crop.x;
  const top = crop.y;
  const right = 1 - crop.x - crop.w;
  const bottom = 1 - crop.y - crop.h;
  return (
    <Section title="Crop">
      <SliderField label="Left" hint={pct(left)} min={0} max={1 - right - MIN} step={0.005} value={left} onValueChange={(v) => apply('Crop', { ...crop, x: v, w: 1 - v - right })} />
      <SliderField label="Right" hint={pct(right)} min={0} max={1 - left - MIN} step={0.005} value={right} onValueChange={(v) => apply('Crop', { ...crop, w: 1 - left - v })} />
      <SliderField label="Top" hint={pct(top)} min={0} max={1 - bottom - MIN} step={0.005} value={top} onValueChange={(v) => apply('Crop', { ...crop, y: v, h: 1 - v - bottom })} />
      <SliderField label="Bottom" hint={pct(bottom)} min={0} max={1 - top - MIN} step={0.005} value={bottom} onValueChange={(v) => apply('Crop', { ...crop, h: 1 - top - v })} />
    </Section>
  );
}
