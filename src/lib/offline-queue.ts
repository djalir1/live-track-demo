// Attendant check-ins that work without network.
//
// Every tap gets a client_id and its real time + place. If the call fails
// because the phone is offline, it waits here (localStorage) and is sent when
// the network is back. mark_student() ignores a client_id it has already
// saved, so a retry can never double a check-in.
import { db } from "@/lib/fleet";

export interface PendingMark {
  client_id: string;
  trip_id: string;
  student_id: string;
  action: "board" | "drop" | "not_here" | "undo";
  lat: number | null;
  lng: number | null;
  at: string;
  method: "manual" | "card" | "fingerprint" | "face";
}

const KEY = "lt-pending-marks";

export function loadPending(): PendingMark[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "[]") as PendingMark[];
  } catch {
    return [];
  }
}

function save(list: PendingMark[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* storage full / blocked: the mark stays in memory for this session */
  }
}

export function newClientId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) =>
        (Number(c) ^ ((Math.random() * 16) >> (Number(c) / 4))).toString(16),
      );
}

/** A network problem (retry later), as opposed to a refusal from the server. */
export function isNetworkError(e: unknown): boolean {
  const m = e instanceof Error ? e.message : String((e as { message?: string })?.message ?? e);
  return (
    (typeof navigator !== "undefined" && navigator.onLine === false) ||
    /fetch|network|load failed|timed? ?out/i.test(m)
  );
}

export async function sendMark(m: PendingMark) {
  const { data, error } = await db.rpc("mark_student", {
    p_trip: m.trip_id,
    p_student: m.student_id,
    p_action: m.action,
    p_lat: m.lat,
    p_lng: m.lng,
    p_at: m.at,
    p_client_id: m.client_id,
    p_method: m.method,
  });
  if (error) throw error;
  return data as { status: string; wrong_bus?: boolean; duplicate?: boolean };
}

export function enqueue(m: PendingMark) {
  save([...loadPending().filter((x) => x.client_id !== m.client_id), m]);
}

/** Sends everything waiting, oldest first. Returns how many are still waiting. */
export async function flushPending(): Promise<{ sent: number; left: number; refused: string[] }> {
  const list = loadPending().sort((a, b) => a.at.localeCompare(b.at));
  const left: PendingMark[] = [];
  const refused: string[] = [];
  let sent = 0;
  for (const m of list) {
    try {
      await sendMark(m);
      sent++;
    } catch (e) {
      if (isNetworkError(e)) left.push(m);
      else
        refused.push(e instanceof Error ? e.message : String((e as { message?: string }).message));
    }
  }
  save(left);
  return { sent, left: left.length, refused };
}
