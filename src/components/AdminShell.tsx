import type { ReactNode } from "react";
import { AppShell } from "@/components/AppShell";

// Kept for the existing /admin/* pages: they now render inside the sidebar
// layout (AppShell), which also does the admin / school_admin guard.
export function AdminShell({ children }: { children: ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
