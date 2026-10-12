"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/*  Kbd — Keyboard key & shortcut display primitive                   */
/* ------------------------------------------------------------------ */

export type KbdSize = "sm" | "md";

export interface KbdProps extends React.HTMLAttributes<HTMLElement> {
  /** Single key children (e.g. `⌘`, `Ctrl`, `K`). */
  children?: React.ReactNode;
  /** Array of keys to render as a combined shortcut. */
  keys?: string[];
  /** Inline variant — smaller and tighter for use inside text. */
  inline?: boolean;
  /** Size preset. */
  size?: KbdSize;
}

export interface KbdSequenceProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
}

export interface KbdCommandProps extends React.HTMLAttributes<HTMLDivElement> {
  /** The command label. */
  children: React.ReactNode;
  /** Array of keys for the shortcut displayed on the right. */
  keys?: string[];
}

/* ------------------------------------------------------------------ */
/*  Styles                                                            */
/* ------------------------------------------------------------------ */

const base = cn(
  "inline-flex shrink-0 items-center justify-center whitespace-nowrap",
  "font-[family-name:var(--primitive-font-mono)] font-medium tracking-[-0.005em] select-none",
  "border border-[color-mix(in_srgb,var(--foreground)_14%,transparent)]",
  "bg-[color-mix(in_srgb,var(--foreground)_5%,var(--background))]",
  "shadow-[inset_0_1px_0_rgba(255,255,255,0.10),inset_0_-1px_0_rgba(0,0,0,0.28),0_1px_2px_rgba(0,0,0,0.30)]",
  "dark:border-[color-mix(in_srgb,var(--foreground)_12%,transparent)]",
  "dark:bg-[color-mix(in_srgb,var(--foreground)_6%,var(--background))]",
  "dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.06),inset_0_-1px_0_rgba(0,0,0,0.55),0_1px_2px_rgba(0,0,0,0.50)]",
);

const sizes: Record<KbdSize, string> = {
  sm: "h-5 min-w-[20px] px-1.5 text-[10px] rounded-[var(--primitive-radius-control-sm)]",
  md: "h-6 min-w-[24px] px-1.5 text-[11px] rounded-[var(--primitive-radius-control-sm)]",
};

const inlineSize = "h-[1.35em] min-w-[1.35em] px-[0.3em] text-[0.8em] rounded-[var(--primitive-radius-control-sm)] align-[0.05em]";

const separator =
  "inline-flex shrink-0 items-center justify-center px-0.5 text-[11px] text-[color-mix(in_srgb,var(--foreground)_32%,transparent)] select-none";

/* ------------------------------------------------------------------ */
/*  Kbd                                                               */
/* ------------------------------------------------------------------ */

export const KbdRoot = React.forwardRef<HTMLElement, KbdProps>(
  ({ className, children, keys, inline, size = "md", ...props }, ref) => {
    // Shortcut mode: render multiple keys joined by a separator
    if (keys && keys.length > 0) {
      return (
        <span className={cn("inline-flex items-center gap-0", className)}>
          {keys.map((key, i) => (
            <React.Fragment key={i}>
              {i > 0 && <span className={separator}>+</span>}
              <kbd data-wensity-primitive=""
                ref={i === 0 ? ref : undefined}
                className={cn(base, inline ? inlineSize : sizes[size])}
                {...props}
              >
                {key}
              </kbd>
            </React.Fragment>
          ))}
        </span>
      );
    }

    // Single key mode
    return (
      <kbd data-wensity-primitive=""
        ref={ref}
        className={cn(base, inline ? inlineSize : sizes[size], className)}
        {...props}
      >
        {children}
      </kbd>
    );
  },
);
KbdRoot.displayName = "Kbd";

/* ------------------------------------------------------------------ */
/*  Kbd.Sequence — ordered key-press sequence                         */
/* ------------------------------------------------------------------ */

const KbdSequence = React.forwardRef<HTMLDivElement, KbdSequenceProps>(
  ({ className, children, ...props }, ref) => {
    return (
      <div data-wensity-primitive=""
        ref={ref}
        className={cn("inline-flex items-center gap-1", className)}
        {...props}
      >
        {children}
      </div>
    );
  },
);
KbdSequence.displayName = "KbdSequence";

/* ------------------------------------------------------------------ */
/*  Kbd.Command — labelled command with shortcut                      */
/* ------------------------------------------------------------------ */

const KbdCommand = React.forwardRef<HTMLDivElement, KbdCommandProps>(
  ({ className, children, keys, ...props }, ref) => {
    return (
      <div data-wensity-primitive=""
        ref={ref}
        className={cn(
          "flex w-full items-center justify-between gap-3 rounded-[var(--primitive-radius-item)] px-3 py-2",
          "border border-[color-mix(in_srgb,var(--foreground)_8%,transparent)]",
          "bg-[color-mix(in_srgb,var(--foreground)_3%,var(--background))]",
          "dark:bg-[color-mix(in_srgb,var(--foreground)_2%,var(--background))]",
          className,
        )}
        {...props}
      >
        <span className="text-[13px] font-medium tracking-[-0.005em] text-[var(--foreground)]">
          {children}
        </span>
        {keys && keys.length > 0 && (
          <span className="inline-flex items-center gap-0.5">
            {keys.map((key, i) => (
              <React.Fragment key={i}>
                {i > 0 && <span className={separator}>+</span>}
                <kbd data-wensity-primitive="" className={cn(base, sizes.sm)}>{key}</kbd>
              </React.Fragment>
            ))}
          </span>
        )}
      </div>
    );
  },
);
KbdCommand.displayName = "KbdCommand";

/* ------------------------------------------------------------------ */
/*  Attach compound parts                                              */
/* ------------------------------------------------------------------ */

(KbdRoot as typeof KbdRoot & {
  Sequence: typeof KbdSequence;
  Command: typeof KbdCommand;
}).Sequence = KbdSequence;
(KbdRoot as typeof KbdRoot & {
  Sequence: typeof KbdSequence;
  Command: typeof KbdCommand;
}).Command = KbdCommand;

export const Kbd = KbdRoot as typeof KbdRoot & {
  Sequence: typeof KbdSequence;
  Command: typeof KbdCommand;
};

export { KbdSequence, KbdCommand };
