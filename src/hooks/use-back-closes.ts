import { useEffect } from "react";

// Phone "Back" (Android back button, iPhone swipe-back in the installed app)
// closes the open sheet or dialog instead of leaving the screen — before this,
// a parent who opened Settings in the installed app had no obvious way out.
//
// While an overlay is open we add one history entry. Going back removes it and
// we close the overlay by sending Escape (Radix closes the top-most layer on
// Escape). Closing it any other way (X, Done, tapping outside) removes the
// entry again so Back keeps working normally afterwards.
const MARK = "__ltOverlay";

export function useBackCloses() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    const id = Math.random().toString(36).slice(2);
    let pushed = false;
    let closedByBack = false;
    // Deferred so React StrictMode's mount → unmount → mount in development
    // does not push two entries.
    const t = window.setTimeout(() => {
      window.history.pushState({ ...(window.history.state ?? {}), [MARK]: id }, "");
      pushed = true;
    }, 0);
    const onPop = () => {
      if (!pushed || closedByBack) return;
      if ((window.history.state as Record<string, unknown> | null)?.[MARK] === id) return;
      closedByBack = true;
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    };
    window.addEventListener("popstate", onPop);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("popstate", onPop);
      // Closed with X / Done / outside tap: drop our entry, but only if we are
      // still on it (not after a link inside the overlay changed the page).
      if (
        pushed &&
        !closedByBack &&
        (window.history.state as Record<string, unknown> | null)?.[MARK] === id
      ) {
        window.history.back();
      }
    };
  }, []);
}

/** Drop-in element for overlay contents: <BackCloses /> */
export function BackCloses() {
  useBackCloses();
  return null;
}
