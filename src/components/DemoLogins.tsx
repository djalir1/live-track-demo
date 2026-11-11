import { useState } from "react";
import { Loader2, MousePointerClick } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { DEMO_MODE, DEMO_PARENTS, DEMO_PASSWORD, DEMO_STAFF, type DemoAccount } from "@/lib/demo";
import { accountEmail, formatPhone, normalizePhone } from "@/lib/phone";

// Demo only: one tap signs you in as a seeded person, so a presentation never
// stops for typing. Shown on /auth (school + attendants) and /parent.

export function DemoLogins({ group }: { group: "staff" | "parents" }) {
  const [busy, setBusy] = useState<string | null>(null);
  if (!DEMO_MODE) return null;
  const accounts = group === "staff" ? DEMO_STAFF : DEMO_PARENTS;

  async function signIn(a: DemoAccount) {
    setBusy(a.login);
    const email = a.kind === "email" ? a.login : accountEmail(normalizePhone(a.login)!, a.kind);
    const { error } = await supabase.auth.signInWithPassword({ email, password: DEMO_PASSWORD });
    if (error) {
      setBusy(null);
      toast.error("This demo account is missing. Run: npm run demo:seed");
    }
    // On success the page redirects by itself.
  }

  return (
    <div className="mt-6 rounded-2xl border border-warning/50 bg-warning/5 p-3.5">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <MousePointerClick className="h-4 w-4 text-warning" />
        Demo: tap a person to sign in
      </div>
      <div className="mt-2.5 grid gap-2">
        {accounts.map((a) => (
          <button
            key={a.login}
            type="button"
            disabled={busy != null}
            onClick={() => void signIn(a)}
            className="flex items-center gap-2.5 rounded-xl border border-border bg-background/70 p-2.5 text-left transition-colors hover:border-primary hover:bg-primary/5 disabled:opacity-60"
          >
            <span className="h-9 w-9 shrink-0 rounded-full bg-primary/15 text-primary grid place-items-center text-sm font-semibold">
              {busy === a.login ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                a.name.replace(/^Mrs?\. /, "").slice(0, 1)
              )}
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-medium truncate">{a.name}</span>
              <span className="block text-[11px] text-muted-foreground truncate">{a.about}</span>
              <span className="block text-[11px] text-muted-foreground/80 truncate">
                {a.kind === "email" ? a.login : formatPhone(normalizePhone(a.login))}
              </span>
            </span>
          </button>
        ))}
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">
        Or type the login yourself — the password for everyone is{" "}
        <b className="font-semibold text-foreground">{DEMO_PASSWORD}</b>.
      </p>
    </div>
  );
}
