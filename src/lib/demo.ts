// Demo mode (a separate Live Track project for presentations).
//
// Turned on with VITE_DEMO_MODE=true in the demo's environment. It only adds
// a small "DEMO · fictional data" badge; everything else is the real app.
// The demo accounts (scripts/demo/seed.mjs) sign in through the normal
// /auth and /parent pages — see DEMO_GUIDE.md for the logins.

export const DEMO_MODE = String(import.meta.env.VITE_DEMO_MODE ?? "").toLowerCase() === "true";
