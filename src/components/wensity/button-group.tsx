"use client";

import * as React from "react";
import { Menu } from "@base-ui/react/menu";
import { cn } from "@/lib/utils";
import { Button, buttonVariants, type ButtonProps } from "@/components/wensity/button";

export interface ButtonGroupProps extends React.HTMLAttributes<HTMLDivElement> {
  orientation?: "horizontal" | "vertical";
}

export function ButtonGroup({
  className,
  orientation = "horizontal",
  ...props
}: ButtonGroupProps) {
  return (
    <div
      role="group"
      data-orientation={orientation}
      className={cn(
        // Shared shell only — hover/press belong on each segment, not the group.
        "group/button-group relative inline-flex shrink-0 overflow-hidden rounded-[var(--primitive-radius-control)] border border-[var(--border-strong)] bg-transparent",
        orientation === "horizontal" ? "flex-row items-stretch" : "flex-col",
        className,
      )}
      {...props}
    />
  );
}

const groupItemClass =
  "rounded-none border-0 shadow-none min-h-9 " +
  "group-data-[orientation=horizontal]/button-group:first:rounded-l-[calc(var(--primitive-radius-control)_-_1px)] " +
  "group-data-[orientation=horizontal]/button-group:last:rounded-r-[calc(var(--primitive-radius-control)_-_1px)] " +
  "group-data-[orientation=vertical]/button-group:first:rounded-t-[calc(var(--primitive-radius-control)_-_1px)] " +
  "group-data-[orientation=vertical]/button-group:last:rounded-b-[calc(var(--primitive-radius-control)_-_1px)] " +
  "focus-visible:relative focus-visible:z-10 hover:relative hover:z-10";

const groupIconItemClass =
  "h-9 w-10 min-w-10 shrink-0 px-0 text-[var(--foreground)] " +
  "[&_svg]:!size-4 [&_svg]:!opacity-100 [&_svg]:stroke-current";

export type ButtonGroupItemProps = ButtonProps;

export const ButtonGroupItem = React.forwardRef<
  HTMLButtonElement,
  ButtonGroupItemProps
>(({ className, variant = "outline", size, ...props }, ref) => {
  return (
    <Button
      ref={ref}
      variant={variant}
      size={size}
      className={cn(
        groupItemClass,
        size === "icon" && groupIconItemClass,
        className,
      )}
      {...props}
    />
  );
});

ButtonGroupItem.displayName = "ButtonGroupItem";

export interface ButtonGroupSeparatorProps
  extends React.HTMLAttributes<HTMLDivElement> {
  orientation?: "horizontal" | "vertical";
}

export function ButtonGroupSeparator({
  className,
  orientation = "vertical",
  ...props
}: ButtonGroupSeparatorProps) {
  return (
    <div
      role="separator"
      aria-orientation={orientation}
      className={cn(
        "shrink-0 bg-[var(--border-strong)]",
        orientation === "vertical" ? "w-px self-stretch" : "h-px w-full",
        className,
      )}
      {...props}
    />
  );
}

const elevatedOverlaySurfaceClass = cn(
  "bg-[var(--primitive-surface-overlay)] border border-[var(--border)]",
  "[box-shadow:var(--primitive-shadow-overlay)]",
);

export type ButtonGroupMenuProps = React.ComponentProps<typeof Menu.Root>;

export function ButtonGroupMenu(props: ButtonGroupMenuProps) {
  return <Menu.Root modal={false} {...props} />;
}

const menuTriggerClass =
  "data-[popup-open]:z-20 data-[popup-open]:bg-[var(--primitive-surface-hover)]";

export const ButtonGroupMenuTrigger = React.forwardRef<
  HTMLButtonElement,
  ButtonGroupItemProps
>(
  (
    {
      className,
      variant = "outline",
      size = "icon",
      loading = false,
      disabled = false,
      leftIcon,
      rightIcon,
      leftIconMotion: _leftIconMotion,
      rightIconMotion: _rightIconMotion,
      asChild: _asChild,
      focusableWhenDisabled: _focusableWhenDisabled,
      type,
      children,
      ...props
    },
    ref,
  ) => {
    const isDisabled = disabled || loading;

    return (
      <Menu.Trigger
        ref={ref}
        nativeButton
        disabled={isDisabled}
        type={type ?? "button"}
        aria-busy={loading ? true : undefined}
        data-loading={loading ? "" : undefined}
        className={cn(
          buttonVariants({ variant, size }),
          groupItemClass,
          size === "icon" && groupIconItemClass,
          menuTriggerClass,
          className,
        )}
        {...props}
      >
        {loading ? (
          <span
            aria-hidden="true"
            className="relative z-10 size-3.5 shrink-0 rounded-full border-2 border-current border-r-transparent opacity-80 motion-safe:animate-spin"
          />
        ) : null}
        {!loading && leftIcon ? (
          <span className="relative z-10 inline-flex shrink-0">{leftIcon}</span>
        ) : null}
        {size === "icon" && !loading && !leftIcon && !rightIcon ? (
          <span className="relative z-10 inline-flex shrink-0 items-center justify-center">
            {children}
          </span>
        ) : (
          <span className="relative z-10 inline-flex items-center gap-2">
            {children}
          </span>
        )}
        {!loading && rightIcon ? (
          <span className="relative z-10 inline-flex shrink-0">
            {rightIcon}
          </span>
        ) : null}
      </Menu.Trigger>
    );
  },
);

ButtonGroupMenuTrigger.displayName = "ButtonGroupMenuTrigger";

export interface ButtonGroupMenuContentProps
  extends Omit<
    React.ComponentPropsWithoutRef<typeof Menu.Popup>,
    "align" | "sideOffset"
  > {
  align?: "start" | "center" | "end";
  sideOffset?: number;
  side?: "top" | "right" | "bottom" | "left";
  container?: React.ComponentProps<typeof Menu.Portal>["container"];
}

export function ButtonGroupMenuContent({
  className,
  align = "end",
  sideOffset = 8,
  side,
  container,
  ...props
}: ButtonGroupMenuContentProps) {
  return (
    <Menu.Portal container={container}>
      <Menu.Positioner
        align={align}
        sideOffset={sideOffset}
        side={side}
        collisionPadding={12}
        className="z-[var(--primitive-z-popover)] outline-none"
      >
        <Menu.Popup
          data-wensity-primitive=""
          className={cn(
            elevatedOverlaySurfaceClass,
            "min-w-[12.5rem] origin-top-right rounded-[var(--primitive-radius-surface)] p-1 outline-none",
            "transition-[opacity,transform] duration-150 ease-[var(--primitive-ease,cubic-bezier(0.23,1,0.32,1))]",
            "data-[starting-style]:opacity-0 data-[ending-style]:opacity-0",
            "motion-reduce:transition-none",
            className,
          )}
          {...props}
        />
      </Menu.Positioner>
    </Menu.Portal>
  );
}

export interface ButtonGroupMenuItemProps
  extends React.ComponentPropsWithoutRef<typeof Menu.Item> {
  icon?: React.ReactNode;
  destructive?: boolean;
  shortcut?: string;
}

export const ButtonGroupMenuItem = React.forwardRef<
  HTMLDivElement,
  ButtonGroupMenuItemProps
>(
  (
    { className, children, icon, destructive = false, shortcut, ...props },
    ref,
  ) => {
    return (
      <Menu.Item
        ref={ref as React.Ref<HTMLElement>}
        className={cn(
          "group/menu-item relative flex cursor-pointer select-none items-center gap-2.5 rounded-[var(--primitive-radius-item)] px-2.5 py-2 text-sm outline-none",
          "transition-colors duration-150",
          destructive
            ? "text-[var(--primitive-destructive)] data-highlighted:bg-[var(--primitive-destructive-surface)] data-highlighted:text-[var(--primitive-destructive)]"
            : "text-[var(--foreground)] data-highlighted:bg-[var(--primitive-surface-selected)]",
          "data-disabled:pointer-events-none data-disabled:opacity-45",
          className,
        )}
        {...props}
      >
        {icon ? (
          <span
            className={cn(
              "inline-flex size-4 shrink-0 items-center justify-center [&_svg]:size-4",
              destructive
                ? "text-[var(--primitive-destructive)]"
                : "text-[var(--muted-foreground)] group-data-highlighted/menu-item:text-[var(--foreground)]",
            )}
          >
            {icon}
          </span>
        ) : null}
        <span className="min-w-0 flex-1 truncate">{children}</span>
        {shortcut ? (
          <span className="ml-auto shrink-0 text-[11px] tabular-nums text-[var(--muted-foreground)]">
            {shortcut}
          </span>
        ) : null}
      </Menu.Item>
    );
  },
);

ButtonGroupMenuItem.displayName = "ButtonGroupMenuItem";

export type ButtonGroupMenuSeparatorProps =
  React.HTMLAttributes<HTMLDivElement>;

export function ButtonGroupMenuSeparator({
  className,
  ...props
}: ButtonGroupMenuSeparatorProps) {
  return (
    <div
      role="separator"
      className={cn("my-1 h-px bg-[var(--border)]", className)}
      {...props}
    />
  );
}

export type ButtonGroupMenuLabelProps = React.HTMLAttributes<HTMLDivElement>;

export function ButtonGroupMenuLabel({
  className,
  ...props
}: ButtonGroupMenuLabelProps) {
  return (
    <div
      className={cn(
        "px-2.5 py-1.5 text-[11px] font-medium uppercase text-[var(--muted-foreground)]",
        className,
      )}
      {...props}
    />
  );
}
