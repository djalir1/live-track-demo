// Small building blocks shared by the school, attendant and parent screens.
import type { ComponentType, ReactNode } from "react";
import { Construction, Database, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { STATUS_META, TONE_CLASS, type RiderStatus, type Tone } from "@/lib/attendance";
import { initials, MIGRATION_HINT } from "@/lib/school";

export function Pill({
  tone,
  children,
  className,
}: {
  tone: Tone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap",
        TONE_CLASS[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function StatusPill({ status, className }: { status: RiderStatus; className?: string }) {
  const m = STATUS_META[status];
  return (
    <Pill tone={m.tone} className={className}>
      {m.label}
    </Pill>
  );
}

export function StudentAvatar({
  name,
  photo,
  size = 40,
  className,
}: {
  name: string;
  photo?: string | null;
  size?: number;
  className?: string;
}) {
  const hue = [...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
  return photo ? (
    <img
      src={photo}
      alt={name}
      width={size}
      height={size}
      className={cn("rounded-full object-cover shrink-0 bg-muted", className)}
      style={{ width: size, height: size }}
      loading="lazy"
    />
  ) : (
    <div
      aria-hidden
      className={cn(
        "rounded-full grid place-items-center shrink-0 font-semibold text-white",
        className,
      )}
      style={{
        width: size,
        height: size,
        fontSize: Math.max(11, size * 0.36),
        background: `linear-gradient(135deg, oklch(0.62 0.15 ${hue}), oklch(0.5 0.17 ${(hue + 40) % 360}))`,
      }}
    >
      {initials(name)}
    </div>
  );
}

export function StatCard({
  label,
  value,
  hint,
  Icon,
  tone = "neutral",
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  Icon?: ComponentType<{ className?: string }>;
  tone?: Tone;
}) {
  const ring: Record<Tone, string> = {
    neutral: "text-foreground bg-secondary",
    success: "text-success bg-success/12",
    info: "text-primary bg-primary/12",
    muted: "text-muted-foreground bg-muted",
    warning: "text-warning bg-warning/12",
    danger: "text-destructive bg-destructive/12",
  };
  return (
    <div className="rounded-2xl border border-border bg-card p-4 sm:p-5 shadow-soft">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        {Icon && (
          <span className={cn("h-8 w-8 rounded-lg grid place-items-center", ring[tone])}>
            <Icon className="h-4 w-4" />
          </span>
        )}
      </div>
      <div className="mt-2 font-display text-2xl sm:text-3xl font-bold tabular-nums">{value}</div>
      {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}

export function Panel({
  title,
  description,
  actions,
  children,
  className,
  bodyClassName,
}: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={cn("rounded-2xl border border-border bg-card shadow-soft", className)}>
      {(title || actions) && (
        <header className="flex items-start justify-between gap-3 px-4 sm:px-5 pt-4 sm:pt-5">
          <div className="min-w-0">
            {title && <h2 className="font-display font-semibold">{title}</h2>}
            {description && <p className="text-xs text-muted-foreground mt-0.5">{description}</p>}
          </div>
          {actions && <div className="flex gap-2 shrink-0">{actions}</div>}
        </header>
      )}
      <div className={cn("p-4 sm:p-5", bodyClassName)}>{children}</div>
    </section>
  );
}

export function EmptyState({
  Icon,
  title,
  children,
  action,
}: {
  Icon: ComponentType<{ className?: string }>;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="text-center py-10 px-4">
      <div className="mx-auto h-12 w-12 rounded-2xl bg-primary/10 text-primary grid place-items-center">
        <Icon className="h-6 w-6" />
      </div>
      <h3 className="mt-3 font-semibold">{title}</h3>
      {children && (
        <p className="mt-1 text-sm text-muted-foreground max-w-sm mx-auto">{children}</p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="py-16 grid place-items-center text-muted-foreground">
      <div className="flex items-center gap-2 text-sm">
        <Loader2 className="h-4 w-4 animate-spin text-primary" /> {label}
      </div>
    </div>
  );
}

export function UnderConstruction({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-2xl border border-warning/40 bg-warning/10 p-4 flex gap-3">
      <Construction className="h-5 w-5 text-warning shrink-0 mt-0.5" />
      <div className="text-sm">
        <div className="font-semibold">
          {title}{" "}
          <span className="ml-1 text-[10px] uppercase tracking-wide rounded px-1.5 py-0.5 bg-warning/20 text-warning">
            Under construction
          </span>
        </div>
        {children && <div className="text-muted-foreground mt-1">{children}</div>}
      </div>
    </div>
  );
}

/** Shown when the staging database doesn't have the attendance tables yet. */
export function MigrationNotice() {
  return (
    <div className="rounded-2xl border border-border bg-card p-5 flex gap-3">
      <Database className="h-5 w-5 text-primary shrink-0 mt-0.5" />
      <div className="text-sm">
        <div className="font-semibold">Database not set up for attendance</div>
        <p className="text-muted-foreground mt-1">{MIGRATION_HINT}</p>
      </div>
    </div>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-muted-foreground">{hint}</span>}
    </label>
  );
}

/** Native select styled like the inputs (fast on phones, no portal). */
export function NativeSelect({
  value,
  onChange,
  children,
  className,
  ...rest
}: {
  value: string;
  onChange: (v: string) => void;
  children: ReactNode;
  className?: string;
} & Omit<React.SelectHTMLAttributes<HTMLSelectElement>, "value" | "onChange">) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={cn(
        "h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
      {...rest}
    >
      {children}
    </select>
  );
}
