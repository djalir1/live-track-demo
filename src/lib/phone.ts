// Phone numbers for parent and attendant accounts.
//
// Stored as digits with the country code (250788123456), exactly like
// public.normalize_phone() in the database and api/activate.js. Accounts are
// Supabase users whose (never-mailed) email is built from that number, so
// "sign in with phone + password" is a normal password sign-in.

export type AccountKind = "parent" | "attendant";

const DOMAIN: Record<AccountKind, string> = {
  parent: "parent.livetrack.app",
  attendant: "staff.livetrack.app",
};

/** 0788 123 456 · +250 788 123 456 · 788123456 → 250788123456 (null if not a phone). */
export function normalizePhone(input: string | null | undefined): string | null {
  const d = String(input ?? "").replace(/\D+/g, "");
  if (!d) return null;
  if (d.length === 10 && d.startsWith("0")) return `250${d.slice(1)}`;
  if (d.length === 9 && d.startsWith("7")) return `250${d}`;
  return d.length >= 9 && d.length <= 15 ? d : null;
}

/** 250788123456 → 0788 123 456 (how people write it in Rwanda; other countries keep +code). */
export function formatPhone(p: string | null | undefined): string {
  if (!p) return "";
  const d = p.replace(/\D+/g, "");
  if (d.length === 12 && d.startsWith("250"))
    return `0${d.slice(3, 6)} ${d.slice(6, 9)} ${d.slice(9)}`;
  return d ? `+${d}` : "";
}

export function accountEmail(phone: string, kind: AccountKind): string {
  return `${phone}@${DOMAIN[kind]}`;
}

/** True when a sign-in field holds a phone number rather than an email. */
export function looksLikePhone(s: string): boolean {
  return !s.includes("@") && normalizePhone(s) != null;
}

export function telLink(p: string | null | undefined): string {
  const d = (p ?? "").replace(/\D+/g, "");
  return d ? `tel:+${d}` : "";
}
