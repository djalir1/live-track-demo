// Trip alerts on this device (web push). The phone asks once for permission,
// then gets a notification from gps-server whenever a vehicle starts a trip
// or parks with the engine off — even with the app closed.
//
//   this device ──subscribe──▶ push_subscriptions (Supabase)
//   device_status trigger ──▶ fleet_events ──▶ gps-server ──web push──▶ phone
//
// iPhone/iPad: web push only works once the app is added to the Home Screen
// (iOS 16.4+), so we say so instead of showing a button that can't work.
import { db } from "@/lib/fleet";

/** Must equal VAPID_PUBLIC_KEY in gps-server/.env (public, safe to ship). */
export const VAPID_PUBLIC_KEY =
  "BLE2ZvK-_Yi955L00R0jKj5qBvbRZaoDU6Q0AI3xdPhITeEQvdvrk2uImVH2VJNZ1Fub6_BK0lBKnS9AldFdNcE";

export type PushState =
  | "unsupported" // browser has no web push
  | "ios-install" // iPhone in Safari: add to Home Screen first
  | "denied" // blocked in browser / phone settings
  | "off" // allowed or not asked yet, but this device isn't subscribed
  | "on";

export interface AlertPrefs {
  trip_started: boolean;
  trip_ended: boolean;
}
export const DEFAULT_PREFS: AlertPrefs = { trip_started: true, trip_ended: true };

export function isIos() {
  const ua = navigator.userAgent;
  return /iPhone|iPad|iPod/.test(ua) || (ua.includes("Mac") && navigator.maxTouchPoints > 1);
}

export function isStandalone() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function supported() {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

async function registration() {
  // Production registers /sw.js on load (InstallPrompt); in dev only when
  // someone turns alerts on, so the dev server isn't cached by default.
  const existing = await navigator.serviceWorker.getRegistration("/");
  if (!existing) await navigator.serviceWorker.register("/sw.js");
  return navigator.serviceWorker.ready;
}

export async function getPushState(): Promise<PushState> {
  if (typeof window === "undefined") return "unsupported";
  if (isIos() && !isStandalone()) return "ios-install";
  if (!supported()) return "unsupported";
  if (Notification.permission === "denied") return "denied";
  if (Notification.permission !== "granted") return "off";
  const reg = await navigator.serviceWorker.getRegistration("/");
  const sub = await reg?.pushManager.getSubscription();
  return sub ? "on" : "off";
}

function keyBytes(b64url: string) {
  const b64 = b64url
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(Math.ceil(b64url.length / 4) * 4, "=");
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

function toB64url(buf: ArrayBuffer) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function save(sub: PushSubscription) {
  const json = sub.toJSON();
  const { error } = await db.rpc("save_push_subscription", {
    p_endpoint: sub.endpoint,
    p_p256dh: json.keys?.p256dh,
    p_auth: json.keys?.auth,
    p_user_agent: navigator.userAgent.slice(0, 300),
  });
  if (error) throw error;
}

/**
 * Ask for permission (must run from a tap — browsers block it otherwise),
 * subscribe this device and register it for the signed-in user.
 */
export async function enablePush(): Promise<PushState> {
  const state = await getPushState();
  if (state === "unsupported" || state === "ios-install" || state === "denied") return state;
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return permission === "denied" ? "denied" : "off";
  const reg = await registration();
  let sub = await reg.pushManager.getSubscription();
  // A subscription made with another server key can't receive our pushes.
  const current = sub?.options.applicationServerKey;
  if (sub && current && toB64url(current) !== VAPID_PUBLIC_KEY) {
    await sub.unsubscribe();
    sub = null;
  }
  sub ??= await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: keyBytes(VAPID_PUBLIC_KEY),
  });
  await save(sub);
  return "on";
}

/** Stop alerts on this device only (other phones of the same user keep them). */
export async function disablePush(): Promise<PushState> {
  const reg = await navigator.serviceWorker.getRegistration("/");
  const sub = await reg?.pushManager.getSubscription();
  if (sub) {
    await db.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
    await sub.unsubscribe();
  }
  return getPushState();
}

/**
 * Already allowed on this device: make sure the subscription is stored for
 * the user signed in now (after a re-install, account switch, or key change).
 */
export async function resyncPush() {
  if ((await getPushState()) !== "on") return;
  const reg = await navigator.serviceWorker.getRegistration("/");
  const sub = await reg?.pushManager.getSubscription();
  if (sub) await save(sub).catch(() => {});
}

export async function loadPrefs(userId: string): Promise<AlertPrefs> {
  const { data, error } = await db
    .from("notification_prefs")
    .select("trip_started, trip_ended")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return (data as AlertPrefs | null) ?? DEFAULT_PREFS;
}

export async function savePrefs(userId: string, prefs: AlertPrefs) {
  const { error } = await db
    .from("notification_prefs")
    .upsert({ user_id: userId, ...prefs, updated_at: new Date().toISOString() });
  if (error) throw error;
}

export async function sendTestAlert() {
  const { error } = await db.rpc("send_test_notification");
  if (error) throw error;
}
