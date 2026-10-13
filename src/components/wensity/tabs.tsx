"use client";

/**
 * Tabs — Base UI Tabs foundation (Phase 5).
 * Base UI owns tablist/tab/tabpanel roles, roving focus, and aria-selected;
 * the Framer indicator (layoutId glide) reads the mirrored active value from
 * context and is gated by `useReducedMotion` → instant swap under RM
 * (closes PRIM-MOTION-002 for tabs).
 *
 * NOTE (PRIM-API-002): `variant="vertical"` is orientation, not a pure style.
 * It stays as a variant for shipped API compat and internally sets the Base UI
 * Root orientation.
 */

import * as React from "react";
import { Tabs as BaseTabs } from "@base-ui/react/tabs";
import { LayoutGroup, motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils";

/* ─── Types ─────────────────────────────────────────────────── */

export type TabsVariant =
  | "default"
  | "underline"
  | "pills"
  | "segmented"
  | "vertical";

export type TabsSize = "sm" | "md" | "lg";

export interface TabsProps
  extends Omit<
    React.ComponentPropsWithoutRef<typeof BaseTabs.Root>,
    "value" | "defaultValue" | "onValueChange" | "orientation"
  > {
  variant?: TabsVariant;
  size?: TabsSize;
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
}

export type TabsListProps = React.ComponentPropsWithoutRef<typeof BaseTabs.List>;

export interface TabsTriggerProps
  extends Omit<
    React.ComponentPropsWithoutRef<typeof BaseTabs.Tab>,
    "value"
  > {
  value: string;
}

export type TabsContentProps = React.ComponentPropsWithoutRef<typeof BaseTabs.Panel>;

/* ─── Context (variant/size + mirrored active value) ────────── */

type TabsContextValue = {
  variant: TabsVariant;
  size: TabsSize;
  activeValue: string | null;
  layoutId: string;
};

const TabsContext = React.createContext<TabsContextValue | null>(null);

function useTabsContext(): TabsContextValue {
  const ctx = React.useContext(TabsContext);
  if (!ctx) {
    throw new Error("Tabs subcomponents must be used within <Tabs>");
  }
  return ctx;
}

/* ─── Size / list / trigger visual maps ─────────────────────── */

const triggerSizes: Record<TabsSize, string> = {
  sm: "h-7 px-2.5 text-xs gap-1.5 [&_svg]:size-3",
  md: "h-8 px-3 text-sm gap-2 [&_svg]:size-3.5",
  lg: "h-9 px-3.5 text-[15px] gap-2 [&_svg]:size-4",
};

const listGaps: Record<TabsSize, string> = {
  sm: "gap-0.5",
  md: "gap-1",
  lg: "gap-1",
};

const listVariantClasses: Record<TabsVariant, string> = {
  default: "",
  underline: "border-b border-[var(--border)]",
  pills: "",
  segmented: cn(
    "rounded-[var(--primitive-radius-surface)] p-1",
    "bg-[var(--primitive-surface-hover)]",
    "border border-[var(--border)]",
  ),
  vertical: cn(
    "flex-col items-stretch",
    "border-l border-[var(--border)]",
    "pl-0",
  ),
};

const triggerBase = cn(
  "relative inline-flex shrink-0 items-center justify-center whitespace-nowrap",
  "font-medium leading-none tracking-[-0.01em] select-none touch-manipulation",
  "rounded-[var(--primitive-radius-item)] outline-none cursor-default",
  "transition-[color,background-color] duration-[180ms] ease-[var(--primitive-ease,cubic-bezier(0.23,1,0.32,1))]",
  "motion-reduce:transition-none",
  "focus-visible:ring-2 focus-visible:ring-[var(--primitive-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--background)]",
  "data-disabled:pointer-events-none data-disabled:opacity-45",
  "[&_svg]:pointer-events-none [&_svg]:shrink-0",
);

function triggerVariantClasses(
  variant: TabsVariant,
  isActive: boolean,
): string {
  switch (variant) {
    case "default":
      return isActive
        ? "text-[var(--foreground)]"
        : "text-[var(--muted-foreground)]";
    case "underline":
      return isActive
        ? "text-[var(--foreground)] rounded-none"
        : "text-[var(--muted-foreground)] rounded-none";
    case "pills":
      return isActive
        ? "text-[var(--foreground)] rounded-full"
        : "text-[var(--muted-foreground)] rounded-full";
    case "segmented":
      return isActive
        ? "text-[var(--foreground)] z-[1]"
        : "text-[var(--muted-foreground)] z-[1]";
    case "vertical":
      return isActive
        ? "text-[var(--foreground)] justify-start rounded-none"
        : "text-[var(--muted-foreground)] justify-start rounded-none";
    default:
      return "";
  }
}

const hoverClasses: Record<TabsVariant, string> = {
  default:
    "hover:text-[var(--foreground)] hover:bg-[var(--primitive-surface-hover)]",
  underline: "hover:text-[var(--foreground)]",
  pills:
    "hover:text-[var(--foreground)] hover:bg-[var(--primitive-surface-hover)]",
  segmented: "hover:text-[var(--foreground)]",
  vertical:
    "hover:text-[var(--foreground)] hover:bg-[var(--primitive-surface-hover)]",
};

const indicatorSpring = {
  type: "spring" as const,
  duration: 0.26,
  bounce: 0.08,
};

/* ─── <Tabs> ────────────────────────────────────────────────── */

export const Tabs = React.forwardRef<HTMLDivElement, TabsProps>(function Tabs(
  {
    variant = "default",
    size = "md",
    value: valueProp,
    defaultValue,
    onValueChange,
    className,
    children,
    ...props
  },
  ref,
) {
  const isControlled = valueProp !== undefined;
  const [internal, setInternal] = React.useState<string | null>(
    defaultValue ?? null,
  );
  const activeValue: string | null = isControlled
    ? (valueProp ?? null)
    : internal;
  const layoutId = React.useId();

  const handleValueChange = React.useCallback(
    (value: unknown) => {
      const next = (value ?? null) as string | null;
      if (!isControlled) setInternal(next);
      if (typeof next === "string") onValueChange?.(next);
    },
    [isControlled, onValueChange],
  );

  const ctx = React.useMemo<TabsContextValue>(
    () => ({ variant, size, activeValue, layoutId }),
    [variant, size, activeValue, layoutId],
  );

  return (
    <TabsContext.Provider value={ctx}>
      <BaseTabs.Root data-wensity-primitive=""
        ref={ref}
        value={activeValue as never}
        defaultValue={defaultValue as never}
        onValueChange={handleValueChange}
        orientation={variant === "vertical" ? "vertical" : "horizontal"}
        data-variant={variant}
        className={cn(
          variant === "vertical" ? "flex gap-4" : "flex flex-col",
          className,
        )}
        {...props}
      >
        <LayoutGroup id={layoutId}>{children}</LayoutGroup>
      </BaseTabs.Root>
    </TabsContext.Provider>
  );
});

/* ─── <TabsList> ────────────────────────────────────────────── */

export const TabsList = React.forwardRef<HTMLDivElement, TabsListProps>(
  function TabsList({ className, children, ...props }, ref) {
    const { variant, size } = useTabsContext();
    return (
      <BaseTabs.List
        ref={ref}
        data-variant={variant}
        className={cn(
          "inline-flex items-center",
          listGaps[size],
          listVariantClasses[variant],
          variant === "vertical" && "min-w-[140px]",
          className,
        )}
        {...props}
      >
        {children}
      </BaseTabs.List>
    );
  },
);

/* ─── <TabsTrigger> ─────────────────────────────────────────── */

function TabIndicator({
  layoutKey,
  layoutId,
  className,
  style,
}: {
  layoutKey: string;
  layoutId: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  const prefersReducedMotion = useReducedMotion();
  if (prefersReducedMotion) {
    return <span aria-hidden="true" className={className} style={style} />;
  }
  return (
    <motion.span
      aria-hidden="true"
      layoutId={`${layoutKey}-${layoutId}`}
      transition={indicatorSpring}
      className={className}
      style={style}
    />
  );
}

export const TabsTrigger = React.forwardRef<
  HTMLButtonElement,
  TabsTriggerProps
>(function TabsTrigger({ value, className, children, ...props }, ref) {
  const { variant, size, activeValue, layoutId } = useTabsContext();
  const isActive = activeValue === value;

  return (
    <BaseTabs.Tab
      ref={ref}
      value={value}
      data-variant={variant}
      className={cn(
        triggerBase,
        triggerSizes[size],
        triggerVariantClasses(variant, isActive),
        !isActive && hoverClasses[variant],
        className,
      )}
      {...props}
    >
      {children}

      {variant === "default" && isActive && (
        <TabIndicator
          layoutKey="tabs-default-pill"
          layoutId={layoutId}
          className={cn(
            "absolute inset-0 rounded-[var(--primitive-radius-item)]",
            "bg-[var(--primitive-surface-selected)]",
            "border border-[var(--border)]",
          )}
          style={{ zIndex: -1 }}
        />
      )}

      {variant === "underline" && isActive && (
        <TabIndicator
          layoutKey="tabs-underline"
          layoutId={layoutId}
          className="absolute inset-x-0 -bottom-px h-[2px] bg-[var(--foreground)]"
          style={{ borderRadius: 1 }}
        />
      )}

      {variant === "pills" && isActive && (
        <TabIndicator
          layoutKey="tabs-pill"
          layoutId={layoutId}
          className={cn(
            "absolute inset-0 rounded-full",
            "bg-[var(--primitive-surface-selected)]",
            "border border-[var(--border)]",
          )}
          style={{ zIndex: -1 }}
        />
      )}

      {variant === "segmented" && isActive && (
        <TabIndicator
          layoutKey="tabs-segment"
          layoutId={layoutId}
          className={cn(
            "absolute inset-0 rounded-[var(--primitive-radius-item)]",
            "bg-[var(--primitive-surface-elevated)]",
            "border border-[var(--border)]",
            "[box-shadow:var(--primitive-shadow-raised)]",
          )}
          style={{ zIndex: -1 }}
        />
      )}

      {variant === "vertical" && isActive && (
        <TabIndicator
          layoutKey="tabs-vertical-bar"
          layoutId={layoutId}
          className="absolute -left-px top-1 bottom-1 w-[2px] rounded-full bg-[var(--foreground)]"
        />
      )}
    </BaseTabs.Tab>
  );
});

/* ─── <TabsContent> ─────────────────────────────────────────── */

export const TabsContent = React.forwardRef<HTMLDivElement, TabsContentProps>(
  function TabsContent({ className, ...props }, ref) {
    return (
      <BaseTabs.Panel
        ref={ref}
        className={cn(
          "flex-1 outline-none",
          "focus-visible:ring-2 focus-visible:ring-[var(--primitive-ring)] focus-visible:ring-offset-2",
          "transition-opacity duration-150 ease-[var(--primitive-ease,cubic-bezier(0.23,1,0.32,1))]",
          "data-[starting-style]:opacity-0 data-[ending-style]:opacity-0",
          "motion-reduce:transition-none",
          className,
        )}
        {...props}
      />
    );
  },
);
