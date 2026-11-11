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
import { DEMO_MODE } from "@/lib/demo";

/** Must equal VAPID_PUBLIC_KEY in gps-server/.env (public, safe to ship). */
export const VAPID_PUBLIC_KEY =
  "BLE2ZvK-_Yi955L00R0jKj5qBvbRZaoDU6Q0AI3xdPhITeEQvdvrk2uImVH2VJNZ1Fub6_BK0lBKnS9AldFdNcE";

// The demo has no gps-server: its pushes are sent by /api/demo-push with the
// demo's own key pair, so the public key is asked from there.
let demoKey: string | null = null;
async function serverKey(): Promise<string> {
  if (!DEMO_MODE) return VAPID_PUBLIC_KEY;
  if (!demoKey) {
    const res = await fetch("/api/demo-push?key=1");
    const body = (await res.json().catch(() => ({}))) as { publicKey?: string };
    if (!body.publicKey) throw new Error("Notifications are not set up on this demo yet.");
    demoKey = body.publicKey;
  }
  return demoKey;
}

export type PushState =
  | "unsupported" // browser has no web push
  | "ios-install" // iPhone in Safari: add to Home Screen first
  | "denied" // blocked in browser / phone settings
  | "off" // allowed or not asked yet, but this device isn't subscribed
  | "on";

export interface AlertPrefs {
  trip_started: boolean;
  trip_ended: boolean;
  /** GPS tracker unplugged / removed / silent, and back again. */
  gps_tamper: boolean;
}
export const DEFAULT_PREFS: AlertPrefs = { trip_started: true, trip_ended: true, gps_tamper: true };

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
  await save(await subscribe());
  return "on";
}

/** This device's subscription for the current server key (made if needed). */
async function subscribe(): Promise<PushSubscription> {
  const key = await serverKey();
  const reg = await registration();
  let sub = await reg.pushManager.getSubscription();
  // A subscription made with another server key can't receive our pushes.
  const current = sub?.options.applicationServerKey;
  if (sub && current && toB64url(current) !== key) {
    await db.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
    await sub.unsubscribe();
    sub = null;
  }
  sub ??= await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: keyBytes(key),
  });
  return sub;
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
  await subscribe()
    .then(save)
    .catch(() => {});
}

export async function loadPrefs(userId: string): Promise<AlertPrefs> {
  const { data, error } = await db
    .from("notification_prefs")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return { ...DEFAULT_PREFS, ...((data as Partial<AlertPrefs> | null) ?? {}) };
}

export async function savePrefs(userId: string, prefs: AlertPrefs) {
  const { error } = await db
    .from("notification_prefs")
    .upsert({ user_id: userId, ...prefs, updated_at: new Date().toISOString() });
  if (error) throw error;
}

export interface Delivery {
  last_ok_at: string | null;
  last_error: string | null;
  last_error_at: string | null;
}

/** How the last alerts to this device went (set by gps-server). */
export async function getDelivery(): Promise<Delivery | null> {
  const reg = await navigator.serviceWorker.getRegistration("/");
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return null;
  const { data } = await db
    .from("push_subscriptions")
    .select("*")
    .eq("endpoint", sub.endpoint)
    .maybeSingle();
  if (!data) return null;
  const d = data as Partial<Delivery>;
  return {
    last_ok_at: d.last_ok_at ?? null,
    last_error: d.last_error ?? null,
    last_error_at: d.last_error_at ?? null,
  };
}

/** Demo only: a test alert to the signed-in parent (in the app and as phone push). */
export async function sendDemoTestAlert() {
  const { error } = await db.rpc("demo_test_notification");
  if (error) throw error;
}

export async function sendTestAlert() {
  const { error } = await db.rpc("send_test_notification");
  if (error) throw error;
}
