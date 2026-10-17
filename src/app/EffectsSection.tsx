// Effect stack for any layer: add, reorder, switch on/off, remove, and edit (keyframable) params.
import { useState } from 'react';
import { ArrowDown, ArrowUp, Diamond, Plus, Trash2 } from 'lucide-react';
import { Popover, PopoverContent, PopoverMenuItem, PopoverTrigger } from '@/components/wensity/popover';
import { Switch } from '@/components/wensity/switch';
import {
  addKey,
  createEffect,
  EFFECTS,
  effectDef,
  keyAt,
  removeKey,
  sampleProp,
  setValueAt,
  type Effect,
  type EffectKind,
  type EffectParamDef,
  type Layer,
  type Prop,
} from '@/doc';
import { useEditor } from './store';
import { Button, ColorField, Field, IconButton, Section } from './ui';
import { Slider } from '@/components/wensity/slider';
import { Select } from '@/components/wensity/select';

type Edit = (label: string, path: (string | number)[], value: unknown) => void;

/** Half a frame: keys closer than this to the playhead count as "at the playhead". */
const useKeyEps = () => useEditor((s) => 0.5 / s.doc.comp.fps);

function formatValue(def: EffectParamDef, v: number) {
  if (def.percent) return `${Math.round(v * 100)}%`;
  const digits = def.step < 0.1 ? 2 : def.step < 1 ? 1 : 0;
  return `${v.toFixed(digits)}${def.unit && def.unit !== '/s' ? def.unit : def.unit ? ` ${def.unit}` : ''}`;
}

/** Animated params follow the playhead; static ones don't subscribe to time (no re-render while playing). */
function ParamControl(props: { def: EffectParamDef; prop: Prop<number>; effectLabel: string; onChange: (p: Prop<number>, label: string) => void }) {
  return 'track' in props.prop ? <AnimatedParam {...props} /> : <ParamRow {...props} time={null} />;
}

function AnimatedParam(props: { def: EffectParamDef; prop: Prop<number>; effectLabel: string; onChange: (p: Prop<number>, label: string) => void }) {
  const time = useEditor((s) => s.time);
  return <ParamRow {...props} time={time} />;
}

function ParamRow({
  def,
  prop,
  effectLabel,
  onChange,
  time,
}: {
  def: EffectParamDef;
  prop: Prop<number>;
  effectLabel: string;
  onChange: (p: Prop<number>, label: string) => void;
  time: number | null;
}) {
  const eps = useKeyEps();
  const now = () => time ?? useEditor.getState().time;
  const value = sampleProp(prop, now());
  const key = time === null ? null : keyAt(prop, time, eps);
  const animated = 'track' in prop;
  const keyCount = animated ? prop.track.keys.length : 0;
  const name = `${effectLabel} ${def.label.toLowerCase()}`;
  const set = (v: number) => onChange(setValueAt(prop, now(), v, eps), `${effectLabel}: ${def.label}`);
  const toggleKey = () => {
    const t = now();
    onChange(key ? removeKey(prop, t, eps) : addKey(prop, t, sampleProp(prop, t), eps), key ? 'Remove keyframe' : 'Add keyframe');
  };
  const keyButton = def.fixed ? null : (
    <button
      type="button"
      onClick={toggleKey}
      aria-pressed={!!key}
      aria-label={key ? `Remove ${name} keyframe at playhead` : `Add ${name} keyframe at playhead`}
      title={key ? 'Remove keyframe at playhead' : animated ? 'Add keyframe at playhead' : 'Animate: add a keyframe at the playhead'}
      className={`grid size-5 place-items-center rounded outline-none focus-visible:ring-2 focus-visible:ring-accent ${animated ? 'text-amber-300' : 'text-zinc-500 hover:text-zinc-200'}`}
    >
      <Diamond size={11} fill={key ? 'currentColor' : 'none'} />
    </button>
  );

  if (def.options)
    return (
      <div className="space-y-1.5">
        <span className="flex items-center gap-1 text-xs font-medium text-dim">
          {keyButton}
          {def.label}
        </span>
        <Select
          aria-label={name}
          selectSize="sm"
          fullWidth
          value={String(Math.round(value))}
          options={def.options.map((o) => ({ value: String(o.value), label: o.label }))}
          onValueChange={(v) => set(Number(v))}
        />
      </div>
    );
  if (def.toggle)
    return (
      <div className="text-xs font-medium text-dim">
        <Switch switchSize="sm" label={def.label} checked={value >= 0.5} onCheckedChange={(on) => set(on ? 1 : 0)} />
      </div>
    );
  return (
    <div className="space-y-1.5">
      <span className="flex items-center justify-between gap-2 text-xs font-medium text-dim">
        <span className="flex items-center gap-1">
          {keyButton}
          {def.label}
          {keyCount > 1 && <span className="text-[10px] text-amber-300/80">{keyCount} keys</span>}
        </span>
        <span className="tabular-nums text-zinc-400">{formatValue(def, value)}</span>
      </span>
      <Slider label={name} value={value} min={def.min} max={def.max} step={def.step} size="sm" showValue={false} onValueChange={set} />
    </div>
  );
}

function EffectCard({ effects, index, edit }: { effects: Effect[]; index: number; edit: Edit }) {
  const effect = effects[index]!;
  const count = effects.length;
  const def = effectDef(effect.kind);
  const base = ['effects', index];
  // Reorder/remove are whole-array edits, so each is one undo step.
  const move = (delta: number) => {
    const list = effects.slice();
    [list[index], list[index + delta]] = [list[index + delta]!, list[index]!];
    edit('Reorder effects', ['effects'], list);
  };
  return (
    <div className="space-y-3 rounded-lg bg-panel-2/60 p-3 ring-1 ring-line" data-effect={effect.kind}>
      <div className="flex items-center gap-1.5">
        {/* The switch's label is the effect name (Wensity's switch wraps itself in a full-width label). */}
        <div className={`min-w-0 flex-1 text-sm font-medium ${effect.enabled ? 'text-zinc-100' : 'text-zinc-500'}`}>
          <Switch switchSize="sm" label={def.label} labelClassName="truncate" checked={effect.enabled} onCheckedChange={(on) => edit(on ? `Enable ${def.label}` : `Disable ${def.label}`, [...base, 'enabled'], on)} />
        </div>
        <IconButton label={`Move ${def.label} up`} disabled={index === 0} onClick={() => move(-1)} className="h-7 min-w-7">
          <ArrowUp size={14} />
        </IconButton>
        <IconButton label={`Move ${def.label} down`} disabled={index === count - 1} onClick={() => move(1)} className="h-7 min-w-7">
          <ArrowDown size={14} />
        </IconButton>
        <IconButton label={`Remove ${def.label}`} onClick={() => edit(`Remove ${def.label}`, ['effects'], effects.filter((_, j) => j !== index))} className="h-7 min-w-7">
          <Trash2 size={14} />
        </IconButton>
      </div>
      {effect.enabled && (
        <>
          {def.params.map((p) => (
            <ParamControl
              key={p.key}
              def={p}
              effectLabel={def.label}
              prop={effect.params[p.key] ?? { static: p.default }}
              onChange={(value, label) => edit(label, [...base, 'params', p.key], value)}
            />
          ))}
          {def.colors.length > 0 && (
            <div className="grid grid-cols-2 gap-2">
              {def.colors.map((c) => (
                <Field key={c.key} label={c.label.replace(/ colour$/, '')}>
                  <ColorField label={`${def.label} ${c.label.toLowerCase()}`} value={effect.colors[c.key] ?? c.default} onChange={(v) => edit(`${def.label}: ${c.label}`, [...base, 'colors', c.key], v)} />
                </Field>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export function AddEffectMenu({ onAdd, label = 'Add effect' }: { onAdd: (kind: EffectKind) => void; label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button className="w-full justify-center">
          <Plus size={14} /> {label}
        </Button>
      </PopoverTrigger>
      <PopoverContent width="sm" side="left" align="start" className="max-h-[70vh] overflow-y-auto p-1.5">
        <div
          role="menu"
          aria-label="Effects"
          onKeyDown={(e) => {
            // Menu semantics: arrow keys move between items, Home/End jump to the ends.
            const items = [...e.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]')];
            const i = items.indexOf(document.activeElement as HTMLElement);
            const next = { ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: items.length - 1 }[e.key];
            if (next === undefined) return;
            e.preventDefault();
            items[(next + items.length) % items.length]?.focus();
          }}
        >
          {EFFECTS.map((d) => (
            <PopoverMenuItem
              key={d.kind}
              role="menuitem"
              onClick={() => {
                onAdd(d.kind);
                setOpen(false);
              }}
              className="flex-col items-start gap-0"
            >
              <span className="text-[13px] text-zinc-100">{d.label}</span>
              <span className="text-[11px] text-zinc-400">{d.description}</span>
            </PopoverMenuItem>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function EffectsSection({ layer, edit, title = 'Effects' }: { layer: Layer; edit: Edit; title?: string }) {
  const effects = layer.effects ?? [];
  return (
    <Section title={title}>
      {effects.map((e, i) => (
        <EffectCard key={e.id} effects={effects} index={i} edit={edit} />
      ))}
      <AddEffectMenu onAdd={(kind) => edit(`Add ${effectDef(kind).label}`, ['effects'], [...effects, createEffect(kind)])} />
    </Section>
  );
}
