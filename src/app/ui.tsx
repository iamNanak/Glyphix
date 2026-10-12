// App-chrome primitives. Thin adapters over Wensity UI (free/MIT primitives in
// src/components/wensity) so the editor code keeps one small, stable API.
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Button as WButton } from '@/components/wensity/button';
import { Slider } from '@/components/wensity/slider';
import { Select } from '@/components/wensity/select';
import { Toggle, ToggleGroup, ToggleGroupItem } from '@/components/wensity/toggle';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/wensity/tooltip';
import { ColorPicker } from '@/components/wensity/color-picker';
import type { Color } from '@/doc';

type NativeButton = ButtonHTMLAttributes<HTMLButtonElement>;

/** Icon-only button with a tooltip. `label` is both the accessible name and the tooltip text. */
export const IconButton = forwardRef<HTMLButtonElement, NativeButton & { label: string; active?: boolean; shortcut?: string }>(function IconButton(
  { label, children, active, className = '', shortcut, ...rest },
  ref,
) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
          <WButton
            ref={ref}
            type="button"
            variant="ghost"
            size="icon"
            aria-label={label}
            aria-pressed={active}
            className={`h-8 min-w-8 text-zinc-300 hover:text-white ${active ? 'bg-white/10 text-white' : ''} ${className}`}
            {...rest}
          >
            {children}
          </WButton>
      </TooltipTrigger>
      <TooltipContent side="bottom" shortcut={shortcut ? [shortcut] : undefined}>
        {label}
      </TooltipContent>
    </Tooltip>
  );
});

export function Button({ children, variant = 'secondary', className = '', ...rest }: NativeButton & { variant?: 'primary' | 'secondary' }) {
  return (
    <WButton type="button" size="sm" variant={variant === 'primary' ? 'default' : 'secondary'} className={`gap-1.5 ${variant === 'primary' ? 'bg-accent text-white hover:bg-violet-400' : ''} ${className}`} {...rest}>
      {children}
    </WButton>
  );
}

/** Label + control for native-style inputs (the <label> wraps the control for its accessible name). */
export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block space-y-1.5">
      <FieldHeader label={label} hint={hint} />
      {children}
    </label>
  );
}

function FieldHeader({ label, hint }: { label: string; hint?: string }) {
  return (
    <span className="flex items-baseline justify-between text-xs font-medium text-dim">
      {label}
      {hint && <span className="tabular-nums text-zinc-400">{hint}</span>}
    </span>
  );
}

export function SliderField({
  label,
  hint,
  value,
  min,
  max,
  step = 1,
  onValueChange,
}: {
  label: string;
  hint?: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onValueChange: (v: number) => void;
}) {
  return (
    <div className="space-y-1.5">
      <FieldHeader label={label} hint={hint} />
      <Slider label={label} value={value} min={min} max={max} step={step} size="sm" showValue={false} onValueChange={onValueChange} />
    </div>
  );
}

export function SelectField<T extends string>({
  label,
  value,
  options,
  onValueChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onValueChange: (v: T) => void;
}) {
  return (
    <div className="space-y-1.5">
      <FieldHeader label={label} />
      <Select aria-label={label} selectSize="sm" fullWidth value={value} options={options} onValueChange={(v) => onValueChange(v as T)} />
    </div>
  );
}

export const inputClass =
  'w-full rounded-md bg-panel-2 px-2.5 py-1.5 text-sm text-zinc-100 ring-1 ring-line outline-none focus:ring-accent';

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3 border-b border-line px-4 py-4">
      <h3 className="text-[11px] font-semibold tracking-wider text-dim uppercase">{title}</h3>
      {children}
    </section>
  );
}

export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T | string;
  options: { value: T; label: string; disabled?: boolean }[];
  onChange: (v: T) => void;
}) {
  return (
    <ToggleGroup
      aria-label={label}
      type="single"
      size="sm"
      value={value}
      onValueChange={(v) => {
        const next = Array.isArray(v) ? v[0] : v;
        if (next) onChange(next as T); // ignore "deselect": a segmented control always has a value
      }}
      className="w-full"
    >
      {options.map((o) => (
        <ToggleGroupItem key={o.value} value={o.value} disabled={o.disabled} className="flex-1 text-xs">
          {o.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

/** Colour swatch that opens Wensity's picker; doc colours are 0..1 RGBA. */
export function ColorField({ value, onChange, label = 'Colour', alpha = false }: { value: Color; onChange: (c: Color) => void; label?: string; alpha?: boolean }) {
  return (
    <ColorPicker value={toHex(value, alpha)} alpha={alpha} showValue={false} eyedropper onChange={(hex) => onChange(fromHex(hex, value[3]))}>
      <button
        type="button"
        aria-label={label}
        title={label}
        className="h-8 w-full min-w-8 rounded-md ring-1 ring-line transition hover:ring-accent"
        style={{ background: toHex(value, alpha) }}
      />
    </ColorPicker>
  );
}

const hex2 = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0');
export const toHex = (c: readonly number[], alpha = false) => `#${c.slice(0, alpha ? 4 : 3).map(hex2).join('')}`;
export function fromHex(hex: string, fallbackAlpha = 1): Color {
  const n = (i: number) => parseInt(hex.slice(i, i + 2), 16) / 255;
  return [n(1), n(3), n(5), hex.length >= 9 ? n(7) : fallbackAlpha];
}

/** Wrapping grid of mutually exclusive presets (frames, canvas sizes, shadows, tilts). */
export function PresetGrid<T extends string>({
  label,
  value,
  options,
  onChange,
  columns = 3,
}: {
  label: string;
  value: T | string;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  columns?: number;
}) {
  return (
    <div role="group" aria-label={label} className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
      {options.map((o) => (
        <Toggle
          key={o.value}
          variant="outline"
          size="sm"
          pressed={value === o.value}
          onPressedChange={() => onChange(o.value)}
          className="h-auto min-h-8 px-1.5 py-1.5 text-xs leading-tight whitespace-normal data-[pressed]:border-accent data-[pressed]:bg-accent/20 data-[pressed]:text-white"
        >
          {o.label}
        </Toggle>
      ))}
    </div>
  );
}
