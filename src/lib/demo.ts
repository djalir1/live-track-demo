// Demo mode (a separate Live Track project for presentations).
//
// Turned on with VITE_DEMO_MODE=true in the demo's environment. It only adds
// a "demo" banner and one-tap sign-in with the seeded accounts; everything
// else is the real app. The accounts below are created by
// scripts/demo/seed.mjs — keep the two in sync.

export const DEMO_MODE = String(import.meta.env.VITE_DEMO_MODE ?? "").toLowerCase() === "true";

export const DEMO_PASSWORD = "demo1234";

export interface DemoAccount {
  label: string;
  hint: string;
  /** Email for staff, phone for parents / attendants. */
  login: string;
  kind: "email" | "attendant" | "parent";
}

export const DEMO_STAFF: DemoAccount[] = [
  {
    label: "School admin",
    hint: "Sunrise Academy (Demo)",
    login: "school@demo.livetrack.app",
    kind: "email",
  },
  {
    label: "Platform admin",
    hint: "Sees every school",
    login: "admin@demo.livetrack.app",
    kind: "email",
  },
  { label: "Bus attendant", hint: "Bus 1 · Kimironko", login: "0788100001", kind: "attendant" },
  { label: "Bus attendant", hint: "Bus 2 · Kicukiro", login: "0788100002", kind: "attendant" },
];

export const DEMO_PARENTS: DemoAccount[] = [
  { label: "Grace Uwase", hint: "2 children · Bus 1", login: "0788200001", kind: "parent" },
  { label: "Eric Mugisha", hint: "1 child · Bus 1", login: "0788200002", kind: "parent" },
  { label: "Aline Ishimwe", hint: "2 children · Bus 2", login: "0788200003", kind: "parent" },
];
