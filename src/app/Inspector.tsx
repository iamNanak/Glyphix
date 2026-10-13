import { useMemo, useRef, useState } from 'react';
import { AnimationSection, ORDER_OPTIONS } from './AnimationSection';
import { EffectsSection } from './EffectsSection';
import { FontPicker } from './FontPicker';
import { Switch } from '@/components/wensity/switch';
import { fontLibrary } from '@/text/fontLibrary';
import { effectiveWeight, namedWeights, WEIGHT_NAMES } from '@/text/fonts';
import { CropSection, TransformSection } from './TransformSection';
import {
  Easings,
  isGlyphPreset,
  isPlaced,
  NO_TILT,
  type AdjustmentLayer,
  type BackgroundFill,
  type BackgroundLayer,
  type Color,
  type Doc,
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
import { ColorField, Field, inputClass, PresetGrid, Section, Segmented, SelectField, SliderField } from './ui';

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

/** Equal if the only differences are layer x/y positions (what a drag changes). */
function sameIgnoringPositions(a: Doc, b: Doc): boolean {
  if (a === b) return true;
  if (a.comp.width !== b.comp.width || a.comp.height !== b.comp.height || a.comp.layers.length !== b.comp.layers.length) return false;
  return a.comp.layers.every((la, i) => {
    const lb = b.comp.layers[i]!;
    if (la === lb) return true;
    if (!isPlaced(la) || !isPlaced(lb) || la.id !== lb.id) return false;
    const keys = new Set([...Object.keys(la), ...Object.keys(lb)]);
    for (const k of keys) {
      const va = (la as unknown as Record<string, unknown>)[k];
      const vb = (lb as unknown as Record<string, unknown>)[k];
      if (k === 'transform') {
        if (la.transform.scale !== lb.transform.scale || la.transform.rotation !== lb.transform.rotation) return false;
      } else if (va !== vb) return false;
    }
    return true;
  });
}

/** The document, but stable across drags so panels don't re-render on every pointer move. */
function useDocForPanels(): Doc {
  const last = useRef<Doc | null>(null);
  return useEditor((s) => {
    if (last.current && sameIgnoringPositions(last.current, s.doc)) return last.current;
    return (last.current = s.doc);
  });
}

export function Inspector() {
  const doc = useDocForPanels();
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
          {bg && <BackgroundEffects layer={bg} index={layerIndex(doc, bg.id)} />}
        </>
      )}
    </aside>
  );
}

function BackgroundEffects({ layer, index }: { layer: BackgroundLayer; index: number }) {
  return <EffectsSection layer={layer} edit={useEdit(layer, index)} title="Background effects" />;
}

function useEdit(layer: Layer, index: number): Edit {
  const set = useEditor((s) => s.set);
  const base = ['comp', 'layers', index] as const;
  // Slider edits coalesce into a single undo step per property.
  return (label, path, value) => set(label, [{ path: [...base, ...path], value }], `${layer.id}:${path.join('.')}`);
}

function LayerInspector({ layer, index }: { layer: Exclude<Layer, BackgroundLayer>; index: number }) {
  const edit = useEdit(layer, index);
  if (layer.type === 'adjustment') return <AdjustmentInspector layer={layer} edit={edit} />;
  return layer.type === 'text' ? <TextInspector layer={layer} edit={edit} /> : <ImageInspector layer={layer} index={index} edit={edit} />;
}

function AdjustmentInspector({ layer, edit }: { layer: AdjustmentLayer; edit: Edit }) {
  const opacity = 'static' in layer.opacity ? layer.opacity.static : null;
  return (
    <>
      <Section title="Adjustment layer">
        <p className="text-xs leading-relaxed text-dim">Effects here apply to every layer below this one.</p>
        {opacity !== null && (
          <SliderField label="Amount" hint={`${Math.round(opacity * 100)}%`} min={0} max={1} step={0.01} value={opacity} onValueChange={(v) => edit('Adjustment amount', ['opacity'], { static: v })} />
        )}
      </Section>
      <EffectsSection layer={layer} edit={edit} />
    </>
  );
}

// ---------------------------------------------------------------------------

function CanvasSection() {
  const doc = useDocForPanels();
  const set = useEditor((s) => s.set);
  const { width, height } = doc.comp;
  const current = CANVAS_PRESETS.find((p) => p.width === width && p.height === height)?.id ?? 'custom';
  return (
    <Section title="Canvas">
      <PresetGrid
        label="Canvas size"
        value={current}
        options={CANVAS_PRESETS.map((p) => ({ value: p.id, label: p.label }))}
        onChange={(id) => {
          const p = CANVAS_PRESETS.find((c) => c.id === id)!;
          set(`Canvas ${p.label}`, resizeCompPatches(doc, p.width, p.height));
        }}
      />
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
  const doc = useDocForPanels();
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
          <ColorField value={fill.color} onChange={(c) => edit('Background colour', ['fill', 'color'], c)} />
        </Field>
      )}
      {fill.kind === 'linear' && (
        <>
          <SliderField label="Angle" hint={`${Math.round(fill.angle)}°`} min={0} max={360} value={fill.angle} onValueChange={(v) => edit('Gradient angle', ['fill', 'angle'], v)} />
          <div className="flex gap-2">
            {fill.stops.map((stop, i) => (
              <ColorField key={i} label={`Stop ${i + 1}`} value={stop.color} onChange={(c) => edit('Gradient colour', ['fill', 'stops', i, 'color'], c)} />
            ))}
          </div>
        </>
      )}
      {fill.kind === 'mesh' && (
        <div className="flex gap-2">
          {fill.points.map((p, i) => (
            <ColorField key={i} label={`Point ${i + 1}`} value={p.color} onChange={(c) => edit('Mesh colour', ['fill', 'points', i, 'color'], c)} />
          ))}
        </div>
      )}
      {fill.kind === 'image' && (
        <>
          <SliderField label="Blur" hint={`${fill.blur}px`} min={0} max={160} value={fill.blur} onValueChange={(v) => edit('Background blur', ['fill', 'blur'], v)} />
          <SliderField label="Dim" hint={`${Math.round(fill.dim * 100)}%`} min={0} max={0.9} step={0.01} value={fill.dim} onValueChange={(v) => edit('Background dim', ['fill', 'dim'], v)} />
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
  const doc = useDocForPanels();
  const set = useEditor((s) => s.set);
  const shadowId = SHADOW_PRESETS.find((p) => JSON.stringify(p.shadow) === JSON.stringify(layer.shadow))?.id ?? 'custom';
  const tiltId = TILT_PRESETS.find((p) => JSON.stringify(p.tilt) === JSON.stringify(layer.tilt))?.id ?? 'custom';
  const rx = 'static' in layer.tilt.rotateX ? layer.tilt.rotateX.static : 0;
  const ry = 'static' in layer.tilt.rotateY ? layer.tilt.rotateY.static : 0;
  const padding = currentPadding(doc, layer);
  const maxPad = Math.round(Math.min(doc.comp.width, doc.comp.height) / 2 - 40);

  return (
    <>
      <TransformSection layer={layer} edit={edit} />
      <Section title="Frame">
        <PresetGrid label="Frame" value={layer.frame.kind} options={FRAMES} onChange={(kind) => edit('Frame', ['frame', 'kind'], kind)} />
        {layer.frame.kind.startsWith('browser') && (
          <Field label="Address">
            <input className={inputClass} value={layer.frame.url} placeholder="glyphix.app" onChange={(e) => edit('Frame URL', ['frame', 'url'], e.target.value)} />
          </Field>
        )}
      </Section>

      <Section title="Layout">
        <SliderField label="Padding" hint={`${padding}px`} min={0}
            max={maxPad}
            value={Math.min(padding, maxPad)}
            onValueChange={(v) => set('Padding', fitWithPaddingPatches(doc, index, v), `${layer.id}:padding`)} />
        <SliderField label="Corner radius" hint={`${layer.radius}px`} min={0} max={80} value={layer.radius} onValueChange={(v) => edit('Radius', ['radius'], v)} />
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <SliderField
              label="Border"
              hint={layer.border ? `${layer.border.width}px` : 'off'}
              min={0}
              max={24}
              value={layer.border?.width ?? 0}
              onValueChange={(w) => edit('Border', ['border'], w === 0 ? null : { width: w, color: layer.border?.color ?? [1, 1, 1, 0.35] })}
            />
          </div>
          {layer.border && (
            <div className="w-10">
              <ColorField label="Border colour" alpha value={layer.border.color} onChange={(c) => edit('Border colour', ['border', 'color'], c)} />
            </div>
          )}
        </div>
      </Section>

      <CropSection layer={layer} index={index} />
      <Section title="Shadow">
        <PresetGrid
          label="Shadow preset"
          value={shadowId}
          onChange={(id) => edit('Shadow', ['shadow'], SHADOW_PRESETS.find((p) => p.id === id)!.shadow)}
          options={SHADOW_PRESETS.map((p) => ({ value: p.id, label: p.label }))}
        />
        {layer.shadow && (
          <>
            <SliderField label="Blur" hint={`${layer.shadow.blur}px`} min={0} max={200} value={layer.shadow.blur} onValueChange={(v) => edit('Shadow blur', ['shadow', 'blur'], v)} />
            <SliderField label="Offset" hint={`${layer.shadow.offsetY}px`} min={-100} max={150} value={layer.shadow.offsetY} onValueChange={(v) => edit('Shadow offset', ['shadow', 'offsetY'], v)} />
            <SliderField label="Opacity" hint={`${Math.round(layer.shadow.color[3] * 100)}%`} min={0} max={1} step={0.01} value={layer.shadow.color[3]} onValueChange={(v) => edit('Shadow opacity', ['shadow', 'color', 3], v)} />
          </>
        )}
      </Section>

      <Section title="3D tilt">
        <PresetGrid
          label="Tilt preset"
          value={tiltId}
          options={TILT_PRESETS.map((p) => ({ value: p.id, label: p.label }))}
          onChange={(id) => edit('Tilt', ['tilt'], TILT_PRESETS.find((p) => p.id === id)!.tilt)}
        />
        <SliderField label="Tilt X" hint={`${rx}°`} min={-45} max={45} value={rx} onValueChange={(v) => edit('Tilt X', ['tilt', 'rotateX'], { static: v })} />
        <SliderField label="Tilt Y" hint={`${ry}°`} min={-45} max={45} value={ry} onValueChange={(v) => edit('Tilt Y', ['tilt', 'rotateY'], { static: v })} />
        <SliderField label="Perspective" hint={`${layer.tilt.perspective}px`} min={800}
            max={6000}
            step={100}
            value={layer.tilt.perspective ?? NO_TILT.perspective}
            onValueChange={(v) => edit('Perspective', ['tilt', 'perspective'], v)} />
      </Section>
      <AnimationSection layer={layer} edit={edit} />
      <EffectsSection layer={layer} edit={edit} />
    </>
  );
}

// ---------------------------------------------------------------------------

function TextInspector({ layer, edit }: { layer: TextLayer; edit: Edit }) {
  // The hand-tuned animator applies only when no per-glyph enter preset is chosen.
  const anim = layer.motion.enter && isGlyphPreset(layer.motion.enter.preset) ? null : layer.animator;
  const [fontError, setFontError] = useState<string | null>(null);
  const info = fontLibrary.info(layer.fontId);
  const weights = namedWeights(info);
  const weight = effectiveWeight(info, layer.weight);
  const glow = 'static' in layer.glow ? layer.glow.static : null;
  return (
    <>
      <Section title="Text">
        <Field label="Content">
          <textarea className={`${inputClass} min-h-16 resize-y`} value={layer.text} onChange={(e) => edit('Edit text', ['text'], e.target.value)} />
        </Field>
        <div className="space-y-1.5">
          <span className="text-xs font-medium text-dim">Font</span>
          <FontPicker
            value={layer.fontId}
            onChange={(id) => {
              setFontError(null);
              edit('Font', ['fontId'], id);
            }}
            onError={setFontError}
          />
          {fontError && (
            <p role="alert" className="text-xs text-red-300">
              {fontError}
            </p>
          )}
        </div>
        <SelectField
          label="Weight"
          value={String(weights.includes(weight) ? weight : weights[0])}
          options={weights.map((w) => ({ value: String(w), label: `${WEIGHT_NAMES[w] ?? w} · ${w}` }))}
          onValueChange={(v) => edit('Font weight', ['weight'], Number(v))}
        />
        <SliderField label="Size" hint={`${layer.fontSize}px`} min={12} max={400} value={layer.fontSize} onValueChange={(v) => edit('Font size', ['fontSize'], v)} />
        <SliderField label="Line height" hint={`${layer.lineHeight.toFixed(2)}×`} min={0.7} max={2.2} step={0.01} value={layer.lineHeight} onValueChange={(v) => edit('Line height', ['lineHeight'], v)} />
        <SliderField label="Tracking" hint={`${layer.tracking.toFixed(2)}em`} min={-0.1} max={0.4} step={0.01} value={layer.tracking} onValueChange={(v) => edit('Tracking', ['tracking'], v)} />
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
      </Section>

      <AnimationSection layer={layer} edit={edit} />
      <EffectsSection layer={layer} edit={edit} />

      <Section title="Fill">
        <Segmented
          label="Fill type"
          value={layer.gradient ? 'gradient' : 'solid'}
          onChange={(v) =>
            edit('Fill', ['gradient'], v === 'gradient' ? { angle: 0, from: layer.color, to: [0.55, 0.85, 1, 1] } : null)
          }
          options={[
            { value: 'solid', label: 'Solid' },
            { value: 'gradient', label: 'Gradient' },
          ]}
        />
        {layer.gradient ? (
          <>
            <div className="grid grid-cols-2 gap-2">
              <Field label="From">
                <ColorField label="Gradient start colour" value={layer.gradient.from} onChange={(c) => edit('Gradient colour', ['gradient', 'from'], c)} />
              </Field>
              <Field label="To">
                <ColorField label="Gradient end colour" value={layer.gradient.to} onChange={(c) => edit('Gradient colour', ['gradient', 'to'], c)} />
              </Field>
            </div>
            <SliderField label="Angle" hint={`${layer.gradient.angle}°`} min={0} max={360} value={layer.gradient.angle} onValueChange={(v) => edit('Gradient angle', ['gradient', 'angle'], v)} />
          </>
        ) : (
          <Field label="Colour">
            <ColorField label="Text colour" value={layer.color} onChange={(c) => edit('Text colour', ['color'], c)} />
          </Field>
        )}
      </Section>

      <Section title="Outline">
        <Switch
          switchSize="sm"
          checked={!!layer.outline}
          onCheckedChange={(on) => edit('Outline', ['outline'], on ? { width: Math.max(1, Math.round(layer.fontSize * 0.04)), color: [0, 0, 0, 1] } : null)}
          label="Outline"
          labelClassName="text-xs text-dim"
        />
        {layer.outline && (
          <>
            <SliderField label="Width" hint={`${layer.outline.width}px`} min={1} max={Math.max(4, Math.round(layer.fontSize * 0.2))} value={layer.outline.width} onValueChange={(v) => edit('Outline width', ['outline', 'width'], v)} />
            <Field label="Colour">
              <ColorField label="Outline colour" value={layer.outline.color} onChange={(c) => edit('Outline colour', ['outline', 'color'], c)} />
            </Field>
          </>
        )}
      </Section>

      <Section title="Shadow">
        <Switch
          switchSize="sm"
          checked={!!layer.shadow}
          onCheckedChange={(on) =>
            edit('Text shadow', ['shadow'], on ? { offsetX: 0, offsetY: Math.round(layer.fontSize * 0.05), blur: Math.round(layer.fontSize * 0.08), color: [0, 0, 0, 0.5] } : null)
          }
          label="Text shadow"
          labelClassName="text-xs text-dim"
        />
        {layer.shadow && (
          <>
            <div className="grid grid-cols-2 gap-2">
              <SliderField label="X" hint={`${layer.shadow.offsetX}px`} min={-60} max={60} value={layer.shadow.offsetX} onValueChange={(v) => edit('Shadow X', ['shadow', 'offsetX'], v)} />
              <SliderField label="Y" hint={`${layer.shadow.offsetY}px`} min={-60} max={60} value={layer.shadow.offsetY} onValueChange={(v) => edit('Shadow Y', ['shadow', 'offsetY'], v)} />
            </div>
            <SliderField label="Softness" hint={`${layer.shadow.blur}px`} min={0} max={Math.max(4, Math.round(layer.fontSize * 0.2))} value={layer.shadow.blur} onValueChange={(v) => edit('Shadow softness', ['shadow', 'blur'], v)} />
            <Field label="Colour">
              <ColorField label="Shadow colour" alpha value={layer.shadow.color} onChange={(c) => edit('Shadow colour', ['shadow', 'color'], c)} />
            </Field>
          </>
        )}
      </Section>

      <Section title="Glow">
        {glow === null ? (
          <p className="text-xs text-dim">Glow is animated in this project (keyframes).</p>
        ) : (
          <SliderField label="Strength" hint={`${Math.round(glow * 100)}%`} min={0} max={1} step={0.01} value={glow} onValueChange={(v) => edit('Glow', ['glow'], { static: v })} />
        )}
        <Field label="Colour">
          <ColorField label="Glow colour" value={layer.glowColor} onChange={(c) => edit('Glow colour', ['glowColor'], c)} />
        </Field>
      </Section>

      <TransformSection layer={layer} edit={edit} />
      {anim && (
        <Section title="Custom glyph animation">
          <SelectField
            label="Easing"
            value={easingName(anim.easing)}
            options={[...Object.keys(EASING_PRESETS), ...(easingName(anim.easing) === 'Custom' ? ['Custom'] : [])].map((k) => ({ value: k, label: k }))}
            onValueChange={(k) => EASING_PRESETS[k] && edit('Easing', ['animator', 'easing'], EASING_PRESETS[k])}
          />
          <SelectField<StaggerOrder>
            label="Order"
            value={anim.order}
            options={ORDER_OPTIONS}
            onValueChange={(o) => edit('Stagger order', ['animator', 'order'], o)}
          />
          <SliderField label="Stagger" hint={`${Math.round(anim.stagger * 1000)}ms`} min={0} max={0.2} step={0.005} value={anim.stagger} onValueChange={(v) => edit('Stagger', ['animator', 'stagger'], v)} />
          <SliderField label="Duration" hint={`${anim.duration.toFixed(2)}s`} min={0.1} max={2} step={0.05} value={anim.duration} onValueChange={(v) => edit('Duration', ['animator', 'duration'], v)} />
          <SliderField label="Rise from" hint={`${anim.pose.offsetY}px`} min={-200} max={200} value={anim.pose.offsetY} onValueChange={(v) => edit('Rise', ['animator', 'pose', 'offsetY'], v)} />
          <SliderField label="Rotate from" hint={`${anim.pose.rotation}°`} min={-90} max={90} value={anim.pose.rotation} onValueChange={(v) => edit('Rotate', ['animator', 'pose', 'rotation'], v)} />
          <SliderField label="Scale from" hint={`${anim.pose.scaleX.toFixed(2)}×`} min={0} max={3} step={0.05} value={anim.pose.scaleX} onValueChange={(v) => edit('Scale', ['animator', 'pose'], { ...anim.pose, scaleX: v, scaleY: v })} />
          <SliderField label="Seed" hint={String(anim.seed)} min={0} max={100} value={anim.seed} onValueChange={(v) => edit('Seed', ['animator', 'seed'], v)} />
        </Section>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------

