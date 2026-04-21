"use client";

import * as React from "react";
import { Toast as ToastPrimitive } from "@base-ui/react/toast";

import { cn } from "@/lib/utils";

// Phase 7 (multi-user-tracking-k8s-brand): minimal toast primitive on top
// of @base-ui/react/toast. Consumed by components/tracker/join-detector.tsx
// for collaborator-joined notifications; shaped so any future transient
// notification can drop in without more primitives.
//
// Brand rule (DESIGN.md §2): the persimmon accent appears as a 2px left
// edge on the toast card. Nowhere else on this surface — no accent fill,
// no accent ring, no accent text. The left edge is the sole brand anchor.

const DEFAULT_TIMEOUT_MS = 4000;

function ToastProvider({ children, ...rest }: ToastPrimitive.Provider.Props) {
  return (
    <ToastPrimitive.Provider timeout={DEFAULT_TIMEOUT_MS} {...rest}>
      {children}
    </ToastPrimitive.Provider>
  );
}

function ToastViewport({
  className,
  ...props
}: ToastPrimitive.Viewport.Props) {
  return (
    <ToastPrimitive.Portal>
      <ToastPrimitive.Viewport
        data-slot="toast-viewport"
        className={cn(
          "pointer-events-none fixed right-4 bottom-[calc(env(safe-area-inset-bottom)+1rem)] z-50 flex w-[calc(100vw-2rem)] max-w-sm flex-col gap-2 outline-none sm:right-6 sm:bottom-6",
          className,
        )}
        {...props}
      >
        <ToastList />
      </ToastPrimitive.Viewport>
    </ToastPrimitive.Portal>
  );
}

// Internal: reads the manager state and renders each toast with the
// default (title + optional description + close) shape. Kept private so
// the public surface is the Provider/Viewport pair; customization lives
// in a new component if/when a second toast shape is needed.
function ToastList() {
  const { toasts } = ToastPrimitive.useToastManager();
  return (
    <>
      {toasts.map((toast) => (
        <Toast key={toast.id} toast={toast}>
          {toast.title ? <ToastTitle>{toast.title}</ToastTitle> : null}
          {toast.description ? (
            <ToastDescription>{toast.description}</ToastDescription>
          ) : null}
          <ToastClose />
        </Toast>
      ))}
    </>
  );
}

function Toast({
  className,
  children,
  toast,
  ...props
}: ToastPrimitive.Root.Props) {
  // `toast` is required by base-ui (ToastRootProps.toast). Destructured
  // explicitly so it surfaces as a required prop at this wrapper's
  // signature rather than silently traveling through `...props`.
  //
  // Enter/exit motion (220ms / 160ms) is applied via data-attribute
  // selectors in app/globals.css — `[data-slot="toast"][data-starting-style]`
  // and `[data-slot="toast"][data-ending-style]` — not Tailwind modifiers,
  // because custom CSS classes don't compose with `data-[...]:` prefixes
  // in Tailwind v4 (only registered utilities do).
  return (
    <ToastPrimitive.Root
      toast={toast}
      data-slot="toast"
      className={cn(
        "pointer-events-auto relative flex w-full items-start gap-3 overflow-hidden rounded-[20px] border border-border border-l-2 border-l-[color:var(--accent)] bg-popover p-4 text-popover-foreground outline-none",
        className,
      )}
      {...props}
    >
      {children}
    </ToastPrimitive.Root>
  );
}

function ToastTitle({ className, ...props }: ToastPrimitive.Title.Props) {
  return (
    <ToastPrimitive.Title
      data-slot="toast-title"
      className={cn(
        "text-sm font-medium tracking-[0.01em] text-foreground",
        className,
      )}
      {...props}
    />
  );
}

function ToastDescription({
  className,
  ...props
}: ToastPrimitive.Description.Props) {
  return (
    <ToastPrimitive.Description
      data-slot="toast-description"
      className={cn(
        "text-sm tracking-[0.01em] text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

function ToastClose({ className, ...props }: ToastPrimitive.Close.Props) {
  return (
    <ToastPrimitive.Close
      data-slot="toast-close"
      aria-label="Dismiss"
      className={cn(
        "ml-auto inline-flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-muted-foreground outline-none transition-colors hover:bg-secondary hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
      {...props}
    >
      <span aria-hidden className="text-base leading-none">
        ×
      </span>
    </ToastPrimitive.Close>
  );
}

const useToastManager = ToastPrimitive.useToastManager;

export {
  Toast,
  ToastProvider,
  ToastViewport,
  ToastTitle,
  ToastDescription,
  ToastClose,
  useToastManager,
};
