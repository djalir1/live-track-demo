import { useState } from "react";
import { toast } from "sonner";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { accountEmail, normalizePhone, type AccountKind } from "@/lib/phone";

// Phone + password sign-in for parents and bus attendants, and the
// first-time activation (phone + 6-digit code from the school + new password).

function PasswordInput({
  id,
  value,
  onChange,
  autoComplete,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <Input
        id={id}
        type={show ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete}
        minLength={6}
        required
        className="h-12 pr-11 text-base"
      />
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        className="absolute right-1 top-1/2 -translate-y-1/2 h-10 w-10 grid place-items-center text-muted-foreground"
        aria-label={show ? "Hide password" : "Show password"}
      >
        {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
}

export function PhoneSignInForm({ kind, onForgot }: { kind: AccountKind; onForgot?: () => void }) {
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        const p = normalizePhone(phone);
        if (!p) return toast.error("Enter your phone number, e.g. 0788 123 456");
        setBusy(true);
        const { error } = await supabase.auth.signInWithPassword({
          email: accountEmail(p, kind),
          password,
        });
        setBusy(false);
        if (error)
          toast.error(
            /invalid/i.test(error.message)
              ? "Wrong phone number or password. First time here? Use your activation code."
              : "Couldn't sign you in. Check your connection and try again.",
          );
      }}
    >
      <div className="space-y-2">
        <Label htmlFor={`${kind}-phone`}>Phone number</Label>
        <Input
          id={`${kind}-phone`}
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          inputMode="tel"
          autoComplete="tel"
          placeholder="0788 123 456"
          required
          className="h-12 text-base"
        />
      </div>
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label htmlFor={`${kind}-password`}>Password</Label>
          {onForgot && (
            <button
              type="button"
              onClick={onForgot}
              className="text-xs text-primary hover:underline"
            >
              Forgot it?
            </button>
          )}
        </div>
        <PasswordInput
          id={`${kind}-password`}
          value={password}
          onChange={setPassword}
          autoComplete="current-password"
        />
      </div>
      <Button
        type="submit"
        disabled={busy}
        className="w-full h-12 text-base bg-gradient-primary shadow-glow"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Sign in"}
      </Button>
    </form>
  );
}

export function ActivateForm({ kind }: { kind: AccountKind }) {
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        const p = normalizePhone(phone);
        if (!p) return toast.error("Enter your phone number, e.g. 0788 123 456");
        if (code.replace(/\D/g, "").length !== 6)
          return toast.error("The code from the school has 6 digits");
        if (password.length < 6) return toast.error("Choose a password of at least 6 characters");
        if (password !== confirm) return toast.error("The two passwords are different");
        setBusy(true);
        try {
          const res = await fetch("/api/activate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ kind, phone: p, code, password }),
          });
          const body = (await res.json().catch(() => ({}))) as {
            error?: string;
            email?: string;
            name?: string;
          };
          if (!res.ok || !body.email)
            throw new Error(body.error || "Activation failed. Please try again.");
          const { error } = await supabase.auth.signInWithPassword({ email: body.email, password });
          if (error) throw error;
          toast.success(
            `Welcome${body.name ? `, ${body.name.split(" ")[0]}` : ""}! Next time, sign in with your phone and password.`,
          );
        } catch (err) {
          toast.error(err instanceof Error ? err.message : "Activation failed");
        } finally {
          setBusy(false);
        }
      }}
    >
      <p className="text-sm text-muted-foreground">
        The school gave you a 6-digit code. Enter it with your phone number, then choose your own
        password.
      </p>
      <div className="space-y-2">
        <Label htmlFor={`${kind}-a-phone`}>Phone number</Label>
        <Input
          id={`${kind}-a-phone`}
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          inputMode="tel"
          autoComplete="tel"
          placeholder="0788 123 456"
          required
          className="h-12 text-base"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor={`${kind}-code`}>Code from the school</Label>
        <Input
          id={`${kind}-code`}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
          inputMode="numeric"
          autoComplete="one-time-code"
          placeholder="••••••"
          required
          className="h-12 text-center font-mono text-2xl tracking-[0.5em]"
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label htmlFor={`${kind}-new`}>New password</Label>
          <PasswordInput
            id={`${kind}-new`}
            value={password}
            onChange={setPassword}
            autoComplete="new-password"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${kind}-confirm`}>Repeat it</Label>
          <PasswordInput
            id={`${kind}-confirm`}
            value={confirm}
            onChange={setConfirm}
            autoComplete="new-password"
          />
        </div>
      </div>
      <Button
        type="submit"
        disabled={busy}
        className="w-full h-12 text-base bg-gradient-primary shadow-glow"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Activate my account"}
      </Button>
    </form>
  );
}
