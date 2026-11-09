import * as React from "react";
import * as SelectPrimitive from "@radix-ui/react-select";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

// A drop-in replacement for <select>: same <option> children, but a custom
// list that matches the app (no browser-blue highlight). Keyboard, typeahead,
// screen readers and phones are handled by Radix Select.
//
//   <PrettySelect value={v} onChange={setV}>
//     <option value="">None</option>
//     <option value="a">Bus A</option>
//   </PrettySelect>

const EMPTY = "__empty__"; // Radix doesn't allow "" as an item value

interface Opt {
  value: string;
  label: string;
  disabled?: boolean;
}

function textOf(node: React.ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (React.isValidElement<{ children?: React.ReactNode }>(node))
    return textOf(node.props.children);
  return "";
}

function collect(children: React.ReactNode, out: Opt[] = []): Opt[] {
  React.Children.forEach(children, (child) => {
    if (
      !React.isValidElement<{
        value?: string | number;
        children?: React.ReactNode;
        disabled?: boolean;
      }>(child)
    )
      return;
    if (child.type === "option") {
      const label = textOf(child.props.children);
      out.push({
        value: child.props.value != null ? String(child.props.value) : label,
        label,
        disabled: child.props.disabled,
      });
    } else if (child.type === React.Fragment) {
      collect(child.props.children, out);
    }
  });
  return out;
}

export interface PrettySelectProps {
  value: string;
  onChange: (value: string) => void;
  children: React.ReactNode;
  className?: string;
  disabled?: boolean;
  id?: string;
  placeholder?: string;
  "aria-label"?: string;
  /** Smaller trigger for dense toolbars. */
  size?: "sm" | "md";
}

export function PrettySelect({
  value,
  onChange,
  children,
  className,
  disabled,
  id,
  placeholder = "Choose…",
  size = "md",
  ...rest
}: PrettySelectProps) {
  const options = collect(children);
  const current = options.find((o) => o.value === value);
  return (
    <SelectPrimitive.Root
      value={value === "" ? EMPTY : value}
      onValueChange={(v) => onChange(v === EMPTY ? "" : v)}
      disabled={disabled}
    >
      <SelectPrimitive.Trigger
        id={id}
        aria-label={rest["aria-label"]}
        className={cn(
          "group inline-flex w-full items-center justify-between gap-2 rounded-lg border border-input bg-background/60 px-3 text-left text-sm",
          "transition-colors hover:border-primary/40 hover:bg-accent/40",
          "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 data-[state=open]:border-primary/60",
          "disabled:cursor-not-allowed disabled:opacity-50",
          size === "sm" ? "h-9" : "h-10",
          className,
        )}
      >
        <span className={cn("truncate", !current && "text-muted-foreground")}>
          {current?.label || placeholder}
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          position="popper"
          sideOffset={6}
          className={cn(
            "z-[100] min-w-[var(--radix-select-trigger-width)] max-w-[min(92vw,420px)] overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-2xl",
            "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95",
          )}
        >
          <SelectPrimitive.Viewport className="max-h-[min(320px,var(--radix-select-content-available-height))] p-1">
            {options.map((o) => (
              <SelectPrimitive.Item
                key={o.value || EMPTY}
                value={o.value === "" ? EMPTY : o.value}
                disabled={o.disabled}
                className={cn(
                  "relative flex cursor-pointer select-none items-center gap-2 rounded-lg py-2 pl-3 pr-8 text-sm outline-none",
                  "data-[highlighted]:bg-muted data-[highlighted]:text-foreground",
                  "data-[state=checked]:font-medium data-[state=checked]:text-primary",
                  "data-[disabled]:pointer-events-none data-[disabled]:opacity-40",
                  o.value === "" && "text-muted-foreground",
                )}
              >
                <SelectPrimitive.ItemText>{o.label}</SelectPrimitive.ItemText>
                <SelectPrimitive.ItemIndicator className="absolute right-2.5 inline-flex">
                  <Check className="h-4 w-4" />
                </SelectPrimitive.ItemIndicator>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}
