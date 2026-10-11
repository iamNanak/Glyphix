// Minimal chrome primitives (Milestone A). To be replaced by Opensource UI / Magic UI components in Milestone B.
import type { ButtonHTMLAttributes, ReactNode } from 'react';

export function IconButton({ label, children, active, className = '', ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; active?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active}
      className={`inline-flex h-8 min-w-8 items-center justify-center gap-1.5 rounded-md px-2 text-sm text-zinc-300 transition hover:bg-white/8 hover:text-white disabled:pointer-events-none disabled:opacity-35 ${active ? 'bg-white/10 text-white' : ''} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}

export function Button({ children, variant = 'secondary', className = '', ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' }) {
  const styles =
    variant === 'primary'
      ? 'bg-accent text-white hover:bg-violet-400'
      : 'bg-panel-2 text-zinc-200 ring-1 ring-line hover:bg-white/10';
  return (
    <button type="button" className={`inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-sm font-medium transition disabled:opacity-50 ${styles} ${className}`} {...rest}>
      {children}
    </button>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block space-y-1.5">
      <span className="flex items-baseline justify-between text-xs font-medium text-muted">
        {label}
        {hint && <span className="tabular-nums text-zinc-400">{hint}</span>}
      </span>
      {children}
    </label>
  );
}

export const inputClass =
  'w-full rounded-md bg-panel-2 px-2.5 py-1.5 text-sm text-zinc-100 ring-1 ring-line outline-none focus:ring-accent';

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3 border-b border-line px-4 py-4">
      <h3 className="text-[11px] font-semibold tracking-wider text-muted uppercase">{title}</h3>
      {children}
    </section>
  );
}
