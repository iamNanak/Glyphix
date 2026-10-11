import { useMemo } from 'react';
import {
  Easings,
  NO_TILT,
  type BackgroundFill,
  type BackgroundLayer,
  type Color,
  type Easing,
  type FrameKind,
  type ImageLayer,
  type Layer,
  type StaggerOrder,
  type TextLayer,
} from '@/doc';
import { assetStore } from '@/assets/assetStore';
import {
  BACKGROUND_PRESETS,
  CANVAS_PRESETS,
  currentPadding,
  fillToCss,
  fitWithPaddingPatches,
  resizeCompPatches,
  SHADOW_PRESETS,
  TILT_PRESETS,
} from '@/styling/presets';
import { extractPalette, samplePixels, suggestBackgrounds } from '@/styling/palette';
import { layerIndex, useEditor } from './store';
import { Field, inputClass, Section, Segmented } from './ui';

const EASING_PRESETS: Record<string, Easing> = {
  'Ease out back': Easings.easeOutBack,
  'Ease out cubic': Easings.easeOutCubic,
  'Ease in-out cubic': Easings.easeInOutCubic,
  Spring: { kind: 'spring', mass: 1, stiffness: 170, damping: 12 },
  Linear: Easings.linear,
  Steps: { kind: 'steps', n: 4 },
};

const easingName = (e: Easing) => Object.entries(EASING_PRESETS).find(([, v]) => JSON.stringify(v) === JSON.stringify(e))?.[0] ?? 'Custom';

type Edit = (label: string, path: (string | number)[], value: unknown) => void;

export function Inspector() {
  const doc = useEditor((s) => s.doc);
  const selectedId = useEditor((s) => s.selectedId);
  const layer = doc.comp.layers.find((l) => l.id === selectedId);
  const bg = doc.comp.layers.find((l): l is BackgroundLayer => l.type === 'background');

  return (
    <aside className="min-h-0 overflow-y-auto border-l border-line bg-panel" aria-label="Inspector">
      {layer && layer.type !== 'background' ? (
        <LayerInspector layer={layer} index={layerIndex(doc, layer.id)} />
      ) : (
        <>
          <CanvasSection />
          {bg && <BackgroundSection layer={bg} index={layerIndex(doc, bg.id)} />}
        </>
      )}
    </aside>
  );
}

function useEdit(layer: Layer, index: number): Edit {
  const set = useEditor((s) => s.set);
  const base = ['comp', 'layers', index] as const;
  // Slider edits coalesce into a single undo step per property.
  return (label, path, value) => set(label, [{ path: [...base, ...path], value }], `${layer.id}:${path.join('.')}`);
}

function LayerInspector({ layer, index }: { layer: Exclude<Layer, BackgroundLayer>; index: number }) {
  const edit = useEdit(layer, index);
  return layer.type === 'text' ? <TextInspector layer={layer} edit={edit} /> : <ImageInspector layer={layer} index={index} edit={edit} />;
}

// ---------------------------------------------------------------------------

function CanvasSection() {
  const doc = useEditor((s) => s.doc);
  const set = useEditor((s) => s.set);
  const { width, height } = doc.comp;
  const current = CANVAS_PRESETS.find((p) => p.width === width && p.height === height)?.id ?? 'custom';
  return (
    <Section title="Canvas">
      <div className="grid grid-cols-3 gap-1.5">
        {CANVAS_PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            aria-pressed={current === p.id}
            onClick={() => set(`Canvas ${p.label}`, resizeCompPatches(doc, p.width, p.height))}
            className={`rounded-md px-2 py-1.5 text-xs ring-1 transition ${current === p.id ? 'bg-accent/25 text-white ring-accent' : 'bg-panel-2 text-zinc-300 ring-line hover:bg-white/8'}`}
          >
            {p.label}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Width">
          <input
            type="number"
            className={inputClass}
            min={64}
            max={8192}
            value={width}
            onChange={(e) => {
              const v = Math.round(Number(e.target.value));
              if (v >= 64 && v <= 8192) set('Canvas width', resizeCompPatches(doc, v, height), 'canvas-size');
            }}
          />
        </Field>
        <Field label="Height">
          <input
            type="number"
            className={inputClass}
            min={64}
            max={8192}
            value={height}
            onChange={(e) => {
              const v = Math.round(Number(e.target.value));
              if (v >= 64 && v <= 8192) set('Canvas height', resizeCompPatches(doc, width, v), 'canvas-size');
            }}
          />
        </Field>
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------------------

function BackgroundSection({ layer, index }: { layer: BackgroundLayer; index: number }) {
  const edit = useEdit(layer, index);
  const doc = useEditor((s) => s.doc);
  const fill = layer.fill;
  const setFill = (label: string, f: BackgroundFill) => edit(label, ['fill'], f);
  // Images in the doc: palette source + image-background candidates.
  const images = useMemo(
    () => [...new Set(doc.comp.layers.flatMap((l) => (l.type === 'image' ? [l.assetId] : [])))].filter((id) => assetStore.has(id)),
    [doc.comp.layers],
  );
  const suggestions = useMemo(() => {
    const a = images[0] ? assetStore.get(images[0]) : undefined;
    if (!a) return [];
    const level = a.levels[a.levels.length - 1]!;
    return suggestBackgrounds(extractPalette(samplePixels(level.source as CanvasImageSource), 6, 1));
  }, [images]);

  const switchKind = (kind: BackgroundFill['kind']) => {
    if (kind === fill.kind) return;
    const first = firstColor(fill);
    if (kind === 'solid') setFill('Solid background', { kind: 'solid', color: first });
    else if (kind === 'linear') setFill('Gradient background', BACKGROUND_PRESETS[0]!.fill);
    else if (kind === 'mesh') setFill('Mesh background', BACKGROUND_PRESETS.find((p) => p.fill.kind === 'mesh')!.fill);
    else if (images[0]) setFill('Image background', { kind: 'image', assetId: images[0], blur: 40, dim: 0.15 });
  };

  return (
    <Section title="Background">
      <Segmented
        label="Background type"
        value={fill.kind}
        onChange={switchKind}
        options={[
          { value: 'solid', label: 'Solid' },
          { value: 'linear', label: 'Gradient' },
          { value: 'mesh', label: 'Mesh' },
          { value: 'image', label: 'Image', disabled: !images.length },
        ]}
      />

      {suggestions.length > 0 && (
        <Field label="From your screenshot">
          <Swatches fills={suggestions} onPick={(f) => setFill('Background from screenshot', f)} />
        </Field>
      )}
      <Field label="Presets">
        <Swatches fills={BACKGROUND_PRESETS.map((p) => p.fill)} onPick={(f) => setFill('Background preset', f)} />
      </Field>

      {fill.kind === 'solid' && (
        <Field label="Colour">
          <ColorInput value={fill.color} onChange={(c) => edit('Background colour', ['fill', 'color'], c)} />
        </Field>
      )}
      {fill.kind === 'linear' && (
        <>
          <Field label="Angle" hint={`${Math.round(fill.angle)}°`}>
            <input type="range" className="w-full" min={0} max={360} value={fill.angle} onChange={(e) => edit('Gradient angle', ['fill', 'angle'], Number(e.target.value))} />
          </Field>
          <div className="flex gap-2">
            {fill.stops.map((stop, i) => (
              <ColorInput key={i} label={`Stop ${i + 1}`} value={stop.color} onChange={(c) => edit('Gradient colour', ['fill', 'stops', i, 'color'], c)} />
            ))}
          </div>
        </>
      )}
      {fill.kind === 'mesh' && (
        <div className="flex gap-2">
          {fill.points.map((p, i) => (
            <ColorInput key={i} label={`Point ${i + 1}`} value={p.color} onChange={(c) => edit('Mesh colour', ['fill', 'points', i, 'color'], c)} />
          ))}
        </div>
      )}
      {fill.kind === 'image' && (
        <>
          <Field label="Blur" hint={`${fill.blur}px`}>
            <input type="range" className="w-full" min={0} max={160} value={fill.blur} onChange={(e) => edit('Background blur', ['fill', 'blur'], Number(e.target.value))} />
          </Field>
          <Field label="Dim" hint={`${Math.round(fill.dim * 100)}%`}>
            <input type="range" className="w-full" min={0} max={0.9} step={0.01} value={fill.dim} onChange={(e) => edit('Background dim', ['fill', 'dim'], Number(e.target.value))} />
          </Field>
        </>
      )}
    </Section>
  );
}

const firstColor = (f: BackgroundFill): Color =>
  f.kind === 'solid' ? f.color : f.kind === 'linear' ? (f.stops[0]?.color ?? [0, 0, 0, 1]) : f.kind === 'mesh' ? (f.points[0]?.color ?? [0, 0, 0, 1]) : [0.1, 0.1, 0.12, 1];

function Swatches({ fills, onPick }: { fills: BackgroundFill[]; onPick: (f: BackgroundFill) => void }) {
  return (
    <div className="grid grid-cols-4 gap-1.5">
      {fills.map((f, i) => (
        <button
          key={i}
          type="button"
          aria-label={`Apply ${f.kind} background ${i + 1}`}
          onClick={() => onPick(f)}
          className="aspect-video rounded-md ring-1 ring-line transition hover:ring-2 hover:ring-accent"
          style={{ background: fillToCss(f), backgroundColor: f.kind === 'mesh' ? '#888' : undefined }}
        />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------

const FRAMES: { value: FrameKind; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'macos-light', label: 'Window' },
  { value: 'macos-dark', label: 'Window dark' },
  { value: 'browser-light', label: 'Browser' },
  { value: 'browser-dark', label: 'Browser dark' },
];

function ImageInspector({ layer, index, edit }: { layer: ImageLayer; index: number; edit: Edit }) {
  const doc = useEditor((s) => s.doc);
  const set = useEditor((s) => s.set);
  const shadowId = SHADOW_PRESETS.find((p) => JSON.stringify(p.shadow) === JSON.stringify(layer.shadow))?.id ?? 'custom';
  const tiltId = TILT_PRESETS.find((p) => JSON.stringify(p.tilt) === JSON.stringify(layer.tilt))?.id ?? 'custom';
  const rx = 'static' in layer.tilt.rotateX ? layer.tilt.rotateX.static : 0;
  const ry = 'static' in layer.tilt.rotateY ? layer.tilt.rotateY.static : 0;
  const padding = currentPadding(doc, layer);
  const maxPad = Math.round(Math.min(doc.comp.width, doc.comp.height) / 2 - 40);

  return (
    <>
      <Section title="Frame">
        <div className="grid grid-cols-3 gap-1.5">
          {FRAMES.map((f) => (
            <button
              key={f.value}
              type="button"
              aria-pressed={layer.frame.kind === f.value}
              onClick={() => edit('Frame', ['frame', 'kind'], f.value)}
              className={`rounded-md px-1.5 py-1.5 text-xs ring-1 transition ${layer.frame.kind === f.value ? 'bg-accent/25 text-white ring-accent' : 'bg-panel-2 text-zinc-300 ring-line hover:bg-white/8'}`}
            >
              {f.label}
            </button>
          ))}
        </div>
        {layer.frame.kind.startsWith('browser') && (
          <Field label="Address">
            <input className={inputClass} value={layer.frame.url} placeholder="glyphix.app" onChange={(e) => edit('Frame URL', ['frame', 'url'], e.target.value)} />
          </Field>
        )}
      </Section>

      <Section title="Layout">
        <Field label="Padding" hint={`${padding}px`}>
          <input
            type="range"
            className="w-full"
            min={0}
            max={maxPad}
            value={Math.min(padding, maxPad)}
            onChange={(e) => set('Padding', fitWithPaddingPatches(doc, index, Number(e.target.value)), `${layer.id}:padding`)}
          />
        </Field>
        <Field label="Corner radius" hint={`${layer.radius}px`}>
          <input type="range" className="w-full" min={0} max={80} value={layer.radius} onChange={(e) => edit('Radius', ['radius'], Number(e.target.value))} />
        </Field>
        <Field label="Border" hint={layer.border ? `${layer.border.width}px` : 'off'}>
          <div className="flex items-center gap-2">
            <input
              type="range"
              className="w-full"
              min={0}
              max={24}
              value={layer.border?.width ?? 0}
              onChange={(e) => {
                const w = Number(e.target.value);
                edit('Border', ['border'], w === 0 ? null : { width: w, color: layer.border?.color ?? [1, 1, 1, 0.35] });
              }}
            />
            {layer.border && <ColorInput value={layer.border.color} onChange={(c) => edit('Border colour', ['border', 'color'], c)} />}
          </div>
        </Field>
      </Section>

      <Section title="Shadow">
        <Segmented
          label="Shadow preset"
          value={shadowId}
          onChange={(id) => edit('Shadow', ['shadow'], SHADOW_PRESETS.find((p) => p.id === id)!.shadow)}
          options={SHADOW_PRESETS.map((p) => ({ value: p.id, label: p.label }))}
        />
        {layer.shadow && (
          <>
            <Field label="Blur" hint={`${layer.shadow.blur}px`}>
              <input type="range" className="w-full" min={0} max={200} value={layer.shadow.blur} onChange={(e) => edit('Shadow blur', ['shadow', 'blur'], Number(e.target.value))} />
            </Field>
            <Field label="Offset" hint={`${layer.shadow.offsetY}px`}>
              <input type="range" className="w-full" min={-100} max={150} value={layer.shadow.offsetY} onChange={(e) => edit('Shadow offset', ['shadow', 'offsetY'], Number(e.target.value))} />
            </Field>
            <Field label="Opacity" hint={`${Math.round(layer.shadow.color[3] * 100)}%`}>
              <input type="range" className="w-full" min={0} max={1} step={0.01} value={layer.shadow.color[3]} onChange={(e) => edit('Shadow opacity', ['shadow', 'color', 3], Number(e.target.value))} />
            </Field>
          </>
        )}
      </Section>

      <Section title="3D tilt">
        <div className="grid grid-cols-3 gap-1.5">
          {TILT_PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              aria-pressed={tiltId === p.id}
              onClick={() => edit('Tilt', ['tilt'], p.tilt)}
              className={`rounded-md px-1.5 py-1.5 text-xs ring-1 transition ${tiltId === p.id ? 'bg-accent/25 text-white ring-accent' : 'bg-panel-2 text-zinc-300 ring-line hover:bg-white/8'}`}
            >
              {p.label}
            </button>
          ))}
        </div>
        <Field label="Tilt X" hint={`${rx}°`}>
          <input type="range" className="w-full" min={-45} max={45} value={rx} onChange={(e) => edit('Tilt X', ['tilt', 'rotateX'], { static: Number(e.target.value) })} />
        </Field>
        <Field label="Tilt Y" hint={`${ry}°`}>
          <input type="range" className="w-full" min={-45} max={45} value={ry} onChange={(e) => edit('Tilt Y', ['tilt', 'rotateY'], { static: Number(e.target.value) })} />
        </Field>
        <Field label="Perspective" hint={`${layer.tilt.perspective}px`}>
          <input
            type="range"
            className="w-full"
            min={800}
            max={6000}
            step={100}
            value={layer.tilt.perspective ?? NO_TILT.perspective}
            onChange={(e) => edit('Perspective', ['tilt', 'perspective'], Number(e.target.value))}
          />
        </Field>
      </Section>
    </>
  );
}

// ---------------------------------------------------------------------------

function TextInspector({ layer, edit }: { layer: TextLayer; edit: Edit }) {
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
        <Field label="Align">
          <Segmented
            label="Text alignment"
            value={layer.align}
            onChange={(v) => edit('Align', ['align'], v)}
            options={[
              { value: 'left', label: 'Left' },
              { value: 'center', label: 'Centre' },
              { value: 'right', label: 'Right' },
            ]}
          />
        </Field>
        <Field label="Colour">
          <ColorInput value={layer.color} onChange={(c) => edit('Text colour', ['color'], c)} />
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

// ---------------------------------------------------------------------------

function ColorInput({ value, onChange, label }: { value: Color; onChange: (c: Color) => void; label?: string }) {
  return (
    <input
      type="color"
      aria-label={label ?? 'Colour'}
      title={label}
      className="h-8 w-full min-w-8 cursor-pointer rounded bg-transparent"
      value={toHex(value)}
      onChange={(e) => onChange(fromHex(e.target.value, value[3]))}
    />
  );
}

const toHex = (c: readonly number[]) => `#${c.slice(0, 3).map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0')).join('')}`;
const fromHex = (hex: string, a: number) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).concat(a) as Color;
