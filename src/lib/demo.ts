// Demo mode (a separate Live Track project for presentations).
//
// Turned on with VITE_DEMO_MODE=true in the demo's environment. It only adds
// a small "DEMO · fictional data" badge; everything else is the real app.
// The demo accounts (scripts/demo/seed.mjs) sign in through the normal
// /auth and /parent pages — see DEMO_GUIDE.md for the logins.

export const DEMO_MODE = String(import.meta.env.VITE_DEMO_MODE ?? "").toLowerCase() === "true";

export const DEMO_PASSWORD = "demo1234";

export interface DemoAccount {
  name: string;
  /** What this person is / which children they have. */
  about: string;
  /** Email for the school admin, phone for attendants and parents. */
  login: string;
  kind: "email" | "attendant" | "parent";
}

// One-tap sign-in on /auth and /parent. Created by scripts/demo/seed.mjs —
// keep the two in sync. The platform admin is left out on purpose: sign in
// by hand with admin@demo.livetrack.app.
export const DEMO_STAFF: DemoAccount[] = [
  {
    name: "Mrs. Claudine Mutesi",
    about: "School admin · Sunrise Academy",
    login: "school@demo.livetrack.app",
    kind: "email",
  },
  {
    name: "Alice Mukeshimana",
    about: "Bus attendant · Bus 1",
    login: "0788100001",
    kind: "attendant",
  },
  {
    name: "Diane Uwamahoro",
    about: "Bus attendant · Bus 2",
    login: "0788100002",
    kind: "attendant",
  },
  {
    name: "Josiane Ingabire",
    about: "Bus attendant · Bus 3",
    login: "0788100003",
    kind: "attendant",
  },
];

export const DEMO_PARENTS: DemoAccount[] = [
  { name: "Grace Uwase", about: "Amina & Brian · Bus 1", login: "0788200001", kind: "parent" },
  { name: "Eric Mugisha", about: "Chloe · Bus 1", login: "0788200002", kind: "parent" },
  { name: "Aline Ishimwe", about: "Kevine & Liam · Bus 2", login: "0788200003", kind: "parent" },
  {
    name: "Jean Paul Nkurunziza",
    about: "Umutoni, Victor & Wendy · Bus 3",
    login: "0788200004",
    kind: "parent",
  },
];
