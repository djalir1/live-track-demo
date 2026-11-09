import { useEffect, useState } from "react";
import { Download, Share, X } from "lucide-react";
import { Button } from "@/components/ui/button";

// Registers the service worker and offers "Add to home screen":
// Android/desktop Chrome get the native install prompt; iPhone Safari has no
// prompt API, so it gets the Share → "Add to Home Screen" hint instead.

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const DISMISS_KEY = "lt-install-dismissed-at";
const DISMISS_FOR_MS = 14 * 86_400_000;

function recentlyDismissed() {
  try {
    return Date.now() - Number(localStorage.getItem(DISMISS_KEY) ?? 0) < DISMISS_FOR_MS;
  } catch {
    return false;
  }
}

function isStandalone() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export function InstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [iosHint, setIosHint] = useState(false);

  useEffect(() => {
    if (import.meta.env.PROD && "serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
    if (isStandalone() || recentlyDismissed()) return;

    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);

    const ua = navigator.userAgent;
    const ios = /iPhone|iPad|iPod/.test(ua) || (ua.includes("Mac") && navigator.maxTouchPoints > 1);
    const t = ios ? window.setTimeout(() => setIosHint(true), 4000) : undefined;

    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      if (t) window.clearTimeout(t);
    };
  }, []);

  function dismiss() {
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      /* private mode: just hide for now */
    }
    setDeferred(null);
    setIosHint(false);
  }

  async function install() {
    if (!deferred) return;
    await deferred.prompt();
    await deferred.userChoice.catch(() => null);
    setDeferred(null);
  }

  if (!deferred && !iosHint) return null;

  return (
    <div className="fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-40 sm:left-auto sm:right-4 sm:w-96">
      <div className="rounded-2xl border border-border/60 bg-background/95 backdrop-blur-xl shadow-soft p-3 flex items-center gap-3">
        <img src="/icons/icon-192.png" alt="" className="h-11 w-11 rounded-xl shrink-0" />
        <div className="flex-1 min-w-0 text-sm">
          <div className="font-semibold">Install Live Track</div>
          {deferred ? (
            <div className="text-xs text-muted-foreground">
              Open it from your home screen like an app.
            </div>
          ) : (
            <div className="text-xs text-muted-foreground">
              Tap <Share className="inline h-3.5 w-3.5 -mt-0.5" /> Share, then{" "}
              <b>Add to Home Screen</b>.
            </div>
          )}
        </div>
        {deferred && (
          <Button size="sm" onClick={install} className="bg-gradient-primary shrink-0">
            <Download className="h-4 w-4 mr-1" /> Install
          </Button>
        )}
        <button
          onClick={dismiss}
          aria-label="Not now"
          className="p-1.5 rounded-lg text-muted-foreground hover:bg-accent shrink-0"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
