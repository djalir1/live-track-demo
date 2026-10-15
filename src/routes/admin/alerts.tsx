import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";
import {
  BellRing,
  BellOff,
  Loader2,
  Send,
  Smartphone,
  KeyRound,
  ParkingSquare,
  Share,
  ShieldAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { AdminShell } from "@/components/AdminShell";
import { useAuth } from "@/lib/auth-context";
import { db } from "@/lib/fleet";
import { friendlyError } from "@/lib/friendly-errors";
import { fmtDateTime } from "@/lib/time";
import {
  DEFAULT_PREFS,
  disablePush,
  enablePush,
  getDelivery,
  getPushState,
  loadPrefs,
  savePrefs,
  sendTestAlert,
  type AlertPrefs,
  type Delivery,
  type PushState,
} from "@/lib/push";

export const Route = createFileRoute("/admin/alerts")({
  head: () => ({ meta: [{ title: "Alerts — Live Track" }] }),
  component: AlertsPage,
});

interface FleetEvent {
  id: number;
  kind: "trip_started" | "trip_ended" | "test" | "gps_tamper" | "gps_offline" | "gps_back";
  detail: string | null;
  vehicle_label: string | null;
  plate: string | null;
  driver_name: string | null;
  route_name: string | null;
  distance_m: number | null;
  occurred_at: string;
  pushed_at: string | null;
}

const KINDS: { key: keyof AlertPrefs; title: string; text: string; Icon: typeof KeyRound }[] = [
  {
    key: "trip_started",
    title: "Trip started",
    text: "The engine turns on. Buses on a route say which run: morning pickup or afternoon drop-off.",
    Icon: KeyRound,
  },
  {
    key: "trip_ended",
    title: "Parked, engine off",
    text: "The run is over: ignition off for 90 seconds. Red lights and traffic jams don't count.",
    Icon: ParkingSquare,
  },
  {
    key: "gps_tamper",
    title: "GPS tracker unplugged or removed",
    text: "The tracker loses the vehicle's power, reports being taken off, or stops reporting for 30 minutes. Also tells you when it's back.",
    Icon: ShieldAlert,
  },
];

const EVENT_ICON: Record<FleetEvent["kind"], string> = {
  trip_started: "🚌",
  trip_ended: "🅿️",
  test: "🔔",
  gps_tamper: "⚠️",
  gps_offline: "📵",
  gps_back: "✅",
};

function eventTitle(e: FleetEvent) {
  if (e.kind === "test") return "Test alert";
  const v = `${e.vehicle_label ?? e.plate ?? "Vehicle"}${e.plate && e.vehicle_label ? ` (${e.plate})` : ""}`;
  switch (e.kind) {
    case "trip_started":
      return `${v} started a trip`;
    case "trip_ended":
      return `${v} parked`;
    case "gps_tamper":
      return `${v}: ${(e.detail ?? "GPS tracker unplugged").split(": ")[0]}`;
    case "gps_offline":
      return `${v}: GPS tracker silent since ${e.detail ?? "?"}`;
    case "gps_back":
      return `${v}: ${e.detail ?? "GPS tracker back"}`;
  }
}

function AlertsPage() {
  const { user } = useAuth();
  const [state, setState] = useState<PushState | null>(null);
  const [prefs, setPrefs] = useState<AlertPrefs>(DEFAULT_PREFS);
  const [busy, setBusy] = useState(false);
  const [events, setEvents] = useState<FleetEvent[]>([]);
  const [setupMissing, setSetupMissing] = useState(false);
  const [delivery, setDelivery] = useState<Delivery | null>(null);

  useEffect(() => {
    void getPushState().then(setState);
  }, []);

  useEffect(() => {
    if (state === "on") void getDelivery().then(setDelivery);
  }, [state]);

  useEffect(() => {
    if (!user) return;
    loadPrefs(user.id)
      .then(setPrefs)
      .catch((e) => {
        if (/notification_prefs|PGRST205|does not exist/i.test(String(e?.message)))
          setSetupMissing(true);
      });

    const load = () =>
      db
        .from("fleet_events")
        .select("*")
        .order("occurred_at", { ascending: false })
        .limit(20)
        .then(({ data, error }) => {
          if (!error) setEvents(data as FleetEvent[]);
        });
    void load();
    const ch = db
      .channel("alerts-page")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "fleet_events" },
        () => void load(),
      )
      .subscribe();
    return () => {
      void db.removeChannel(ch);
    };
  }, [user]);

  async function run(fn: () => Promise<PushState>, okMsg: string) {
    setBusy(true);
    try {
      const s = await fn();
      setState(s);
      if (s === "denied")
        toast.error("Notifications are blocked for this site — see the steps below.");
      else toast.success(okMsg);
    } catch (e) {
      toast.error(friendlyError(e, "Couldn't change alerts on this device."));
    } finally {
      setBusy(false);
    }
  }

  async function toggle(key: keyof AlertPrefs, value: boolean) {
    if (!user) return;
    const next = { ...prefs, [key]: value };
    setPrefs(next);
    try {
      await savePrefs(user.id, next);
    } catch (e) {
      setPrefs(prefs);
      toast.error(friendlyError(e, "Couldn't save that setting."));
    }
  }

  async function test() {
    try {
      await sendTestAlert();
      toast.success("Test sent — it should arrive within a few seconds.");
      // The server tries within ~5 s; then show whether this phone accepted it.
      window.setTimeout(() => void getDelivery().then(setDelivery), 9000);
    } catch (e) {
      toast.error(friendlyError(e, "Couldn't send a test right now."));
    }
  }

  return (
    <AdminShell>
      <div className="max-w-2xl mx-auto space-y-4">
        {setupMissing && (
          <Card>
            <div className="text-sm text-destructive">
              Alerts aren't set up on the server yet: run the migration{" "}
              <code className="font-mono text-xs">20261015120000_trip_notifications.sql</code> in
              Supabase.
            </div>
          </Card>
        )}

        <Card>
          <div className="flex items-start gap-3">
            <span className="h-10 w-10 shrink-0 grid place-items-center rounded-xl bg-primary/15 text-primary">
              <Smartphone className="h-5 w-5" />
            </span>
            <div className="flex-1 min-w-0 space-y-1">
              <div className="text-sm font-semibold">This phone</div>
              <DeviceStatus state={state} />
              {state === "on" && <DeliveryNote d={delivery} />}
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {state === "on" ? (
              <>
                <Button variant="outline" size="sm" onClick={test}>
                  <Send className="h-4 w-4 mr-1.5" /> Send a test
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() => run(disablePush, "Alerts off on this phone")}
                >
                  <BellOff className="h-4 w-4 mr-1.5" /> Turn off on this phone
                </Button>
              </>
            ) : state === "off" ? (
              <Button
                size="sm"
                disabled={busy}
                className="bg-gradient-primary shadow-glow"
                onClick={() => run(enablePush, "Trip alerts are on for this phone")}
              >
                {busy ? (
                  <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                ) : (
                  <BellRing className="h-4 w-4 mr-1.5" />
                )}
                Turn on alerts
              </Button>
            ) : null}
          </div>
        </Card>

        <Card>
          <div className="text-sm font-semibold mb-1">What to notify me about</div>
          <p className="text-xs text-muted-foreground mb-3">
            Applies to every phone you've turned alerts on for.
          </p>
          <div className="divide-y divide-border/50">
            {KINDS.map(({ key, title, text, Icon }) => (
              <label key={key} className="flex items-center gap-3 py-3 cursor-pointer">
                <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium">{title}</div>
                  <div className="text-xs text-muted-foreground">{text}</div>
                </div>
                <Switch checked={prefs[key]} onCheckedChange={(v) => toggle(key, v)} />
              </label>
            ))}
          </div>
        </Card>

        <Card>
          <div className="text-sm font-semibold mb-2">Recent alerts</div>
          {events.length === 0 ? (
            <div className="text-xs text-muted-foreground py-4 text-center">
              Nothing yet. Alerts appear here when a vehicle starts a trip or parks.
            </div>
          ) : (
            <ul className="space-y-1.5">
              {events.map((e) => (
                <li
                  key={e.id}
                  className="flex items-center gap-2 text-sm rounded-lg border border-border/50 bg-background/40 px-3 py-2"
                >
                  <span className="shrink-0">{EVENT_ICON[e.kind] ?? "🔔"}</span>
                  <div className="flex-1 min-w-0">
                    <div className="truncate font-medium">{eventTitle(e)}</div>
                    <div className="text-[11px] text-muted-foreground truncate">
                      {fmtDateTime(e.occurred_at)}
                      {e.route_name ? ` · ${e.route_name}` : ""}
                      {e.driver_name ? ` · ${e.driver_name}` : ""}
                      {e.kind === "trip_ended" && e.distance_m
                        ? ` · ${(e.distance_m / 1000).toFixed(1)} km`
                        : ""}
                      {!e.pushed_at ? " · sending…" : ""}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </AdminShell>
  );
}

function Card({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-2xl bg-gradient-card border border-border/60 shadow-soft p-4">
      {children}
    </div>
  );
}

/** Did the server's last alert reach this phone? (written by gps-server) */
function DeliveryNote({ d }: { d: Delivery | null }) {
  if (!d) return null;
  const failedLast =
    d.last_error && d.last_error_at && (!d.last_ok_at || d.last_error_at > d.last_ok_at);
  if (failedLast)
    return (
      <p className="text-xs text-destructive">
        The last alert couldn't be delivered to this phone ({fmtDateTime(d.last_error_at!)}):{" "}
        {d.last_error}. Turn alerts off and on again here; if it keeps failing, tell support.
      </p>
    );
  if (d.last_ok_at)
    return (
      <p className="text-xs text-muted-foreground">
        Last alert delivered {fmtDateTime(d.last_ok_at)}.
      </p>
    );
  return null;
}

function DeviceStatus({ state }: { state: PushState | null }) {
  const p = "text-xs text-muted-foreground";
  switch (state) {
    case null:
      return <p className={p}>Checking…</p>;
    case "on":
      return (
        <p className="text-xs text-[color:var(--moving)]">
          Alerts are on. You'll get a notification even when the app is closed.
        </p>
      );
    case "off":
      return (
        <p className={p}>
          Alerts are off. Tap the button, then choose <b>Allow</b> when your phone asks.
        </p>
      );
    case "denied":
      return (
        <p className={p}>
          Notifications are blocked for Live Track. Open your browser's site settings (the lock icon
          next to the address, or phone Settings → Apps → your browser → Notifications), allow them,
          then reload this page.
        </p>
      );
    case "ios-install":
      return (
        <p className={p}>
          On iPhone, alerts work once Live Track is on your Home Screen: tap{" "}
          <Share className="inline h-3.5 w-3.5" /> Share → <b>Add to Home Screen</b>, open it from
          there and come back to this page.
        </p>
      );
    case "unsupported":
      return (
        <p className={p}>
          This browser can't receive notifications. Use Chrome on Android, or the installed app on
          iPhone.
        </p>
      );
  }
}
