/**
 * Moves the demo buses every 10 s (calls demo_tick()). Only needed when the
 * demo database has no pg_cron; with pg_cron the database does it itself.
 *
 *   npm run demo:simulate        (Ctrl+C to stop)
 */
import { createClient } from "@supabase/supabase-js";
import { demoEnv } from "./env.mjs";

const { url, key } = demoEnv();
const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

console.log(`Driving the demo buses in ${url} — Ctrl+C to stop.`);
for (;;) {
  const { data, error } = await sb.rpc("demo_tick");
  if (error) console.error(new Date().toLocaleTimeString(), "tick failed:", error.message);
  else process.stdout.write(`\r${new Date().toLocaleTimeString()}  ${data} buses moved   `);
  await new Promise((r) => setTimeout(r, 10_000));
}
