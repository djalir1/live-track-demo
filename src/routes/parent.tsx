import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { MapPin, ShieldCheck, BellRing, Navigation } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ActivateForm, PhoneSignInForm } from "@/components/PhoneSignIn";
import { useAuth, homeFor } from "@/lib/auth-context";
import { DemoLogins } from "@/components/DemoLogins";

export const Route = createFileRoute("/parent")({
  head: () => ({ meta: [{ title: "Parent sign in — Live Track" }] }),
  validateSearch: (s: Record<string, unknown>): { tab?: "signin" | "activate" } => ({
    tab: s.tab === "activate" ? "activate" : undefined,
  }),
  component: ParentSignIn,
});

function ParentSignIn() {
  const { user, role, loading } = useAuth();
  const navigate = useNavigate();
  const search = Route.useSearch();
  const [tab, setTab] = useState<"signin" | "activate">(search.tab ?? "signin");

  useEffect(() => {
    if (!loading && user && role) navigate({ to: homeFor(role) });
  }, [loading, user, role, navigate]);

  return (
    <div className="min-h-[100dvh] bg-background lg:grid lg:grid-cols-[1.1fr_1fr]">
      <aside className="hidden lg:flex relative overflow-hidden bg-gradient-hero text-white p-12 flex-col justify-between">
        <div
          className="absolute -top-32 -right-32 h-[28rem] w-[28rem] rounded-full bg-white/10 blur-3xl"
          aria-hidden
        />
        <Link to="/" className="relative flex items-center gap-2 font-display font-bold text-lg">
          <span className="h-9 w-9 grid place-items-center rounded-xl bg-white/15 backdrop-blur">
            <MapPin className="h-4 w-4" />
          </span>
          Live Track
        </Link>
        <div className="relative max-w-md">
          <h1 className="font-display text-4xl font-bold leading-tight">
            Know your child is safe, every trip.
          </h1>
          <ul className="mt-8 space-y-4 text-white/85">
            <li className="flex gap-3">
              <BellRing className="h-5 w-5 shrink-0" /> A message the moment your child gets on and
              off the bus.
            </li>
            <li className="flex gap-3">
              <Navigation className="h-5 w-5 shrink-0" /> See the bus live, and how many minutes
              until it reaches your stop.
            </li>
            <li className="flex gap-3">
              <ShieldCheck className="h-5 w-5 shrink-0" /> Tell the school “not riding today” in one
              tap.
            </li>
          </ul>
        </div>
        <p className="relative text-xs text-white/60">
          Your account is created by your child's school.
        </p>
      </aside>

      <main className="flex items-center justify-center px-5 pt-[max(2rem,env(safe-area-inset-top))] pb-[max(2rem,env(safe-area-inset-bottom))]">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-sm"
        >
          <Link
            to="/"
            className="lg:hidden flex items-center gap-2 font-display font-bold text-lg mb-8"
          >
            <span className="h-9 w-9 grid place-items-center rounded-xl bg-gradient-primary shadow-glow">
              <MapPin className="h-4 w-4 text-primary-foreground" />
            </span>
            Live Track
          </Link>
          <h2 className="font-display text-2xl font-bold">Parents</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Sign in with the phone number you gave the school.
          </p>

          <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)} className="mt-6">
            <TabsList className="grid grid-cols-2 w-full h-11">
              <TabsTrigger value="signin">Sign in</TabsTrigger>
              <TabsTrigger value="activate">First time here?</TabsTrigger>
            </TabsList>
            <TabsContent value="signin" className="mt-6">
              <PhoneSignInForm kind="parent" onForgot={() => setTab("activate")} />
              <p className="text-xs text-muted-foreground mt-4">
                Forgot your password? Ask the school for a new code, then use “First time here?” to
                choose a new one.
              </p>
            </TabsContent>
            <TabsContent value="activate" className="mt-6">
              <ActivateForm kind="parent" />
            </TabsContent>
          </Tabs>

          <DemoLogins group="parents" />

          <div className="mt-10 pt-6 border-t border-border text-sm text-muted-foreground">
            School staff or driver?{" "}
            <Link to="/auth" className="text-primary font-medium hover:underline">
              Sign in here
            </Link>
          </div>
        </motion.div>
      </main>
    </div>
  );
}
