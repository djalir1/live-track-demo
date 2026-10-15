import { useEffect, useState } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { BellRing, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useAuth, canManageSchoolSetup } from "@/lib/auth-context";
import { enablePush, getPushState, resyncPush } from "@/lib/push";
import { friendlyError } from "@/lib/friendly-errors";

// Asks owners (admin / school_admin) to turn on trip alerts on this phone.
// The system "Allow notifications?" dialog can only be opened from a tap, so
// this card is the tap; it then hands over to the phone's own prompt.

const DISMISS_KEY = "lt-alerts-dismissed-at";
const DISMISS_FOR_MS = 3 * 86_400_000;

function recentlyDismissed() {
  try {
    return Date.now() - Number(localStorage.getItem(DISMISS_KEY) ?? 0) < DISMISS_FOR_MS;
  } catch {
    return false;
  }
}

export function NotificationPrompt() {
  const { user, role } = useAuth();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const owner = !!user && canManageSchoolSetup(role);

  useEffect(() => {
    if (!owner) {
      setShow(false);
      return;
    }
    let alive = true;
    void getPushState().then((s) => {
      if (!alive) return;
      if (s === "on") void resyncPush();
      setShow(s === "off" && !recentlyDismissed());
    });
    return () => {
      alive = false;
    };
  }, [owner, user?.id]);

  function dismiss() {
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      /* private mode */
    }
    setShow(false);
  }

  async function turnOn() {
    setBusy(true);
    try {
      const s = await enablePush();
      if (s === "on") {
        toast.success("Trip alerts are on for this phone");
        setShow(false);
      } else if (s === "denied") {
        toast.error("Notifications are blocked. Allow them for this site in your phone settings.");
        setShow(false);
      }
    } catch (e) {
      toast.error(friendlyError(e, "Couldn't turn on alerts right now."));
    } finally {
      setBusy(false);
    }
  }

  // The Alerts page has its own controls.
  if (!show || path.startsWith("/admin/alerts")) return null;

  return (
    <div className="fixed inset-x-3 top-[max(4.5rem,calc(env(safe-area-inset-top)+4rem))] z-[1000] sm:left-auto sm:right-4 sm:w-96">
      <div className="rounded-2xl border border-primary/40 bg-background/95 backdrop-blur-xl shadow-soft p-3 flex items-start gap-3">
        <span className="h-10 w-10 shrink-0 grid place-items-center rounded-xl bg-primary/15 text-primary">
          <BellRing className="h-5 w-5" />
        </span>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold">Get trip alerts on this phone</div>
          <p className="text-xs text-muted-foreground mt-0.5">
            Know when a bus starts a trip and when it parks with the engine off.{" "}
            <Link to="/admin/alerts" className="underline underline-offset-2">
              Settings
            </Link>
          </p>
          <div className="mt-2 flex gap-2">
            <Button
              size="sm"
              onClick={turnOn}
              disabled={busy}
              className="bg-gradient-primary shadow-glow h-8"
            >
              {busy && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
              Turn on
            </Button>
            <Button size="sm" variant="ghost" onClick={dismiss} className="h-8">
              Not now
            </Button>
          </div>
        </div>
        <button
          onClick={dismiss}
          className="p-1 rounded hover:bg-accent/50 text-muted-foreground"
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
