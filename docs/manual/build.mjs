// Builds LIVETRACK-User-Manual.pdf (repo root) from docs/manual/user-manual.html
// with headless Google Chrome (no npm packages needed).
//   node docs/manual/build.mjs
// Set CHROME_PATH if Chrome is installed somewhere else.
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const chrome =
  process.env.CHROME_PATH ||
  (process.platform === "win32"
    ? "C:/Program Files/Google/Chrome/Application/chrome.exe"
    : process.platform === "darwin"
      ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
      : "google-chrome");
const out = resolve(here, "..", "..", "LIVETRACK-User-Manual.pdf");

execFileSync(
  chrome,
  [
    "--headless=new",
    "--disable-gpu",
    "--no-pdf-header-footer",
    "--virtual-time-budget=8000", // lets the web fonts load
    `--print-to-pdf=${out}`,
    pathToFileURL(join(here, "user-manual.html")).href,
  ],
  { stdio: "inherit" },
);
console.log("Wrote", out);
