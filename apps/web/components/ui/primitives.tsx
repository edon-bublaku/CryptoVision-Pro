"use client";

import { X } from "lucide-react";
import { forwardRef, useEffect, useId, type ButtonHTMLAttributes, type HTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "bull" | "bear";

export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "xs" | "sm" | "md"; active?: boolean }>(
  function Button({ className, variant = "secondary", size = "sm", active, ...props }, ref) {
    return (
      <button
        ref={ref}
        className={cn(
          "inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-all duration-150 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 whitespace-nowrap",
          size === "xs" && "h-7 px-2.5 text-xs",
          size === "sm" && "h-8 px-3 text-sm",
          size === "md" && "h-10 px-4 text-sm",
          variant === "primary" && "brand-gradient text-[#060911] font-semibold shadow-[0_6px_20px_-8px_rgba(123,140,255,0.8)] hover:brightness-110 hover:shadow-[0_8px_28px_-6px_rgba(123,140,255,0.9)]",
          variant === "secondary" && "border border-line bg-panel-2 text-fg hover:border-line-strong hover:bg-[color-mix(in_oklab,var(--fg)_7%,transparent)]",
          variant === "ghost" && "text-muted hover:bg-panel-2 hover:text-fg",
          variant === "danger" && "bg-bear text-(--on-bear) hover:brightness-110",
          variant === "bull" && "bg-bull text-(--on-bull) hover:brightness-110",
          variant === "bear" && "bg-bear text-(--on-bear) hover:brightness-110",
          active && "border-accent bg-accent-soft text-accent",
          className,
        )}
        {...props}
      />
    );
  },
);

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("glass shadow-card min-w-0 rounded-2xl border border-line", className)} {...props} />;
}

export function CardHeader({ title, subtitle, right, className }: { title: ReactNode; subtitle?: ReactNode; right?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-wrap items-start justify-between gap-x-3 gap-y-2 border-b border-line px-5 py-3.5", className)}>
      <div className="min-w-0">
        <h3 className="truncate text-sm font-semibold text-fg">{title}</h3>
        {subtitle && <p className="mt-0.5 text-xs text-muted">{subtitle}</p>}
      </div>
      {right}
    </div>
  );
}

export function Badge({ className, tone = "neutral", ...props }: HTMLAttributes<HTMLSpanElement> & { tone?: "neutral" | "bull" | "bear" | "accent" | "warn" }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide",
        tone === "neutral" && "bg-panel-2 text-muted",
        tone === "bull" && "bg-bull-soft text-bull",
        tone === "bear" && "bg-bear-soft text-bear",
        tone === "accent" && "bg-accent-soft text-accent",
        tone === "warn" && "bg-warn-soft text-warn",
        className,
      )}
      {...props}
    />
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...props }, ref) {
  return (
    <input
      ref={ref}
      className={cn("h-9 w-full rounded-lg border border-line bg-panel-2 px-3 text-sm text-fg transition-colors placeholder:text-faint focus:border-accent focus:bg-[color-mix(in_oklab,var(--accent)_6%,transparent)] focus:outline-none", className)}
      {...props}
    />
  );
});

export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cn("h-9 rounded-lg border border-line bg-panel-solid px-2.5 text-sm text-fg focus:border-accent focus:outline-none", className)} {...props}>
      {children}
    </select>
  );
}

/**
 * Labelled form control. Use `group` for composite controls (Segmented, button rows): a <label>
 * around several buttons would give the first one the whole group's text as its name.
 */
export function Field({ label, children, hint, className, group }: { label: ReactNode; children: ReactNode; hint?: ReactNode; className?: string; group?: boolean }) {
  const Tag = group ? "div" : "label";
  return (
    <Tag className={cn("flex flex-col gap-1", className)} {...(group ? { role: "group", "aria-label": typeof label === "string" ? label : undefined } : {})}>
      <span className="text-xs font-medium text-muted">{label}</span>
      {children}
      {hint && <span className="text-[11px] text-faint">{hint}</span>}
    </Tag>
  );
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode }) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-fg select-none">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cn("relative h-5 w-9 rounded-full transition-colors", checked ? "bg-accent" : "bg-line-strong")}
      >
        <span className={cn("absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all", checked ? "left-[18px]" : "left-0.5")} />
      </button>
      {label}
    </label>
  );
}

export function Segmented<T extends string | number>({ value, options, onChange, size = "sm", className }: { value: T; options: { value: T; label: ReactNode; title?: string }[]; onChange: (v: T) => void; size?: "xs" | "sm"; className?: string }) {
  return (
    <div className={cn("inline-flex rounded-lg border border-line bg-panel-2 p-0.5", className)} role="radiogroup">
      {options.map((o) => (
        <button
          key={String(o.value)}
          role="radio"
          aria-checked={o.value === value}
          title={o.title}
          onClick={() => onChange(o.value)}
          className={cn(
            "rounded-md px-2.5 font-medium transition-all",
            size === "xs" ? "h-6 text-xs" : "h-7 text-xs",
            o.value === value ? "bg-[color-mix(in_oklab,var(--accent)_22%,transparent)] text-fg shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--accent)_45%,transparent)]" : "text-muted hover:text-fg",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("skeleton", className)} />;
}

export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; wide?: boolean }) {
  const titleId = useId();
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 backdrop-blur-sm sm:items-center sm:p-4" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={cn("animate-fade-up max-h-[92vh] w-full overflow-auto rounded-t-3xl border border-line bg-panel-solid shadow-2xl sm:rounded-3xl", wide ? "sm:max-w-3xl" : "sm:max-w-lg")}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-line bg-panel-solid px-6 py-4">
          <h2 id={titleId} className="text-base font-semibold">
            {title}
          </h2>
          <button onClick={onClose} className="rounded p-1 text-muted hover:bg-panel-2 hover:text-fg" aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

export function Empty({ icon, title, children }: { icon?: ReactNode; title: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
      {icon && <div className="text-faint">{icon}</div>}
      <p className="text-sm font-medium text-fg">{title}</p>
      {children && <div className="max-w-sm text-xs text-muted">{children}</div>}
    </div>
  );
}

export function Stat({ label, value, sub, tone }: { label: ReactNode; value: ReactNode; sub?: ReactNode; tone?: "bull" | "bear" | "neutral" }) {
  return (
    <div className="min-w-0">
      <div className="truncate text-[11px] font-medium uppercase tracking-wide text-muted">{label}</div>
      <div className={cn("num mt-1 truncate text-xl font-semibold tracking-tight", tone === "bull" && "text-bull", tone === "bear" && "text-bear")}>{value}</div>
      {sub && <div className="num truncate text-xs text-muted">{sub}</div>}
    </div>
  );
}

/** Consistent page header: gradient icon chip, title, subtitle and actions. */
export function PageHeader({ icon, title, subtitle, actions }: { icon: ReactNode; title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="animate-fade-up flex flex-wrap items-end justify-between gap-4">
      <div className="flex items-center gap-3.5">
        <div className="brand-gradient flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-[#060911] shadow-[0_10px_30px_-10px_rgba(123,140,255,0.9)]">{icon}</div>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {subtitle && <p className="mt-0.5 max-w-2xl text-sm text-muted">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
