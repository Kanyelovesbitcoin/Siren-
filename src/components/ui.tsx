"use client";

import { forwardRef, useState } from "react";
import { Check, Copy, LoaderCircle } from "lucide-react";
import type { Severity, Verdict } from "@/lib/types";

export function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(" ");
}

export function Card({
  title,
  icon,
  action,
  children,
  className,
}: {
  title?: React.ReactNode;
  icon?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cx("rounded-2xl border border-line bg-charcoal shadow-[0_1px_0_rgb(255_255_255/0.03)_inset]", className)}>
      {title && (
        <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-line px-5 py-3.5">
          <h2 className="flex items-center gap-2 text-[13px] font-semibold tracking-wide text-ink uppercase">
            {icon && <span className="text-gold">{icon}</span>}
            {title}
          </h2>
          {action}
        </header>
      )}
      <div className="p-5">{children}</div>
    </section>
  );
}

export function Label({ children, hint, htmlFor }: { children: React.ReactNode; hint?: React.ReactNode; htmlFor?: string }) {
  return (
    <div className="mb-1.5 flex items-baseline justify-between gap-2">
      <label htmlFor={htmlFor} className="text-xs font-medium text-ink-dim">
        {children}
      </label>
      {hint && <span className="text-[11px] text-muted">{hint}</span>}
    </div>
  );
}

const fieldBase =
  "rounded-lg border border-field bg-obsidian px-3 py-2 text-sm text-ink placeholder:text-muted transition focus:border-gold focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-gold disabled:opacity-50";

export const Input = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }>(
  function Input({ className, invalid, ...props }, ref) {
    return (
      <input
        ref={ref}
        className={cx(fieldBase, "w-full min-w-0", invalid && "border-fail focus:border-fail", className)}
        aria-invalid={invalid || undefined}
        {...props}
      />
    );
  },
);

export function TextArea({
  className,
  invalid,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }) {
  return (
    <textarea
      className={cx(fieldBase, "w-full font-mono text-[12.5px] leading-relaxed scroll-quiet", invalid && "border-fail", className)}
      aria-invalid={invalid || undefined}
      spellCheck={false}
      {...props}
    />
  );
}

export function Select({ className, children, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cx(fieldBase, "cursor-pointer", className ?? "w-full")} {...props}>
      {children}
    </select>
  );
}

type ButtonVariant = "gold" | "ghost" | "outline" | "danger";

export function Button({
  variant = "outline",
  loading,
  icon,
  className,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; loading?: boolean; icon?: React.ReactNode }) {
  const styles: Record<ButtonVariant, string> = {
    gold: "gold-liquid text-[#1a1406] font-semibold",
    outline: "border border-line-strong bg-charcoal-2 text-ink hover:border-gold/50 hover:text-gold-bright",
    ghost: "text-ink-dim hover:text-ink hover:bg-charcoal-3",
    danger: "border border-fail/40 bg-fail/10 text-fail hover:bg-fail/20",
  };
  return (
    <button
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-lg px-3.5 py-2 text-sm transition disabled:cursor-not-allowed disabled:opacity-45 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold",
        styles[variant],
        className,
      )}
      {...props}
    >
      {loading ? <LoaderCircle className="size-4 animate-spin" /> : icon}
      {children}
    </button>
  );
}

const VERDICT_STYLE: Record<Verdict | "running", { label: string; cls: string; dot: string }> = {
  pass: { label: "Pass", cls: "border-pass/35 bg-pass/10 text-pass", dot: "bg-pass" },
  warn: { label: "Warn", cls: "border-warn/35 bg-warn/10 text-warn", dot: "bg-warn" },
  fail: { label: "Fail", cls: "border-fail/40 bg-fail/10 text-fail", dot: "bg-fail" },
  error: { label: "Error", cls: "border-err/35 bg-err/10 text-err", dot: "bg-err" },
  running: { label: "Running", cls: "border-gold/40 bg-gold/10 text-gold", dot: "bg-gold siren-pulse" },
};

export function VerdictBadge({ verdict }: { verdict: Verdict | "running" }) {
  const v = VERDICT_STYLE[verdict];
  return (
    <span className={cx("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold tracking-wide uppercase", v.cls)}>
      <span className={cx("size-1.5 rounded-full", v.dot)} />
      {v.label}
    </span>
  );
}

const SEVERITY_STYLE: Record<Severity, string> = {
  low: "text-ink-dim border-line-strong",
  medium: "text-warn border-warn/30",
  high: "text-fail border-fail/40",
  critical: "text-fail border-fail/60 bg-fail/10",
};

export function SeverityChip({ severity }: { severity: Severity }) {
  return (
    <span className={cx("rounded-md border px-1.5 py-px text-[10px] font-semibold tracking-wider uppercase", SEVERITY_STYLE[severity])}>
      {severity}
    </span>
  );
}

export function Chip({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={cx("rounded-md border border-line-strong bg-charcoal-2 px-1.5 py-px font-mono text-[10.5px] text-ink-dim", className)}>
      {children}
    </span>
  );
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fallback for non-secure contexts (e.g. 0.0.0.0 in some browsers).
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  }
}

export function CopyButton({
  text,
  label = "Copy",
  variant = "outline",
  className,
}: {
  text: string;
  label?: string;
  variant?: ButtonVariant;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <>
      <Button
        variant={variant}
        className={className}
        icon={copied ? <Check className="size-4" /> : <Copy className="size-4" />}
        onClick={async () => {
          if (await copyText(text)) {
            setCopied(true);
            setTimeout(() => setCopied(false), 1800);
          }
        }}
      >
        {copied ? "Copied!" : label}
      </Button>
      {/* Tell screen reader users the copy worked; the visual change alone is silent. */}
      <span role="status" className="sr-only">
        {copied ? "Copied to clipboard" : ""}
      </span>
    </>
  );
}
