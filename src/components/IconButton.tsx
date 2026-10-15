import type { ReactNode } from "react";

/** Square 36px icon button (a comfortable touch target on phones). */
export function IconBtn({
  label,
  onClick,
  children,
  danger,
  active,
  disabled,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
  danger?: boolean;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={`h-9 w-9 grid place-items-center rounded-lg transition-colors disabled:opacity-30 disabled:pointer-events-none ${danger ? "text-destructive hover:bg-destructive/15" : "text-primary hover:bg-primary/15"} ${active ? "bg-primary/15" : ""}`}
    >
      {children}
    </button>
  );
}
