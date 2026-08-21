// Translate raw Postgres/Supabase error strings into short, calm messages
// that a school admin or a parent can act on. We keep the technical text
// on `console.error` for debugging; the toast/UI only ever sees the friendly
// message.

export function friendlyError(e: unknown, fallback = "Something went wrong. Please try again."): string {
  if (!e) return fallback;
  const raw = e instanceof Error ? e.message : typeof e === "string" ? e : String(e);
  const low = raw.toLowerCase();

  // Log the technical text so debugging is still possible.
  if (typeof console !== "undefined") console.error("[friendlyError]", raw);

  // Auth / session issues
  if (low.includes("invalid login credentials") || low.includes("invalid credentials")) {
    return "That phone or PIN doesn't match. Check both and try again.";
  }
  if (low.includes("email not confirmed") || low.includes("email link is invalid")) {
    return "This account isn't ready yet. Please contact your school.";
  }
  if (low.includes("jwt") || low.includes("unauthorized") || low.includes("token")) {
    return "Your session has expired. Please sign in again.";
  }

  // RLS / permission
  if (low.includes("row-level security") || low.includes("permission denied")) {
    return "You don't have access to that. Please refresh and try again.";
  }

  // Invite-code redemption flow
  if (low.includes("doesn't match any invite") || low.includes("no such invite")) {
    return "That code doesn't match any invite. Double-check with your school.";
  }
  if (low.includes("already been used") || low.includes("already used")) {
    return "This code has already been used. Ask your school for a new one.";
  }
  if (low.includes("expired")) {
    return "This code has expired. Ask your school for a fresh one.";
  }
  if (low.includes("pin must be")) return "PIN must be 4 digits.";
  if (low.includes("code is required")) return "Please enter the code from your school.";

  // Duplicate / conflict
  if (low.includes("duplicate key") || low.includes("unique constraint") || low.includes("23505")) {
    return "That entry already exists.";
  }

  // Network / offline
  if (low.includes("failed to fetch") || low.includes("network") || low.includes("net::")) {
    return "Can't reach the server. Check your connection and try again.";
  }

  // Server misconfiguration surfaces from /api/parent-redeem
  if (low.includes("server misconfigured")) {
    return "The service isn't ready yet. Please try again in a few minutes.";
  }

  // 4xx / 5xx from fetch responses
  if (/\b(4\d\d|5\d\d)\b/.test(low) && low.length < 60) {
    return "The server had a problem. Please try again.";
  }

  // Fall back to the original for developer errors that slipped through — but
  // trim ugly prefixes like "Error:".
  const cleaned = raw.replace(/^Error:\s*/i, "").trim();
  if (cleaned.length > 0 && cleaned.length < 140) return cleaned;
  return fallback;
}
