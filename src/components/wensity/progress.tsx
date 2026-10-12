"use client";

import * as React from "react";
import { Progress as BaseProgress } from "@base-ui/react/progress";
import {
  motion,
  useMotionValue,
  useMotionValueEvent,
  useReducedMotion,
  useSpring,
  useTransform,
  type MotionValue,
} from "framer-motion";
import { cn } from "@/lib/utils";

export type ProgressSize = "sm" | "md" | "lg";
export type ProgressTone = "neutral" | "brand" | "success" | "warning" | "danger";

export interface ProgressProps extends React.HTMLAttributes<HTMLDivElement> {
  value?: number;
  max?: number;
  size?: ProgressSize;
  tone?: ProgressTone;
  /** Accessible label for the progress bar. */
  label?: string;
  showValue?: boolean;
  indeterminate?: boolean;
}

export interface CircularProgressProps extends React.HTMLAttributes<HTMLDivElement> {
  value?: number;
  max?: number;
  size?: number;
  strokeWidth?: number;
  tone?: ProgressTone;
  label?: string;
  showValue?: boolean;
  indeterminate?: boolean;
}

export interface SegmentedProgressProps extends React.HTMLAttributes<HTMLDivElement> {
  steps: number;
  current: number;
  size?: ProgressSize;
  tone?: ProgressTone;
  labels?: string[];
}

export interface StackedProgressSegment {
  value: number;
  tone?: ProgressTone;
  label?: string;
}

export interface StackedProgressProps extends React.HTMLAttributes<HTMLDivElement> {
  segments: StackedProgressSegment[];
  max?: number;
  size?: ProgressSize;
  showLegend?: boolean;
}

const EASE_OUT: [number, number, number, number] = [0.16, 1, 0.3, 1];

const PROGRESS_SPRING = { stiffness: 110, damping: 26, mass: 0.52 };
const PROGRESS_SPRING_INSTANT = { stiffness: 10000, damping: 100, mass: 1 };

const trackSizes: Record<ProgressSize, string> = {
  sm: "h-1.5 rounded-full",
  md: "h-2 rounded-full",
  lg: "h-2.5 rounded-full",
};

const fillTones: Record<ProgressTone, string> = {
  neutral:
    "bg-[linear-gradient(90deg,color-mix(in_srgb,var(--foreground)_72%,var(--background)),color-mix(in_srgb,var(--foreground)_88%,var(--background)))]",
  brand: "bg-[var(--primitive-control-solid)]",
  success: "bg-[var(--primitive-success)]",
  warning: "bg-[var(--primitive-warning)]",
  danger: "bg-[var(--primitive-destructive)]",
};

const fillGlow: Record<ProgressTone, string> = {
  neutral: "shadow-[0_0_14px_color-mix(in_srgb,var(--foreground)_22%,transparent)]",
  brand: "shadow-[0_0_16px_color-mix(in_srgb,var(--primitive-control-solid)_38%,transparent)]",
  success: "shadow-[0_0_16px_color-mix(in_srgb,var(--primitive-success)_32%,transparent)]",
  warning: "shadow-[0_0_16px_color-mix(in_srgb,var(--primitive-warning)_28%,transparent)]",
  danger: "shadow-[0_0_16px_color-mix(in_srgb,var(--primitive-destructive)_32%,transparent)]",
};

const completeDropShadow: Record<ProgressTone, string> = {
  neutral: "drop-shadow-[0_0_6px_color-mix(in_srgb,var(--foreground)_22%,transparent)]",
  brand: "drop-shadow-[0_0_6px_color-mix(in_srgb,var(--primitive-control-solid)_35%,transparent)]",
  success: "drop-shadow-[0_0_6px_color-mix(in_srgb,var(--primitive-success)_35%,transparent)]",
  warning: "drop-shadow-[0_0_6px_color-mix(in_srgb,var(--primitive-warning)_35%,transparent)]",
  danger: "drop-shadow-[0_0_6px_color-mix(in_srgb,var(--primitive-destructive)_35%,transparent)]",
};

const strokeTones: Record<ProgressTone, string> = {
  neutral: "stroke-[color-mix(in_srgb,var(--foreground)_75%,var(--background))]",
  brand: "stroke-[var(--primitive-control-solid)]",
  success: "stroke-[var(--primitive-success)]",
  warning: "stroke-[var(--primitive-warning)]",
  danger: "stroke-[var(--primitive-destructive)]",
};

const indeterminateGradients: Record<ProgressTone, string> = {
  neutral:
    "bg-[linear-gradient(90deg,transparent,color-mix(in_srgb,var(--foreground)_70%,var(--background)),transparent)]",
  brand:
    "bg-[linear-gradient(90deg,transparent,var(--primitive-control-solid),transparent)]",
  success:
    "bg-[linear-gradient(90deg,transparent,var(--primitive-success),transparent)]",
  warning:
    "bg-[linear-gradient(90deg,transparent,var(--primitive-warning),transparent)]",
  danger:
    "bg-[linear-gradient(90deg,transparent,var(--primitive-destructive),transparent)]",
};

const legendDots: Record<ProgressTone, string> = {
  neutral: "bg-[color-mix(in_srgb,var(--foreground)_70%,var(--background))]",
  brand: "bg-[var(--primitive-control-solid)]",
  success: "bg-[var(--primitive-success)]",
  warning: "bg-[var(--primitive-warning)]",
  danger: "bg-[var(--primitive-destructive)]",
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function percent(value: number, max: number) {
  if (max <= 0) return 0;
  return clamp((value / max) * 100, 0, 100);
}

function useSmoothPercent(target: number, reduceMotion: boolean) {
  const motionValue = useMotionValue(target);
  const smooth = useSpring(
    motionValue,
    reduceMotion ? PROGRESS_SPRING_INSTANT : PROGRESS_SPRING,
  );

  React.useEffect(() => {
    motionValue.set(target);
  }, [target, motionValue]);

  return smooth;
}

function ProgressPercentLabel({
  value,
  className,
  initial = 0,
}: {
  value: MotionValue<number>;
  className?: string;
  initial?: number;
}) {
  const [display, setDisplay] = React.useState(initial);

  useMotionValueEvent(value, "change", (next) => {
    setDisplay(Math.round(next));
  });

  return <span className={className}>{display}%</span>;
}

export const Progress = React.forwardRef<HTMLDivElement, ProgressProps>(
  (
    {
      className,
      value = 0,
      max = 100,
      size = "md",
      tone = "brand",
      label = "Progress",
      showValue = false,
      indeterminate = false,
      ...props
    },
    ref,
  ) => {
    const reduceMotion = useReducedMotion() ?? false;

    React.useEffect(() => {
      ensureProgressStyles();
    }, []);

    const actual = percent(value, max);
    const smoothPercent = useSmoothPercent(actual, reduceMotion);
    const isComplete = actual >= 100;

    return (
      <BaseProgress.Root data-wensity-primitive=""
        ref={ref}
        value={indeterminate ? null : value}
        max={max}
        aria-label={label}
        aria-busy={indeterminate || undefined}
        data-slot="progress"
        className={cn("w-full", className)}
        {...props}
      >
        {showValue ? (
          <div className="mb-2 flex items-center justify-between text-xs">
            <BaseProgress.Label className="font-medium text-[var(--foreground)]">
              {label}
            </BaseProgress.Label>
            {!indeterminate ? (
              <ProgressPercentLabel
                value={smoothPercent}
                initial={Math.round(actual)}
                className="tabular-nums text-[var(--muted-foreground)]"
              />
            ) : null}
          </div>
        ) : null}
        <BaseProgress.Track
          className={cn(
            "relative w-full overflow-hidden bg-[color-mix(in_srgb,var(--foreground)_8%,var(--background))]",
            trackSizes[size],
            isComplete &&
              "ring-1 ring-[color-mix(in_srgb,var(--foreground)_12%,transparent)] transition-shadow duration-500 ease-out",
          )}
        >
          {indeterminate ? (
            <span
              aria-hidden="true"
              className={cn(
                "absolute inset-y-0 left-0 w-1/2 rounded-full",
                "motion-safe:animate-[wensity-progress-indeterminate-sweep_1.65s_cubic-bezier(0.45,0.05,0.2,1)_infinite]",
                "motion-reduce:left-[25%] motion-reduce:opacity-70",
                indeterminateGradients[tone],
              )}
            />
          ) : (
            <BaseProgress.Indicator
              className={cn(
                // `block` + inherit height from Base UI so the themed fill paints.
                "block rounded-full transition-[width] duration-500 ease-[var(--primitive-ease,cubic-bezier(0.16,1,0.3,1))]",
                "motion-reduce:transition-none",
                fillTones[tone],
                isComplete && fillGlow[tone],
              )}
            />
          )}
        </BaseProgress.Track>
      </BaseProgress.Root>
    );
  },
);
Progress.displayName = "Progress";

export const CircularProgress = React.forwardRef<HTMLDivElement, CircularProgressProps>(
  (
    {
      className,
      value = 0,
      max = 100,
      size = 56,
      strokeWidth = 7,
      tone = "brand",
      label = "Progress",
      showValue = true,
      indeterminate = false,
      ...props
    },
    ref,
  ) => {
    const reduceMotion = useReducedMotion() ?? false;

    React.useEffect(() => {
      ensureProgressStyles();
    }, []);

    const radius = (size - strokeWidth) / 2;
    const circumference = 2 * Math.PI * radius;
    const actual = percent(value, max);
    const smoothPercent = useSmoothPercent(actual, reduceMotion);
    const strokeOffset = useTransform(
      smoothPercent,
      (v) => circumference - (v / 100) * circumference,
    );
    const isComplete = actual >= 100;

    return (
      <div data-wensity-primitive=""
        ref={ref}
        data-slot="circular-progress"
        className={cn("relative inline-flex items-center justify-center", className)}
        style={{ width: size, height: size }}
        {...props}
      >
        <svg
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          className={cn("-rotate-90", indeterminate && "motion-safe:animate-[wensity-progress-circular-spin_2s_linear_infinite]")}
          role="progressbar"
          aria-label={label}
          aria-valuemin={0}
          aria-valuemax={max}
          aria-valuenow={indeterminate ? undefined : value}
          aria-busy={indeterminate || undefined}
        >
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            strokeWidth={strokeWidth}
            className="stroke-[color-mix(in_srgb,var(--foreground)_10%,var(--background))]"
          />
          {indeterminate ? (
            <circle
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              strokeWidth={strokeWidth}
              strokeLinecap="round"
              className={cn(strokeTones[tone], "opacity-95")}
              style={{
                strokeDasharray: `${circumference * 0.68} ${circumference}`,
                strokeDashoffset: circumference * 0.08,
              }}
            />
          ) : (
            <motion.circle
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              strokeWidth={strokeWidth}
              strokeLinecap="round"
              className={cn(strokeTones[tone], isComplete && completeDropShadow[tone])}
              style={{
                strokeDasharray: circumference,
                strokeDashoffset: strokeOffset,
              }}
            />
          )}
        </svg>
        {showValue && !indeterminate ? (
          <ProgressPercentLabel
            value={smoothPercent}
            initial={Math.round(actual)}
            className="absolute text-[11px] font-semibold tabular-nums text-[var(--foreground)]"
          />
        ) : null}
      </div>
    );
  },
);
CircularProgress.displayName = "CircularProgress";

export const SegmentedProgress = React.forwardRef<HTMLDivElement, SegmentedProgressProps>(
  ({ className, steps, current, size = "md", tone = "brand", labels, ...props }, ref) => {
    const reduceMotion = useReducedMotion() ?? false;

    return (
      <div data-wensity-primitive="" ref={ref} data-slot="segmented-progress" className={cn("w-full", className)} {...props}>
        <div
          role="progressbar"
          aria-label="Step progress"
          aria-valuemin={0}
          aria-valuemax={steps}
          aria-valuenow={current}
          className="flex w-full gap-1.5"
        >
          {Array.from({ length: Math.max(1, steps) }, (_, index) => {
            const stepNumber = index + 1;
            const safeCurrent = clamp(current, 0, Math.max(1, steps));
            const isComplete = stepNumber < safeCurrent;
            const isActive = stepNumber === safeCurrent;

            return (
              <div key={index} className="flex min-w-0 flex-1 flex-col gap-1.5">
                <div
                  className={cn(
                    "relative overflow-hidden bg-[color-mix(in_srgb,var(--foreground)_8%,var(--background))]",
                    trackSizes[size],
                  )}
                >
                  <motion.span
                    aria-hidden="true"
                    className={cn(
                      "block h-full rounded-full",
                      isComplete || isActive ? fillTones[tone] : "opacity-0",
                    )}
                    initial={false}
                    animate={{
                      width: isComplete || isActive ? "100%" : "0%",
                      opacity: isComplete || isActive ? 1 : 0,
                    }}
                    transition={
                      reduceMotion
                        ? { duration: 0 }
                        : { duration: 0.42, ease: EASE_OUT }
                    }
                  />
                </div>
                {labels?.[index] ? (
                  <span
                    className={cn(
                      "truncate text-[10px] font-medium tracking-[-0.01em] transition-colors duration-200 ease-out motion-reduce:transition-none",
                      isActive || isComplete
                        ? "text-[var(--foreground)]"
                        : "text-[var(--muted-foreground)]",
                    )}
                  >
                    {labels[index]}
                  </span>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    );
  },
);
SegmentedProgress.displayName = "SegmentedProgress";

export const StackedProgress = React.forwardRef<HTMLDivElement, StackedProgressProps>(
  (
    {
      className,
      segments,
      max = 100,
      size = "md",
      showLegend = true,
      ...props
    },
    ref,
  ) => {
    const reduceMotion = useReducedMotion() ?? false;
    const total = segments.reduce((sum, segment) => sum + segment.value, 0);
    const scaleMax = Math.max(max, total);

    return (
      <div data-wensity-primitive="" ref={ref} data-slot="stacked-progress" className={cn("w-full", className)} {...props}>
        <div
          role="progressbar"
          aria-label="Stacked progress"
          className={cn(
            "flex w-full overflow-hidden bg-[color-mix(in_srgb,var(--foreground)_8%,var(--background))]",
            trackSizes[size],
          )}
        >
          {segments.map((segment, index) => {
            const width = percent(segment.value, scaleMax);
            const tone = segment.tone ?? "neutral";
            return (
              <motion.span
                key={`${segment.label ?? "segment"}-${index}`}
                aria-hidden="true"
                title={segment.label}
                className={cn(
                  "h-full",
                  fillTones[tone],
                  index > 0 && "border-l border-[var(--background)]/80",
                )}
                initial={false}
                animate={{ width: `${width}%` }}
                transition={
                  reduceMotion
                    ? { duration: 0 }
                    : { duration: 0.55, ease: EASE_OUT }
                }
              />
            );
          })}
        </div>
        {showLegend ? (
          <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1.5">
            {segments.map((segment, index) => {
              const tone = segment.tone ?? "neutral";
              return (
                <div
                  key={`${segment.label ?? "legend"}-${index}`}
                  className="inline-flex items-center gap-1.5 text-[11px] text-[var(--muted-foreground)]"
                >
                  <span
                    aria-hidden="true"
                    className={cn("size-2 rounded-full", legendDots[tone])}
                  />
                  <span className="font-medium text-[var(--foreground)]">{segment.label}</span>
                  <span className="tabular-nums">{segment.value}</span>
                </div>
              );
            })}
          </div>
        ) : null}
      </div>
    );
  },
);
StackedProgress.displayName = "StackedProgress";

const PROGRESS_STYLE_ID = "wensity-progress-styles-v3";

function ensureProgressStyles() {
  if (typeof document === "undefined") return;
  if (document.getElementById(PROGRESS_STYLE_ID)) return;

  const style = document.createElement("style");
  style.id = PROGRESS_STYLE_ID;
  style.textContent = `
    @keyframes wensity-progress-indeterminate-sweep {
      0% { transform: translateX(-100%); }
      100% { transform: translateX(200%); }
    }
    @keyframes wensity-progress-circular-spin {
      100% { transform: rotate(270deg); }
    }
    @media (prefers-reduced-motion: reduce) {
      [data-slot="progress"] [class*="wensity-progress-indeterminate-sweep"],
      [data-slot="circular-progress"] [class*="wensity-progress-circular-spin"] {
        animation: none !important;
      }
    }
  `;
  document.head.appendChild(style);
}

export function ProgressStyles() {
  React.useEffect(() => {
    ensureProgressStyles();
  }, []);
  return null;
}
