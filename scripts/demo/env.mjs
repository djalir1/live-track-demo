// Loads SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY for the demo scripts from
// the environment, .env.local or .env — and refuses the production project.
import { existsSync, readFileSync } from "node:fs";

const PRODUCTION_REFS = ["xtvomhbolgrzlkaocyju"]; // the live Live Track database

function readEnvFile(path) {
  if (!existsSync(path)) return {};
  const out = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

export function demoEnv() {
  const file = { ...readEnvFile(".env"), ...readEnvFile(".env.local") };
  const url = process.env.SUPABASE_URL || file.SUPABASE_URL || file.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || file.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (demo project) in .env.local");
    process.exit(1);
  }
  if (
    PRODUCTION_REFS.some((ref) => url.includes(ref)) &&
    process.env.I_KNOW_THIS_IS_PRODUCTION !== "yes"
  ) {
    console.error(`Refusing to run demo scripts against the PRODUCTION database (${url}).`);
    console.error("Point .env.local at the demo Supabase project.");
    process.exit(1);
  }
  return { url, key };
}
