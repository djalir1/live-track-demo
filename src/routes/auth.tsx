import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { MapPin, Loader2, Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";
import { friendlyError } from "@/lib/friendly-errors";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, homeFor } from "@/lib/auth-context";
import { ActivateForm } from "@/components/PhoneSignIn";
import { accountEmail, looksLikePhone, normalizePhone } from "@/lib/phone";
import { PARENTS_ENABLED } from "@/lib/features";
import { DemoLogins } from "@/components/DemoLogins";

// School & staff sign-in: school admins (email), bus attendants (phone),
// drivers (email). Accounts are created by the school — there is no public
// sign-up. Parents use /parent.

export const Route = createFileRoute("/auth")({
  head: () => ({ meta: [{ title: "Sign in — Live Track" }] }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const { user, role, loading: authLoading } = useAuth();

  useEffect(() => {
    if (authLoading || !user || role === null) return;
    navigate({ to: homeFor(role) });
  }, [user, role, authLoading, navigate]);

  const [mode, setMode] = useState<"signin" | "activate">("signin");
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);

  async function signIn(id: string, pw: string) {
    setBusy(true);
    try {
      // Bus attendants sign in with their phone number.
      const email = looksLikePhone(id) ? accountEmail(normalizePhone(id)!, "attendant") : id.trim();
      const { error } = await supabase.auth.signInWithPassword({ email, password: pw });
      if (error) throw error;
      toast.success("Welcome back");
    } catch (err) {
      toast.error(friendlyError(err, "Wrong email/phone or password."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-[100dvh] flex items-center justify-center px-4 pt-[max(2.5rem,env(safe-area-inset-top))] pb-[max(2.5rem,env(safe-area-inset-bottom))] bg-background relative">
      <div className="absolute inset-0 bg-gradient-hero opacity-30" aria-hidden />
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="relative w-full max-w-md rounded-3xl bg-gradient-card border border-border/60 shadow-glow p-6 sm:p-8"
      >
        <Link to="/" className="flex items-center gap-2 font-display font-bold text-lg mb-6">
          <span className="h-8 w-8 grid place-items-center rounded-lg bg-gradient-primary shadow-glow">
            <MapPin className="h-4 w-4 text-primary-foreground" />
          </span>
          Live Track
        </Link>

        <h1 className="font-display text-2xl font-bold">
          {mode === "signin" ? "School & staff sign in" : "Bus attendant: first time"}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          {mode === "signin"
            ? "School admins, bus attendants and drivers. Your account is created by the school."
            : "Use the 6-digit code from the school to choose your password."}
        </p>

        {mode === "activate" ? (
          <div className="mt-6">
            <ActivateForm kind="attendant" />
            <button
              type="button"
              onClick={() => setMode("signin")}
              className="mt-4 text-sm text-primary hover:underline"
            >
              ← Back to sign in
            </button>
          </div>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void signIn(login, password);
            }}
            className="mt-6 space-y-4"
          >
            <div className="space-y-2">
              <Label htmlFor="login">Email or phone</Label>
              <Input
                id="login"
                value={login}
                onChange={(e) => setLogin(e.target.value)}
                autoComplete="username"
                placeholder="you@school.rw or 0788 123 456"
                required
                className="h-11"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={show ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  required
                  minLength={6}
                  className="h-11 pr-11"
                />
                <button
                  type="button"
                  onClick={() => setShow((s) => !s)}
                  className="absolute right-1 top-1/2 -translate-y-1/2 h-9 w-9 grid place-items-center text-muted-foreground"
                  aria-label={show ? "Hide password" : "Show password"}
                >
                  {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
            <Button
              type="submit"
              disabled={busy}
              className="w-full h-11 bg-gradient-primary shadow-glow text-base"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Sign in"}
            </Button>
          </form>
        )}

        {mode === "signin" && <DemoLogins group="staff" />}

        <div className="mt-6 pt-5 border-t border-border space-y-2 text-sm text-muted-foreground">
          {mode === "signin" && PARENTS_ENABLED && (
            <div>
              Bus attendant with a code?{" "}
              <button
                type="button"
                onClick={() => setMode("activate")}
                className="text-primary font-medium hover:underline"
              >
                Activate your account
              </button>
            </div>
          )}
          {PARENTS_ENABLED && (
            <div>
              Parent?{" "}
              <Link to="/parent" className="text-primary font-medium hover:underline">
                Sign in with your phone number
              </Link>
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
}
