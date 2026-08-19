import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Loader2, MapPin, Ticket, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { redeemJoinCode } from "@/lib/parent-join.server";

export const Route = createFileRoute("/join")({
  head: () => ({ meta: [{ title: "Join — Pulse" }] }),
  component: JoinPage,
});

type Step = "code" | "pin" | "signin";

function JoinPage() {
  const navigate = useNavigate();
  const { user, role, loading } = useAuth();

  // Auto-resume: if already signed in as a parent, go straight to /me.
  useEffect(() => {
    if (loading) return;
    if (user && role === "parent") navigate({ to: "/me" });
  }, [user, role, loading, navigate]);

  const [step, setStep] = useState<Step>("code");
  const [code, setCode] = useState("");
  const [pin, setPin] = useState("");
  const [pinConfirm, setPinConfirm] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);

  async function submitCode(e: React.FormEvent) {
    e.preventDefault();
    if (!code.trim()) { toast.error("Enter the code from your school"); return; }
    setStep("pin");
  }

  async function submitPin(e: React.FormEvent) {
    e.preventDefault();
    if (!/^\d{4}$/.test(pin)) { toast.error("PIN must be 4 digits"); return; }
    if (pin !== pinConfirm) { toast.error("The two PINs don't match"); return; }
    setBusy(true);
    try {
      const res = await redeemJoinCode({ data: { code: code.trim().toUpperCase(), pin } });
      // Sign in with the deterministic email we just created.
      const { error: sErr } = await supabase.auth.signInWithPassword({ email: res.email, password: pin });
      if (sErr) throw sErr;
      toast.success("Signed in");
      navigate({ to: "/me" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Redeem failed");
      // Rewind to code entry so the parent can try a different code.
      setStep("code");
      setPin(""); setPinConfirm("");
    } finally { setBusy(false); }
  }

  async function submitSignin(e: React.FormEvent) {
    e.preventDefault();
    if (!phone.trim() && !code.trim()) { toast.error("Enter your phone or your original code"); return; }
    if (!/^\d{4}$/.test(pin)) { toast.error("PIN must be 4 digits"); return; }
    setBusy(true);
    try {
      // Match the server side of parent-join.server.ts localPart():
      // normalized phone (or code fallback) + "@parent.pulse.local".
      const localPart = phone.trim() ? phone.trim().replace(/[^\d+]/g, "") : code.trim().toUpperCase();
      const email = `${localPart}@parent.pulse.local`;
      const { error } = await supabase.auth.signInWithPassword({ email, password: pin });
      if (error) throw error;
      toast.success("Signed in");
      navigate({ to: "/me" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Sign-in failed");
    } finally { setBusy(false); }
  }

  return (
    <div className="min-h-screen bg-background grid place-items-center px-4">
      <motion.div
        initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md rounded-2xl border border-border/60 bg-gradient-card shadow-soft p-6"
      >
        <Link to="/" className="flex items-center gap-2 font-display font-bold text-lg">
          <span className="h-8 w-8 grid place-items-center rounded-lg bg-gradient-primary shadow-glow">
            <MapPin className="h-4 w-4 text-primary-foreground" />
          </span>
          Pulse
        </Link>
        <div className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
          <Ticket className="h-3.5 w-3.5" /> Parent join
        </div>
        <h1 className="mt-1 font-display text-2xl font-bold tracking-tighter">
          {step === "signin" ? "Sign in" : step === "pin" ? "Set your PIN" : "Enter the code from your school"}
        </h1>

        {step === "code" && (
          <form onSubmit={submitCode} className="mt-5 space-y-3">
            <div className="space-y-2">
              <Label htmlFor="code">Invite code</Label>
              <Input id="code" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} autoFocus placeholder="e.g. K4M2X7P9" className="h-11 font-mono tracking-widest text-lg" />
            </div>
            <Button type="submit" className="w-full h-11 bg-gradient-primary shadow-glow">Continue</Button>
            <button type="button" onClick={() => setStep("signin")} className="w-full text-xs text-muted-foreground hover:text-foreground pt-2">
              Already have an account? Sign in
            </button>
          </form>
        )}

        {step === "pin" && (
          <form onSubmit={submitPin} className="mt-5 space-y-3">
            <div className="space-y-2">
              <Label htmlFor="pin">4-digit PIN</Label>
              <Input id="pin" inputMode="numeric" pattern="\d{4}" maxLength={4} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))} autoFocus className="h-11 tracking-[0.5em] text-center text-lg" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="pin2">Confirm PIN</Label>
              <Input id="pin2" inputMode="numeric" pattern="\d{4}" maxLength={4} value={pinConfirm} onChange={(e) => setPinConfirm(e.target.value.replace(/\D/g, "").slice(0, 4))} className="h-11 tracking-[0.5em] text-center text-lg" />
            </div>
            <div className="text-[11px] text-muted-foreground flex items-center gap-1.5">
              <ShieldCheck className="h-3 w-3" /> The PIN unlocks this device only. Nobody else sees it.
            </div>
            <Button type="submit" disabled={busy} className="w-full h-11 bg-gradient-primary shadow-glow">
              {busy ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Redeem & sign in
            </Button>
            <button type="button" onClick={() => setStep("code")} className="w-full text-xs text-muted-foreground hover:text-foreground pt-2">
              Back
            </button>
          </form>
        )}

        {step === "signin" && (
          <form onSubmit={submitSignin} className="mt-5 space-y-3">
            <div className="space-y-2">
              <Label htmlFor="phone2">Phone (or original code)</Label>
              <Input id="phone2" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+2507…" className="h-11" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="pin3">PIN</Label>
              <Input id="pin3" inputMode="numeric" pattern="\d{4}" maxLength={4} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))} className="h-11 tracking-[0.5em] text-center text-lg" />
            </div>
            <Button type="submit" disabled={busy} className="w-full h-11 bg-gradient-primary shadow-glow">
              {busy ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Sign in
            </Button>
            <button type="button" onClick={() => { setStep("code"); setPin(""); setPinConfirm(""); }} className="w-full text-xs text-muted-foreground hover:text-foreground pt-2">
              New here? Enter a code instead
            </button>
          </form>
        )}
      </motion.div>
    </div>
  );
}
