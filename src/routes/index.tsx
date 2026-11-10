import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { motion, useInView, useScroll, useTransform } from "framer-motion";
import {
  MapPin,
  Zap,
  ShieldCheck,
  Smartphone,
  Activity,
  Route as RouteIcon,
  Globe,
  ChevronRight,
  Play,
  LineChart,
  BarChart3,
  Clock,
  Bell,
  Users,
  Truck,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth, homeFor } from "@/lib/auth-context";
import { PARENTS_ENABLED } from "@/lib/features";
import { AnimatedWorld, LivePreviewCard } from "@/components/AnimatedWorld";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Live Track — School Bus Tracking & Student Check-in" },
      {
        name: "description",
        content:
          "Live GPS on every school bus and a check-in for every child. Parents see the bus and know when their child boards and gets off; the school sees every bus, every trip and every alert.",
      },
      { property: "og:title", content: "Live Track — Every bus, every child, live" },
      {
        property: "og:description",
        content: "Live bus tracking, child check-in and parent alerts for schools.",
      },
    ],
  }),
  component: Landing,
});

function Landing() {
  const { user, role, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && user && role) navigate({ to: homeFor(role) });
  }, [loading, user, role, navigate]);

  const { scrollY } = useScroll();
  const heroY = useTransform(scrollY, [0, 400], [0, -60]);
  const worldOpacity = useTransform(scrollY, [0, 400], [1, 0.15]);

  return (
    <div className="min-h-screen bg-background text-foreground overflow-x-hidden">
      <NavBar />

      {/* HERO */}
      <section className="relative pt-24 md:pt-32 pb-20 md:pb-28">
        <motion.div style={{ opacity: worldOpacity }} className="absolute inset-0">
          <AnimatedWorld />
        </motion.div>
        <div
          className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,oklch(0.55_0.22_256/0.25),transparent_60%)]"
          aria-hidden
        />
        <div
          className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-b from-transparent to-background"
          aria-hidden
        />

        <motion.div style={{ y: heroY }} className="relative mx-auto max-w-6xl px-4">
          <div className="mx-auto max-w-4xl text-center">
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5 }}
              className="mx-auto inline-flex items-center gap-2 rounded-full border border-border/60 bg-card/60 backdrop-blur px-3 py-1 text-xs font-medium text-muted-foreground"
            >
              <span className="relative flex h-2 w-2">
                <span className="absolute inset-0 rounded-full bg-[var(--moving)] animate-ping opacity-60" />
                <span className="relative h-2 w-2 rounded-full bg-[var(--moving)]" />
              </span>
              <span>Live school-bus tracking · in pilot with a Kigali school</span>
            </motion.div>

            <motion.h1
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.05 }}
              className="mt-8 font-display text-5xl md:text-7xl lg:text-8xl font-bold leading-[1.02] tracking-tighter"
            >
              Every bus. Every child.
              <br />
              <span className="bg-gradient-to-r from-[oklch(0.7_0.2_256)] via-[oklch(0.65_0.24_290)] to-[oklch(0.7_0.18_320)] bg-clip-text text-transparent animate-gradient bg-[length:200%_auto]">
                Live.
              </span>
            </motion.h1>

            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.25, duration: 0.7 }}
              className="mt-6 max-w-2xl mx-auto text-lg md:text-xl text-muted-foreground leading-relaxed"
            >
              A GPS tracker in each bus shows the school and parents where it is, every few seconds.
              The bus attendant checks each child on and off, so parents know the moment their child
              boards, arrives at school and gets off at home. The same platform tracks any fleet.
            </motion.p>

            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4, duration: 0.5 }}
              className="mt-10 flex flex-col sm:flex-row gap-3 justify-center items-center"
            >
              <Button
                asChild
                size="lg"
                className="h-14 px-8 text-base bg-gradient-primary shadow-glow hover:shadow-[0_20px_60px_-15px_oklch(0.55_0.22_256/0.6)] transition-shadow"
              >
                <Link to="/auth" className="inline-flex items-center gap-2">
                  School &amp; staff sign in <ChevronRight className="h-4 w-4" />
                </Link>
              </Button>
              {PARENTS_ENABLED ? (
                <Button
                  asChild
                  size="lg"
                  variant="outline"
                  className="h-14 px-8 text-base backdrop-blur"
                >
                  <Link to="/parent" className="inline-flex items-center gap-2">
                    I'm a parent <ChevronRight className="h-4 w-4" />
                  </Link>
                </Button>
              ) : (
                <Button
                  asChild
                  size="lg"
                  variant="outline"
                  className="h-14 px-8 text-base backdrop-blur"
                >
                  <a href="#how" className="inline-flex items-center gap-2">
                    <Play className="h-4 w-4 fill-current" /> See how it works
                  </a>
                </Button>
              )}
            </motion.div>

            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.7, duration: 0.6 }}
              className="mt-6 flex flex-wrap justify-center gap-x-6 gap-y-2 text-xs text-muted-foreground"
            >
              <span className="inline-flex items-center gap-1.5">
                <ShieldCheck className="h-3.5 w-3.5" /> Every child accounted for
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Zap className="h-3.5 w-3.5" /> Live position every 10 s
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Bell className="h-3.5 w-3.5" /> Instant parent alerts
              </span>
            </motion.div>
          </div>

          {/* Live preview card */}
          <div className="mt-16 md:mt-20 max-w-4xl mx-auto">
            <LivePreviewCard />
          </div>
        </motion.div>
      </section>

      {/* STATS */}
      <StatsStrip />

      {/* FEATURES */}
      <FeaturesGrid />

      {/* HOW IT WORKS */}
      <HowItWorks />

      {/* USE CASES */}
      <UseCases />

      {/* CTA */}
      <FinalCTA />

      {/* FOOTER */}
      <Footer />

      <style>{`
        @keyframes gradient-shift {
          0% { background-position: 0% 50%; }
          50% { background-position: 100% 50%; }
          100% { background-position: 0% 50%; }
        }
        .animate-gradient { animation: gradient-shift 8s ease-in-out infinite; }
      `}</style>
    </div>
  );
}

// ---------- Sections ----------

function NavBar() {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 30);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);

  return (
    <header
      className={`fixed top-0 inset-x-0 z-50 pt-safe transition-all ${scrolled ? "backdrop-blur-xl bg-background/80 border-b border-border/50 shadow-sm" : "bg-transparent"}`}
    >
      <div className="mx-auto max-w-6xl px-4 h-16 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-2 font-display font-bold text-lg">
          <span className="relative flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-primary shadow-glow">
            <MapPin className="h-4 w-4 text-primary-foreground" />
          </span>
          Live Track
        </Link>
        <nav className="hidden md:flex items-center gap-8 text-sm text-muted-foreground">
          <a href="#features" className="hover:text-foreground transition-colors">
            Features
          </a>
          <a href="#how" className="hover:text-foreground transition-colors">
            How it works
          </a>
          <a href="#use-cases" className="hover:text-foreground transition-colors">
            Use cases
          </a>
        </nav>
        <div className="flex items-center gap-2">
          {PARENTS_ENABLED && (
            <Button
              asChild
              variant="ghost"
              size="sm"
              title="Parents sign in with their phone number"
            >
              <Link to="/parent">Parents</Link>
            </Button>
          )}
          <Button asChild size="sm" className="bg-gradient-primary shadow-glow">
            <Link to="/auth">School sign in</Link>
          </Button>
        </div>
      </div>
    </header>
  );
}

function StatsStrip() {
  const stats = [
    { value: "10s", label: "GPS update" },
    { value: "2", label: "Trips checked a day" },
    { value: "1 tap", label: "Child on / off" },
    { value: "24/7", label: "Bus monitoring" },
  ];
  return (
    <section className="relative border-y border-border/50 bg-card/30 backdrop-blur">
      <div className="mx-auto max-w-6xl px-4 py-10 grid grid-cols-2 md:grid-cols-4 gap-6">
        {stats.map((s, i) => (
          <motion.div
            key={s.label}
            initial={{ opacity: 0, y: 12 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-50px" }}
            transition={{ duration: 0.5, delay: i * 0.05 }}
            className="text-center"
          >
            <div className="font-display text-4xl md:text-5xl font-bold bg-gradient-to-b from-foreground to-foreground/70 bg-clip-text text-transparent">
              {s.value}
            </div>
            <div className="mt-1 text-xs uppercase tracking-wider text-muted-foreground">
              {s.label}
            </div>
          </motion.div>
        ))}
      </div>
    </section>
  );
}

const FEATURES = [
  {
    icon: MapPin,
    title: "GPS tracker in every bus",
    desc: "A hard-wired tracker reports the bus position, speed and engine on/off every few seconds — no phone needed in the cab.",
  },
  {
    icon: Activity,
    title: "Live map at a glance",
    desc: "Every bus on one map with its status and on-board count. Collapse the sidebar for a full-screen map.",
  },
  {
    icon: RouteIcon,
    title: "Trip playback",
    desc: "Replay any day's route, stops and distances. Reverse-geocoded to real street names automatically.",
  },
  {
    icon: Users,
    title: "Child check-in",
    desc: "The bus attendant ticks each child on and off, stop by stop. Works offline and syncs when the network is back.",
  },
  {
    icon: Smartphone,
    title: "Parent app",
    desc: 'Parents follow the bus, see minutes to their stop, get boarded / arrived / dropped-off alerts and report "not riding today".',
  },
  {
    icon: ShieldCheck,
    title: "Safety alerts",
    desc: "No-shows, wrong bus, far drop-offs, a child still on board after the engine stops, tracker unplugged — the school is told at once.",
  },
  {
    icon: BarChart3,
    title: "Reports & registers",
    desc: "Daily and monthly attendance in Excel and PDF, class register vs. bus list, trip history with km and stops.",
  },
  {
    icon: MapPin,
    title: "Human-readable places",
    desc: 'Street names like "Avenue KN 4" instead of raw coordinates — everywhere the fleet appears.',
  },
];

function FeaturesGrid() {
  return (
    <section id="features" className="relative py-24 md:py-32">
      <div className="mx-auto max-w-6xl px-4">
        <div className="text-center max-w-2xl mx-auto">
          <SectionEyebrow icon={Sparkles}>Everything you need</SectionEyebrow>
          <h2 className="mt-4 font-display text-4xl md:text-5xl font-bold tracking-tighter">
            Built for the school run.
          </h2>
          <p className="mt-4 text-muted-foreground text-lg">
            Every feature answers a question a parent or a school actually asks:
            <em> where is the bus? is my child on it? did everyone get home?</em>
          </p>
        </div>

        <div className="mt-16 grid md:grid-cols-2 lg:grid-cols-4 gap-3">
          {FEATURES.map((f, i) => (
            <FeatureCard key={f.title} {...f} index={i} />
          ))}
        </div>
      </div>
    </section>
  );
}

function FeatureCard({
  icon: Icon,
  title,
  desc,
  index,
}: {
  icon: typeof MapPin;
  title: string;
  desc: string;
  index: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });
  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 24 }}
      animate={inView ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.5, delay: (index % 4) * 0.05 }}
      className="group relative rounded-2xl border border-border/60 bg-gradient-card p-6 shadow-soft overflow-hidden hover:border-primary/40 hover:shadow-glow transition-all"
    >
      <div className="absolute -top-24 -right-24 h-40 w-40 rounded-full bg-primary/10 blur-2xl opacity-0 group-hover:opacity-100 transition-opacity" />
      <div className="relative">
        <div className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-primary/15 text-primary">
          <Icon className="h-5 w-5" />
        </div>
        <h3 className="mt-5 font-display font-semibold text-lg">{title}</h3>
        <p className="mt-2 text-sm text-muted-foreground leading-relaxed">{desc}</p>
      </div>
    </motion.div>
  );
}

const STEPS = [
  {
    n: "01",
    title: "Set up the school",
    desc: "Add buses with their GPS tracker, routes and stops, then students and their parents. Parents and attendants get an activation code.",
    Icon: Users,
  },
  {
    n: "02",
    title: "The attendant checks in",
    desc: "On each trip the attendant opens the list, stop by stop, and taps each child On and Off. The tracker does the driving part by itself.",
    Icon: Play,
  },
  {
    n: "03",
    title: "Everyone sees it, live",
    desc: "Parents get boarded / arrived / dropped-off alerts and the bus ETA. The school sees every bus, every child and every alert.",
    Icon: LineChart,
  },
];

function HowItWorks() {
  return (
    <section
      id="how"
      className="relative py-24 md:py-32 border-t border-border/50 bg-gradient-to-b from-background via-card/20 to-background"
    >
      <div className="mx-auto max-w-6xl px-4">
        <div className="text-center max-w-2xl mx-auto">
          <SectionEyebrow icon={Clock}>How it works</SectionEyebrow>
          <h2 className="mt-4 font-display text-4xl md:text-5xl font-bold tracking-tighter">
            Three steps. That's it.
          </h2>
        </div>

        <div className="mt-16 grid md:grid-cols-3 gap-6 relative">
          <div
            className="hidden md:block absolute top-16 left-[15%] right-[15%] h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent"
            aria-hidden
          />
          {STEPS.map((s, i) => (
            <motion.div
              key={s.n}
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-80px" }}
              transition={{ duration: 0.6, delay: i * 0.1 }}
              className="relative"
            >
              <div className="relative mx-auto h-16 w-16 rounded-2xl bg-gradient-primary shadow-glow grid place-items-center text-primary-foreground">
                <s.Icon className="h-7 w-7" />
                <span className="absolute -top-2 -right-2 text-[11px] font-mono font-bold bg-background border border-border/60 text-primary rounded px-1.5 py-0.5">
                  {s.n}
                </span>
              </div>
              <h3 className="mt-5 font-display font-semibold text-xl text-center">{s.title}</h3>
              <p className="mt-2 text-sm text-muted-foreground text-center leading-relaxed max-w-xs mx-auto">
                {s.desc}
              </p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

const USE_CASES = [
  {
    title: "Schools (currently in pilot)",
    body: "Parents get a live map of their child's bus, arrival alerts at their stop, and a daily route history. Admins run the whole thing from one dashboard.",
    Icon: Users,
  },
  {
    title: "Delivery & logistics",
    body: "Track every van from depot to doorstep. Prove arrival times with historical route playback.",
    Icon: Truck,
  },
  {
    title: "Ride-share & field teams",
    body: "Give dispatchers live vehicle locations, engine and tamper alerts, plus daily PDF trip reports — same platform.",
    Icon: MapPin,
  },
];

function UseCases() {
  return (
    <section id="use-cases" className="relative py-24 md:py-32">
      <div className="mx-auto max-w-6xl px-4">
        <div className="text-center max-w-2xl mx-auto">
          <SectionEyebrow icon={Globe}>School buses first — every fleet next</SectionEyebrow>
          <h2 className="mt-4 font-display text-4xl md:text-5xl font-bold tracking-tighter">
            One platform, your fleet.
          </h2>
          <p className="mt-3 text-sm text-muted-foreground">
            Right now Live Track is live with a Kigali school. Every piece of it — the GPS trackers,
            the admin dashboard, the parent app — adapts to any operator that needs live visibility.
            If you're a school, a delivery company or a taxi fleet, ask us for your own instance.
          </p>
        </div>
        <div className="mt-14 grid md:grid-cols-3 gap-4">
          {USE_CASES.map((u, i) => (
            <motion.div
              key={u.title}
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-80px" }}
              transition={{ duration: 0.5, delay: i * 0.06 }}
              className="rounded-2xl border border-border/60 p-8 bg-gradient-card shadow-soft hover:shadow-glow transition-shadow"
            >
              <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/15 text-primary">
                <u.Icon className="h-6 w-6" />
              </div>
              <h3 className="mt-5 font-display font-semibold text-xl">{u.title}</h3>
              <p className="mt-2 text-sm text-muted-foreground leading-relaxed">{u.body}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

function FinalCTA() {
  return (
    <section className="relative py-24 md:py-32">
      <div className="mx-auto max-w-4xl px-4">
        <motion.div
          initial={{ opacity: 0, scale: 0.98 }}
          whileInView={{ opacity: 1, scale: 1 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.6 }}
          className="relative overflow-hidden rounded-3xl border border-border/60 p-12 md:p-16 text-center shadow-glow"
          style={{
            background:
              "linear-gradient(135deg, oklch(0.22 0.06 256) 0%, oklch(0.18 0.08 290) 100%)",
          }}
        >
          <div className="absolute inset-0 opacity-30">
            <AnimatedWorld />
          </div>
          <div className="relative">
            <h2 className="font-display text-4xl md:text-5xl font-bold tracking-tighter text-white">
              Every child, every trip, accounted for.
            </h2>
            <p className="mt-4 max-w-xl mx-auto text-lg text-white/70">
              Live Track is running with a school in Kigali. Book a walkthrough with the team, or
              sign in to your school's workspace.
            </p>
            <div className="mt-8 flex flex-col sm:flex-row gap-3 justify-center">
              <Button
                asChild
                size="lg"
                className="h-14 px-8 text-base bg-white text-[oklch(0.22_0.06_256)] hover:bg-white/90"
              >
                <Link to="/auth" className="inline-flex items-center gap-2">
                  Sign in to workspace <ChevronRight className="h-4 w-4" />
                </Link>
              </Button>
              <Button
                asChild
                size="lg"
                variant="outline"
                className="h-14 px-8 text-base border-white/30 bg-white/10 text-white hover:bg-white/20 hover:text-white"
              >
                <a href="#features">Explore features</a>
              </Button>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="border-t border-border/50 py-12">
      <div className="mx-auto max-w-6xl px-4 grid md:grid-cols-4 gap-8 items-start">
        <div>
          <Link to="/" className="flex items-center gap-2 font-display font-bold text-lg">
            <span className="h-8 w-8 grid place-items-center rounded-lg bg-gradient-primary shadow-glow">
              <MapPin className="h-4 w-4 text-primary-foreground" />
            </span>
            Live Track
          </Link>
          <p className="mt-3 text-sm text-muted-foreground max-w-xs">
            Live school-bus tracking and student check-in for schools and parents.
          </p>
        </div>
        <div className="text-sm">
          <div className="font-semibold mb-3">Product</div>
          <ul className="space-y-2 text-muted-foreground">
            <li>
              <a href="#features" className="hover:text-foreground transition-colors">
                Features
              </a>
            </li>
            <li>
              <a href="#how" className="hover:text-foreground transition-colors">
                How it works
              </a>
            </li>
            <li>
              <a href="#use-cases" className="hover:text-foreground transition-colors">
                Use cases
              </a>
            </li>
          </ul>
        </div>
        <div className="text-sm">
          <div className="font-semibold mb-3">Workspace</div>
          <ul className="space-y-2 text-muted-foreground">
            <li>
              <Link to="/auth" className="hover:text-foreground transition-colors">
                Sign in
              </Link>
            </li>
            <li>
              <Link to="/auth" className="hover:text-foreground transition-colors">
                Access workspace
              </Link>
            </li>
          </ul>
        </div>
        {PARENTS_ENABLED && (
          <div className="text-sm">
            <div className="font-semibold mb-3">For parents</div>
            <ul className="space-y-2 text-muted-foreground">
              <li>
                <Link to="/parent" className="hover:text-foreground transition-colors">
                  Parent sign in
                </Link>
              </li>
              <li>
                <Link to="/family" className="hover:text-foreground transition-colors">
                  Track my child
                </Link>
              </li>
            </ul>
          </div>
        )}
      </div>
      <div className="mt-10 pt-6 border-t border-border/50 mx-auto max-w-6xl px-4 flex flex-col sm:flex-row justify-between gap-2 text-xs text-muted-foreground">
        <div>© {new Date().getFullYear()} Live Track</div>
        <div>Made for schools and parents who need to know.</div>
      </div>
    </footer>
  );
}

function SectionEyebrow({
  children,
  icon: Icon,
}: {
  children: React.ReactNode;
  icon: typeof Sparkles;
}) {
  return (
    <div className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-card/60 backdrop-blur px-3 py-1 text-xs font-medium text-primary">
      <Icon className="h-3.5 w-3.5" />
      {children}
    </div>
  );
}
