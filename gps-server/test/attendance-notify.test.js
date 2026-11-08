// Parent and school attendance alerts are pushed once, old ones are skipped,
// and a database without the attendance tables leaves the server idle.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createAttendanceNotifier } from "../src/attendance-notify.js";

function fakeDb({ missing = false } = {}) {
  const patched = [];
  const now = new Date().toISOString();
  const old = new Date(Date.now() - 3_600_000).toISOString();
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    const json = (x, status = 200) => new Response(JSON.stringify(x), { status });
    if (missing) return new Response('{"code":"PGRST205"}', { status: 404 });
    if (u.includes("rpc/check_open_trips")) return json(0);
    if (init.method === "PATCH") {
      patched.push(u.split("/rest/v1/")[1]);
      return new Response(null, { status: 204 });
    }
    if (u.includes("parent_notifications?"))
      return json([
        {
          id: 1,
          user_id: "p1",
          kind: "boarded",
          title: "✅ Amina boarded Bus A",
          body: "At 07:02",
          url: "/family",
          created_at: now,
        },
        {
          id: 2,
          user_id: "p1",
          kind: "boarded",
          title: "old",
          body: "",
          url: "/family",
          created_at: old,
        },
      ]);
    if (u.includes("school_alerts?"))
      return json([
        {
          id: 9,
          school_id: "s1",
          kind: "not_dropped",
          severity: "urgent",
          message: "Check the bus",
          created_at: now,
        },
      ]);
    if (u.includes("user_roles?"))
      return json([
        { user_id: "a1", role: "admin" },
        { user_id: "sa1", role: "school_admin" },
      ]);
    if (u.includes("profiles?")) return json([{ id: "sa1" }]);
    if (u.includes("push_subscriptions?")) {
      const ids = decodeURIComponent(u)
        .match(/in\.\(([^)]*)\)/)[1]
        .split(",");
      return json(
        ids.map((id) => ({
          id: `sub-${id}`,
          user_id: id,
          endpoint: "https://push.example/x",
          p256dh: "k",
          auth: "a",
        })),
      );
    }
    return json([]);
  };
  return patched;
}

test("pushes fresh parent + school alerts once and marks them sent", async () => {
  const patched = fakeDb();
  const sent = [];
  const n = createAttendanceNotifier({
    url: "http://db",
    serviceKey: "k",
    vapid: {},
    log: () => {},
    send: async (s, p) => (sent.push([s.user_id, p.title]), { ok: true }),
  });
  await n.tick();
  n.stop();
  assert.deepEqual(
    sent.filter(([u]) => u === "p1").map(([, t]) => t),
    ["✅ Amina boarded Bus A"],
    "old one not pushed",
  );
  assert.deepEqual(
    sent
      .filter(([u]) => u !== "p1")
      .map(([u]) => u)
      .sort(),
    ["a1", "sa1"],
  );
  assert.equal(patched.length, 3, "both parent rows and the alert marked pushed");
});

test("idle without the attendance tables", async () => {
  fakeDb({ missing: true });
  const lines = [];
  const n = createAttendanceNotifier({
    url: "http://db",
    serviceKey: "k",
    vapid: {},
    log: (l) => lines.push(l),
    send: async () => ({ ok: true }),
  });
  await n.tick();
  n.stop();
  assert.ok(lines.some((l) => l.includes("migration not applied")));
});
