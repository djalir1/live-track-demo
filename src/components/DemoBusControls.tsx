import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  ChevronDown,
  FlaskConical,
  Loader2,
  MapPin,
  ParkingCircle,
  Pause,
  Play,
  RotateCcw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { db } from "@/lib/fleet";
import { DEMO_MODE } from "@/lib/demo";
import { friendlyError } from "@/lib/friendly-errors";
import { cn } from "@/lib/utils";

// Demo only. The demo buses have no real GPS tracker: these buttons play the
// driver. Drive / Stop / Park a bus, or put it at a stop, and the live map,
// "bus is at your stop" alerts and engine alerts react as with a real bus.
// (supabase/demo/demo_controls.sql: demo_bus_control, demo_restart_today.)

type Mode = "drive" | "stopped" | "off";
interface BusLite {
  id: string;
  label: string | null;
  plate: string | null;
  route_id: string | null;
}
interface StopLite {
  id: string;
  name: string;
  sequence: number | null;
  type: string;
  route_id: string;
}

const MODES: { mode: Mode; label: string; state: string; Icon: typeof Play }[] = [
  { mode: "drive", label: "Drive", state: "Driving its route", Icon: Play },
  { mode: "stopped", label: "Stop", state: "Stopped · engine on", Icon: Pause },
  { mode: "off", label: "Park", state: "Parked · engine off", Icon: ParkingCircle },
];

export function DemoBusControls({
  schoolId,
  busId,
  collapsible,
  className,
}: {
  /** All buses of this school… */
  schoolId?: string | null;
  /** …or just this one (bus attendant). */
  busId?: string | null;
  /** Start folded (small screens): tap the title to open. */
  collapsible?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(!collapsible);
  const [buses, setBuses] = useState<BusLite[]>([]);
  const [stops, setStops] = useState<StopLite[]>([]);
  const [modes, setModes] = useState<Record<string, Mode>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const loadModes = useCallback(async () => {
    const { data } = await db.from("demo_sim").select("bus_id, mode");
    if (data)
      setModes(
        Object.fromEntries(
          (data as { bus_id: string; mode: Mode }[]).map((r) => [r.bus_id, r.mode]),
        ),
      );
  }, []);

  useEffect(() => {
    if (!DEMO_MODE || (!schoolId && !busId)) return;
    let alive = true;
    void (async () => {
      let q = db.from("buses").select("id, label, plate, route_id").order("label");
      q = busId ? q.eq("id", busId) : q.eq("school_id", schoolId);
      const { data: b } = await q;
      const list = (b ?? []) as BusLite[];
      const routes = list.map((x) => x.route_id).filter(Boolean);
      const { data: s } = routes.length
        ? await db
            .from("stops")
            .select("id, name, sequence, type, route_id")
            .in("route_id", routes)
            .not("lat", "is", null)
            .order("sequence")
        : { data: [] };
      if (!alive) return;
      setBuses(list);
      setStops((s ?? []) as StopLite[]);
      void loadModes();
    })();
    const t = window.setInterval(() => void loadModes(), 5000);
    return () => {
      alive = false;
      window.clearInterval(t);
    };
  }, [schoolId, busId, loadModes]);

  if (!DEMO_MODE || buses.length === 0) return null;

  async function control(bus: BusLite, action: Mode | "goto", stop?: StopLite) {
    setBusy(`${bus.id}:${stop?.id ?? action}`);
    const { error } = await db.rpc("demo_bus_control", {
      p_bus: bus.id,
      p_action: action,
      p_stop: stop?.id ?? null,
    });
    setBusy(null);
    if (error) return toast.error(friendlyError(error, "Couldn't move the bus"));
    const name = bus.label ?? "Bus";
    toast.success(
      action === "goto"
        ? `${name} is now at ${stop!.name}`
        : action === "drive"
          ? `${name} is driving its route`
          : action === "stopped"
            ? `${name} stopped (engine on)`
            : `${name} is parked (engine off)`,
    );
    void loadModes();
  }

  async function restart() {
    const what = busId ? "this bus's trips" : "all of today's trips";
    if (!window.confirm(`Delete ${what} for today so you can show them again?`)) return;
    setBusy("restart");
    const { error } = await db.rpc("demo_restart_today", { p_bus: busId ?? null });
    setBusy(null);
    if (error) return toast.error(friendlyError(error, "Couldn't restart today"));
    toast.success("Today starts fresh — morning and afternoon are free again");
    window.setTimeout(() => window.location.reload(), 700);
  }

  return (
    <section
      className={cn(
        "rounded-2xl border border-dashed border-warning/60 bg-warning/5 p-4 text-left",
        className,
      )}
    >
      <button
        type="button"
        className="flex w-full items-start gap-2.5 text-left"
        onClick={() => collapsible && setOpen((o) => !o)}
        aria-expanded={open}
      >
        <span className="h-8 w-8 shrink-0 rounded-lg bg-warning/20 text-warning grid place-items-center">
          <FlaskConical className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="font-display font-semibold leading-tight">Demo: drive the bus</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            There is no real bus here, so you play the driver. Parents get the same alerts as with a
            real GPS tracker.
          </p>
        </div>
        {collapsible && (
          <ChevronDown
            className={cn(
              "h-5 w-5 mt-1 text-muted-foreground transition-transform",
              open && "rotate-180",
            )}
          />
        )}
      </button>

      <div
        className={cn("mt-3 grid gap-3", buses.length > 1 && "lg:grid-cols-3", !open && "hidden")}
      >
        {buses.map((bus) => {
          const mode = modes[bus.id];
          const state = MODES.find((m) => m.mode === mode);
          const busStops = stops.filter((s) => s.route_id === bus.route_id);
          return (
            <div key={bus.id} className="rounded-xl border border-border bg-card p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="font-medium truncate">
                  {bus.label ?? "Bus"}
                  {bus.plate && (
                    <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                      {bus.plate}
                    </span>
                  )}
                </div>
                <span
                  className={cn(
                    "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium",
                    mode === "drive"
                      ? "bg-success/15 text-success"
                      : mode === "stopped"
                        ? "bg-warning/20 text-warning"
                        : "bg-muted text-muted-foreground",
                  )}
                >
                  {state?.state ?? "…"}
                </span>
              </div>

              <div className="mt-2.5 grid grid-cols-3 gap-1.5">
                {MODES.map((m) => (
                  <Button
                    key={m.mode}
                    size="sm"
                    variant={mode === m.mode ? "default" : "outline"}
                    className="h-10"
                    disabled={busy != null}
                    onClick={() => void control(bus, m.mode)}
                  >
                    {busy === `${bus.id}:${m.mode}` ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <>
                        <m.Icon className="h-4 w-4 mr-1.5" />
                        {m.label}
                      </>
                    )}
                  </Button>
                ))}
              </div>

              {busStops.length > 0 && (
                <>
                  <div className="mt-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Put the bus at a stop
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {busStops.map((s, i) => (
                      <button
                        key={s.id}
                        type="button"
                        disabled={busy != null}
                        onClick={() => void control(bus, "goto", s)}
                        className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-2.5 py-1.5 text-xs hover:border-primary hover:text-primary disabled:opacity-50"
                      >
                        {busy === `${bus.id}:${s.id}` ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : s.type === "school" ? (
                          <MapPin className="h-3 w-3" />
                        ) : (
                          <span className="font-semibold tabular-nums">{i + 1}</span>
                        )}
                        {s.type === "school" ? "School" : s.name}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>

      <div
        className={cn("mt-3 flex items-center justify-between gap-3 flex-wrap", !open && "hidden")}
      >
        <p className="text-xs text-muted-foreground">
          Trip finished? Start the day again to show it once more.
        </p>
        <Button size="sm" variant="outline" disabled={busy != null} onClick={() => void restart()}>
          <RotateCcw className="h-4 w-4 mr-1.5" />
          Start today again
        </Button>
      </div>
    </section>
  );
}
