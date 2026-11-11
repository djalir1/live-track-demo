import { useEffect, useState } from "react";
import { BellOff, BellRing, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DEMO_MODE } from "@/lib/demo";
import { friendlyError } from "@/lib/friendly-errors";
import {
  enablePush,
  getPushState,
  resyncPush,
  sendDemoTestAlert,
  type PushState,
} from "@/lib/push";

// Top of the parent's home screen: one clear place to turn phone alerts on.
// (It used to be hidden in Settings, so most parents never found it.)
// In the demo, once alerts are on, a "Send a test" button proves they arrive.

export function ParentPushCard() {
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void getPushState().then((s) => {
      setState(s);
      // Same phone, another account (or a new server key): move the alerts here.
      if (s === "on") void resyncPush();
    });
  }, []);

  if (state == null || state === "unsupported") return null;
  if (state === "on" && !DEMO_MODE) return null;

  async function turnOn() {
    setBusy(true);
    try {
      const s = await enablePush();
      setState(s);
      if (s === "on") toast.success("Notifications are on for this phone");
    } catch (e) {
      toast.error(friendlyError(e, "Couldn't turn on notifications right now."));
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    setBusy(true);
    try {
      await sendDemoTestAlert();
      toast.info("Test sent. Lock your phone or leave the app: it arrives in a few seconds.");
    } catch (e) {
      toast.error(friendlyError(e, "Couldn't send the test."));
    } finally {
      setBusy(false);
    }
  }

  const on = state === "on";
  return (
    <section
      className={`rounded-2xl border p-3.5 flex items-center gap-3 ${on ? "border-success/40 bg-success/10" : "border-primary/40 bg-primary/10"}`}
    >
      <span
        className={`h-10 w-10 shrink-0 rounded-xl grid place-items-center ${on ? "bg-success/20 text-success" : "bg-primary/20 text-primary"}`}
      >
        {state === "denied" ? <BellOff className="h-5 w-5" /> : <BellRing className="h-5 w-5" />}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold">
          {on
            ? "Notifications are on for this phone"
            : state === "denied"
              ? "Notifications are blocked"
              : "Get alerts on this phone"}
        </div>
        <p className="text-xs text-muted-foreground">
          {on
            ? "You are told when the bus starts, reaches your stop and when your child gets on or off."
            : state === "ios-install"
              ? "On iPhone: tap Share → Add to Home Screen, open Live Track from there, then turn alerts on."
              : state === "denied"
                ? "Allow notifications for this site in your phone's settings, then come back."
                : "Know when the bus starts, reaches your stop and when your child gets on or off — even with the app closed."}
        </p>
      </div>
      {state === "off" && (
        <Button size="sm" onClick={() => void turnOn()} disabled={busy}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Turn on"}
        </Button>
      )}
      {on && (
        <Button size="sm" variant="outline" onClick={() => void test()} disabled={busy}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Send a test"}
        </Button>
      )}
    </section>
  );
}
