import {
  defaultEnter,
  defaultLoop,
  Easings,
  ENTER_PRESETS,
  LOOP_PRESETS,
  type Easing,
  type EnterPreset,
  type ImageLayer,
  type LoopPreset,
  type TextLayer,
} from '@/doc';
import { useEditor } from './store';
import { PresetGrid, Section, SelectField, SliderField } from './ui';

type Edit = (label: string, path: (string | number)[], value: unknown) => void;

export const EASINGS: Record<string, Easing> = {
  'Ease out': Easings.easeOutCubic,
  'Ease out back': Easings.easeOutBack,
  'Ease in-out': Easings.easeInOutCubic,
  Spring: { kind: 'spring', mass: 1, stiffness: 170, damping: 12 },
  Linear: Easings.linear,
  Instant: { kind: 'hold' },
};

export const easingName = (e: Easing) => Object.entries(EASINGS).find(([, v]) => JSON.stringify(v) === JSON.stringify(e))?.[0] ?? 'Custom';

/** Enter + loop presets for an image or text layer. */
export function AnimationSection({ layer, edit }: { layer: ImageLayer | TextLayer; edit: Edit }) {
  const compDuration = useEditor((s) => s.doc.comp.duration);
  const { enter, loop } = layer.motion;
  const enterOptions = [{ value: 'none', label: 'None' }, ...ENTER_PRESETS.filter((p) => p.for.includes(layer.type)).map((p) => ({ value: p.id, label: p.label }))];
  const loopOptions = [{ value: 'none', label: 'None' }, ...LOOP_PRESETS.filter((p) => p.for.includes(layer.type)).map((p) => ({ value: p.id, label: p.label }))];

  const preview = (t: number) => {
    // Jump the playhead to just before the animation so the change is visible immediately.
    const s = useEditor.getState();
    s.setTime(Math.max(0, Math.min(s.doc.comp.duration, t)));
    s.setPlaying(true);
  };

  return (
    <Section title="Animation">
      <PresetGrid
        label="Enter animation"
        value={enter?.preset ?? 'none'}
        options={enterOptions}
        onChange={(id) => {
          if (id === 'none') return edit('Remove enter animation', ['motion', 'enter'], null);
          // Keep timing when switching between presets.
          const next = { ...defaultEnter(id as EnterPreset, enter?.start ?? 0), ...(enter ? { start: enter.start, duration: enter.duration } : {}) };
          edit('Enter animation', ['motion', 'enter'], next);
          preview(next.start);
        }}
      />
      {enter && (
        <>
          <SliderField
            label="Starts at"
            hint={`${enter.start.toFixed(2)}s`}
            min={0}
            max={compDuration}
            step={0.05}
            value={enter.start}
            onValueChange={(v) => edit('Animation start', ['motion', 'enter', 'start'], v)}
          />
          <SliderField
            label="Duration"
            hint={`${enter.duration.toFixed(2)}s`}
            min={0.1}
            max={3}
            step={0.05}
            value={enter.duration}
            onValueChange={(v) => edit('Animation duration', ['motion', 'enter', 'duration'], v)}
          />
          <SelectField
            label="Easing"
            value={easingName(enter.easing)}
            options={[...Object.keys(EASINGS), ...(easingName(enter.easing) === 'Custom' ? ['Custom'] : [])].map((k) => ({ value: k, label: k }))}
            onValueChange={(k) => EASINGS[k] && edit('Animation easing', ['motion', 'enter', 'easing'], EASINGS[k])}
          />
        </>
      )}

      <div className="pt-1 text-[11px] font-semibold tracking-wider text-dim uppercase">Loop</div>
      <PresetGrid
        label="Loop animation"
        value={loop?.preset ?? 'none'}
        options={loopOptions}
        onChange={(id) => {
          if (id === 'none') return edit('Remove loop', ['motion', 'loop'], null);
          edit('Loop animation', ['motion', 'loop'], defaultLoop(id as LoopPreset, { duration: compDuration }));
          preview(0);
        }}
      />
      {loop && (
        <>
          <SliderField
            label="Cycle"
            hint={`${loop.period.toFixed(1)}s`}
            min={0.4}
            max={Math.max(10, compDuration)}
            step={0.1}
            value={loop.period}
            onValueChange={(v) => edit('Loop cycle', ['motion', 'loop', 'period'], v)}
          />
          <SliderField
            label="Strength"
            hint={`${Math.round(loop.amount * 100)}%`}
            min={0}
            max={1}
            step={0.01}
            value={loop.amount}
            onValueChange={(v) => edit('Loop strength', ['motion', 'loop', 'amount'], v)}
          />
          {Math.abs(compDuration / loop.period - Math.round(compDuration / loop.period)) > 0.01 && (
            <p className="text-xs text-amber-300/90">
              The video is {compDuration}s; a {loop.period.toFixed(1)}s cycle won't loop seamlessly at the end.
            </p>
          )}
        </>
      )}
    </Section>
  );
}
