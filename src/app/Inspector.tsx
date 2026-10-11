import { Easings, type Easing, type Layer, type StaggerOrder } from '@/doc';
import { layerIndex, useEditor } from './store';
import { Field, inputClass, Section } from './ui';

const EASING_PRESETS: Record<string, Easing> = {
  'Ease out back': Easings.easeOutBack,
  'Ease out cubic': Easings.easeOutCubic,
  'Ease in-out cubic': Easings.easeInOutCubic,
  Spring: { kind: 'spring', mass: 1, stiffness: 170, damping: 12 },
  Linear: Easings.linear,
  Steps: { kind: 'steps', n: 4 },
};

const easingName = (e: Easing) => Object.entries(EASING_PRESETS).find(([, v]) => JSON.stringify(v) === JSON.stringify(e))?.[0] ?? 'Custom';

export function Inspector() {
  const doc = useEditor((s) => s.doc);
  const selectedId = useEditor((s) => s.selectedId);
  const layer = doc.comp.layers.find((l) => l.id === selectedId);

  return (
    <aside className="min-h-0 overflow-y-auto border-l border-line bg-panel" aria-label="Inspector">
      {layer ? <LayerInspector layer={layer} index={layerIndex(doc, layer.id)} /> : <p className="p-4 text-muted">Select a layer</p>}
    </aside>
  );
}

function LayerInspector({ layer, index }: { layer: Layer; index: number }) {
  const set = useEditor((s) => s.set);
  const base = ['comp', 'layers', index] as const;
  /** Slider edits coalesce into a single undo step per property. */
  const edit = (label: string, path: (string | number)[], value: unknown) => set(label, [{ path: [...base, ...path], value }], `${layer.id}:${path.join('.')}`);

  if (layer.type === 'text') {
    const anim = layer.animator;
    return (
      <>
        <Section title="Text">
          <Field label="Content">
            <textarea className={`${inputClass} min-h-16 resize-y`} value={layer.text} onChange={(e) => edit('Edit text', ['text'], e.target.value)} />
          </Field>
          <Field label="Size" hint={`${layer.fontSize}px`}>
            <input type="range" className="w-full" min={16} max={240} value={layer.fontSize} onChange={(e) => edit('Font size', ['fontSize'], Number(e.target.value))} />
          </Field>
          <Field label="Tracking" hint={`${layer.tracking.toFixed(2)}em`}>
            <input type="range" className="w-full" min={-0.1} max={0.4} step={0.01} value={layer.tracking} onChange={(e) => edit('Tracking', ['tracking'], Number(e.target.value))} />
          </Field>
          <Field label="Vertical position" hint={`${Math.round('static' in layer.transform.y ? layer.transform.y.static : 0)}px`}>
            <input
              type="range"
              className="w-full"
              min={0}
              max={1080}
              value={'static' in layer.transform.y ? layer.transform.y.static : 0}
              onChange={(e) => edit('Move text', ['transform', 'y'], { static: Number(e.target.value) })}
            />
          </Field>
        </Section>
        {anim && (
          <Section title="Glyph animation">
            <Field label="Easing">
              <select className={inputClass} value={easingName(anim.easing)} onChange={(e) => edit('Easing', ['animator', 'easing'], EASING_PRESETS[e.target.value])}>
                {Object.keys(EASING_PRESETS).map((k) => (
                  <option key={k}>{k}</option>
                ))}
              </select>
            </Field>
            <Field label="Order">
              <select className={inputClass} value={anim.order} onChange={(e) => edit('Stagger order', ['animator', 'order'], e.target.value as StaggerOrder)}>
                {(['forward', 'reverse', 'center', 'random'] as const).map((o) => (
                  <option key={o} value={o}>
                    {o[0]!.toUpperCase() + o.slice(1)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Stagger" hint={`${Math.round(anim.stagger * 1000)}ms`}>
              <input type="range" className="w-full" min={0} max={0.2} step={0.005} value={anim.stagger} onChange={(e) => edit('Stagger', ['animator', 'stagger'], Number(e.target.value))} />
            </Field>
            <Field label="Duration" hint={`${anim.duration.toFixed(2)}s`}>
              <input type="range" className="w-full" min={0.1} max={2} step={0.05} value={anim.duration} onChange={(e) => edit('Duration', ['animator', 'duration'], Number(e.target.value))} />
            </Field>
            <Field label="Rise from" hint={`${anim.from.offsetY}px`}>
              <input type="range" className="w-full" min={-200} max={200} value={anim.from.offsetY} onChange={(e) => edit('Rise', ['animator', 'from', 'offsetY'], Number(e.target.value))} />
            </Field>
            <Field label="Rotate from" hint={`${anim.from.rotation}°`}>
              <input type="range" className="w-full" min={-90} max={90} value={anim.from.rotation} onChange={(e) => edit('Rotate', ['animator', 'from', 'rotation'], Number(e.target.value))} />
            </Field>
            <Field label="Scale from" hint={`${anim.from.scale.toFixed(2)}×`}>
              <input type="range" className="w-full" min={0} max={3} step={0.05} value={anim.from.scale} onChange={(e) => edit('Scale', ['animator', 'from', 'scale'], Number(e.target.value))} />
            </Field>
            <Field label="Seed" hint={String(anim.seed)}>
              <input type="range" className="w-full" min={0} max={100} value={anim.seed} onChange={(e) => edit('Seed', ['animator', 'seed'], Number(e.target.value))} />
            </Field>
          </Section>
        )}
      </>
    );
  }

  if (layer.type === 'image') {
    return (
      <Section title="Screenshot">
        <Field label="Corner radius" hint={`${layer.radius}px`}>
          <input type="range" className="w-full" min={0} max={80} value={layer.radius} onChange={(e) => edit('Radius', ['radius'], Number(e.target.value))} />
        </Field>
        {layer.shadow && (
          <>
            <Field label="Shadow blur" hint={`${layer.shadow.blur}px`}>
              <input type="range" className="w-full" min={0} max={200} value={layer.shadow.blur} onChange={(e) => edit('Shadow blur', ['shadow', 'blur'], Number(e.target.value))} />
            </Field>
            <Field label="Shadow offset" hint={`${layer.shadow.offsetY}px`}>
              <input type="range" className="w-full" min={-100} max={150} value={layer.shadow.offsetY} onChange={(e) => edit('Shadow offset', ['shadow', 'offsetY'], Number(e.target.value))} />
            </Field>
          </>
        )}
      </Section>
    );
  }

  return (
    <Section title="Background">
      <Field label="Angle" hint={`${'static' in layer.angle ? layer.angle.static : 0}°`}>
        <input
          type="range"
          className="w-full"
          min={0}
          max={360}
          value={'static' in layer.angle ? layer.angle.static : 0}
          onChange={(e) => edit('Gradient angle', ['angle'], { static: Number(e.target.value) })}
        />
      </Field>
      {layer.stops.map((stop, i) => (
        <Field key={i} label={`Stop ${i + 1}`}>
          <input
            type="color"
            className="h-8 w-full cursor-pointer rounded bg-transparent"
            value={toHex(stop.color)}
            onChange={(e) => edit('Gradient color', ['stops', i, 'color'], fromHex(e.target.value, stop.color[3]))}
          />
        </Field>
      ))}
    </Section>
  );
}

const toHex = (c: readonly number[]) => `#${c.slice(0, 3).map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('')}`;
const fromHex = (hex: string, a: number) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).concat(a) as [number, number, number, number];
