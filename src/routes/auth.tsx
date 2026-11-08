import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { MapPin, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { friendlyError } from "@/lib/friendly-errors";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, homeFor } from "@/lib/auth-context";
import { ActivateForm } from "@/components/PhoneSignIn";
import { accountEmail, looksLikePhone, normalizePhone } from "@/lib/phone";
import { PARENTS_ENABLED } from "@/lib/features";
import { VEHICLES, type VehicleType } from "@/lib/vehicles";

export const Route = createFileRoute("/auth")({
  head: () => ({ meta: [{ title: "Sign in — Live Track" }] }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const { user, role, loading: authLoading } = useAuth();

  useEffect(() => {
    if (authLoading || !user) return;
    // Wait until role has actually resolved before deciding where to send them,
    // otherwise a school_admin flashes /track before landing on /admin/routes.
    if (role === null) return;
    navigate({ to: homeFor(role) });
  }, [user, role, authLoading, navigate]);

  const [mode, setMode] = useState<"signin" | "signup" | "activate">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [vehicle, setVehicle] = useState("");
  const [plate, setPlate] = useState("");
  const [seats, setSeats] = useState("");
  const [vehicleType, setVehicleType] = useState<VehicleType>("car");
  const [busy, setBusy] = useState(false);

  const needsSeats = vehicleType === "bus" || vehicleType === "van";

  const handle = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: window.location.origin,
            data: {
              display_name: name,
              vehicle_name: vehicle,
              vehicle_type: vehicleType,
              plate_number: plate.trim().toUpperCase() || null,
              seats: seats ? String(parseInt(seats, 10)) : null,
            },
          },
        });
        if (error) throw error;
        toast.success("Account created. You're in!");
      } else {
        // Bus attendants sign in with their phone number.
        const id = looksLikePhone(email)
          ? accountEmail(normalizePhone(email)!, "attendant")
          : email.trim();
        const { error } = await supabase.auth.signInWithPassword({ email: id, password });
        if (error) throw error;
        toast.success("Welcome back");
      }
    } catch (err) {
      toast.error(friendlyError(err, "Couldn't sign you in. Please try again."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-[100dvh] flex items-center justify-center px-4 pt-[max(2.5rem,env(safe-area-inset-top))] pb-[max(2.5rem,env(safe-area-inset-bottom))] bg-background relative">
      <div className="absolute inset-0 bg-gradient-hero opacity-30" aria-hidden />
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="relative w-full max-w-md rounded-3xl bg-gradient-card border border-border/60 shadow-glow p-8"
      >
        <Link to="/" className="flex items-center gap-2 font-display font-bold text-lg mb-6">
          <span className="h-8 w-8 grid place-items-center rounded-lg bg-gradient-primary shadow-glow">
            <MapPin className="h-4 w-4 text-primary-foreground" />
          </span>
          Live Track
        </Link>

        <h1 className="font-display text-2xl font-bold">
          {mode === "signin"
            ? "School & staff sign in"
            : mode === "activate"
              ? "Bus attendant: first time"
              : "Create a driver account"}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          {mode === "signin"
            ? "School admins, drivers and bus attendants."
            : mode === "activate"
              ? "Use the 6-digit code from the school to choose your password."
              : "Start tracking in under a minute."}
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
          <Tabs
            value={mode}
            onValueChange={(v) => setMode(v as "signin" | "signup")}
            className="mt-6"
          >
            <TabsList className="grid grid-cols-2 w-full">
              <TabsTrigger value="signin">Sign in</TabsTrigger>
              <TabsTrigger value="signup">Create account</TabsTrigger>
            </TabsList>

            <form onSubmit={handle} className="mt-6 space-y-4">
              <TabsContent value="signup" className="space-y-4 mt-0">
                <div className="space-y-2">
                  <Label htmlFor="name">Driver name</Label>
                  <Input
                    id="name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. Alex Rivera"
                    required={mode === "signup"}
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label htmlFor="vehicle">Vehicle name</Label>
                    <Input
                      id="vehicle"
                      value={vehicle}
                      onChange={(e) => setVehicle(e.target.value)}
                      placeholder="Van #4"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="plate">Plate number</Label>
                    <Input
                      id="plate"
                      value={plate}
                      onChange={(e) => setPlate(e.target.value)}
                      placeholder="ABC-123"
                      className="uppercase"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Vehicle type</Label>
                  <div className="grid grid-cols-3 gap-2">
                    {VEHICLES.map((v) => {
                      const active = vehicleType === v.key;
                      return (
                        <button
                          type="button"
                          key={v.key}
                          onClick={() => setVehicleType(v.key)}
                          aria-pressed={active}
                          className={`flex flex-col items-center gap-1.5 rounded-xl border p-3 text-xs transition-all ${
                            active
                              ? "border-primary bg-primary/10 text-primary shadow-glow"
                              : "border-border bg-background/40 text-muted-foreground hover:border-primary/40 hover:text-foreground"
                          }`}
                        >
                          <v.Icon size={26} />
                          <span className="text-[11px] font-medium">{v.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
                {needsSeats && (
                  <div className="space-y-2">
                    <Label htmlFor="seats">Number of seats</Label>
                    <Input
                      id="seats"
                      type="number"
                      min={1}
                      max={200}
                      value={seats}
                      onChange={(e) => setSeats(e.target.value)}
                      placeholder={vehicleType === "bus" ? "e.g. 40" : "e.g. 12"}
                    />
                  </div>
                )}
              </TabsContent>

              <div className="space-y-2">
                <Label htmlFor="email">{mode === "signin" ? "Email or phone" : "Email"}</Label>
                <Input
                  id="email"
                  type={mode === "signin" ? "text" : "email"}
                  autoComplete="username"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={6}
                />
              </div>

              <Button
                type="submit"
                disabled={busy}
                className="w-full h-11 bg-gradient-primary shadow-glow text-base"
              >
                {busy ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : mode === "signin" ? (
                  "Sign in"
                ) : (
                  "Create account"
                )}
              </Button>
            </form>
          </Tabs>
        )}

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
