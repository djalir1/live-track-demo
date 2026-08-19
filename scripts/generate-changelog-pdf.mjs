// Standalone script that generates a polished team-facing change report PDF.
// Run with: node scripts/generate-changelog-pdf.mjs
// Output: PULSE-Change-Report.pdf at the project root.

import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dirname, "..", "PULSE-Change-Report.pdf");

// Any Unicode punctuation that helvetica can't render -> ASCII equivalent.
// Belt-and-braces safety net; the content strings above are also ASCII-clean.
const UNI_MAP = {
  "–": "-",  "—": "-",  "―": "-",
  "‘": "'",  "’": "'",  "‚": ",",  "‛": "'",
  "“": '"',  "”": '"',  "„": '"',  "‟": '"',
  "•": "-",  "…": "...",
  "←": "<-", "↑": "^",  "→": "->", "↓": "v",
  "⇄": "<->","⇆": "<->",
  "≤": "<=", "≥": ">=", "×": "x",  "·": "-",
  "→": "->", " ": " ",
};
function ascii(s) {
  if (s == null) return s;
  let out = String(s);
  for (const [u, a] of Object.entries(UNI_MAP)) out = out.split(u).join(a);
  // Fall back: strip any remaining non-latin1 char.
  out = out.replace(/[^\x00-\xFF]/g, "?");
  return out;
}

// -----------------------------------------------------------------------------
// Brand palette (matches the app + trip report)
// -----------------------------------------------------------------------------
const C = {
  primary:    [88, 80, 236],
  primaryDeep:[56, 48, 180],
  ink:        [24, 27, 40],
  muted:      [110, 116, 138],
  faint:      [175, 180, 195],
  line:       [225, 228, 235],
  tile:       [246, 247, 251],
  good:       [34, 197, 94],
  info:       [59, 130, 246],
  warn:       [245, 158, 11],
  bad:        [239, 68, 68],
  panelDark:  [16, 20, 34],
};

// -----------------------------------------------------------------------------
// Content -- the actual copy shown in the report.
// NOTE: kept strictly ASCII. jsPDF's default helvetica font only handles the
// Windows-1252 charset, so em-dashes / arrows / ellipses render as garbage.
// -----------------------------------------------------------------------------
const REPORT_DATE = new Date();

const OVERVIEW = [
  "Pulse is a real-time GPS fleet-tracking web app. Any smartphone becomes a live GPS device -- no hardware, no SIM cards.",
  "Drivers open the app, tap Start tracking, and stream their position, speed, battery and status to an admin dashboard that shows every vehicle on one map. Admins can replay any driver's day, download PDF trip reports, and see human-readable street names for every stop.",
  "This document summarises what the platform used to look like, what changed, and where it is today -- so anyone joining the team can get up to speed quickly.",
];

const BEFORE_AFTER = [
  ["Auth",                "Instant logout, \"failed to fetch\", session lost within seconds.", "Sessions are stable. Signup returns a session immediately (email auto-confirm)."],
  ["RLS policies",        "Missing on device_status and location_history -- every write blocked.", "Full RLS suite restored, verified via advisors. Own-row + admin-read."],
  ["Signup form",         "Name + vehicle name + email + password only.",                       "+ Vehicle type (9 options), plate number, seat count (bus/van)."],
  ["Vehicle icons",       "Generic lucide icons -- Van looked like a box.",                     "Custom SVG silhouettes: sedan, SUV, cargo van, semi-truck, pickup with bed, bus with windows, motorbike, bicycle."],
  ["Admin dashboard",     "Vehicles disappeared from the map when a filter was applied.",       "Map always shows every driver; filter only narrows the list."],
  ["Status colors",       "Stopped = red (confusing).",                                         "Moving = green, Parked = calm blue, Idle = amber, Offline = gray."],
  ["Driver info shown",   "Name, vehicle name, km/h.",                                          "+ Plate pill, phone on/off, battery warning, street name, LIVE badge."],
  ["Map style",           "Tiles hid street names in dark mode.",                               "CARTO Voyager tiles -- street names readable in both themes."],
  ["Trip history",        "Did not exist.",                                                     "/history: pick driver + date, see polyline route, stops with addresses, summary tiles."],
  ["PDF report",          "Did not exist.",                                                     "One-click daily report: driver, plate, seats, distance, driving/stopped time, top speed, stops with addresses, sampled points, battery start/end."],
  ["Wake Lock",           "Screen turned off, tracking stopped.",                               "Wake Lock keeps the screen on for the whole shift, reacquired on tab-focus."],
  ["Reverse geocoding",   "Only raw coordinates shown.",                                        "Human-readable addresses via OSM Nominatim, cached in sessionStorage."],
  ["Landing page",        "Basic hero + 6 static feature cards + \"Built with Lovable\" footer.", "Animated world with vehicle icons moving between cities, live-preview mock, stats strip, feature grid, 3-step how-it-works, use cases, dark CTA, 3-column footer."],
  ["Mobile responsive",   "Panels stacked awkwardly, list scrolled past map.",                  "Tab-switch layout (Drivers <-> Map on /dashboard, Trip details <-> Route on /history) below 1024px."],
  ["Positioning",         "Freemium copy (\"Start tracking free\").",                           "Enterprise / B2B copy: \"Access your workspace\", built for fleet operators."],
  ["Deployment",          "Cloudflare-only wrangler config, no .env.example.",                  "vercel.json + api/ssr.js Node function, .env.example, .gitignore protects .env, ready for one-click Vercel deploy."],
];

const BUGS_FIXED = [
  { title: "Instant logout after login",
    was: "Users were signed out within seconds of logging in -- 'failed to fetch' toasts, session vanished.",
    now: "Removed the redundant getSession() race that fought onAuthStateChange, and stopped calling supabase.auth.getUser() inside use-tracker. No more AuthRefreshDiscardedError." },
  { title: "\"new row violates RLS policy for device_status\"",
    was: "Right after signup the tracker's first upsert raced ahead of the auth token being attached to the Supabase client, spamming a red toast.",
    now: "Transient RLS/JWT errors are retried up to 3x with backoff and never surface to the user. Only genuine errors reach the UI." },
  { title: "Vehicle disappearing from the map",
    was: "When an admin filtered the list to Moving/Parked/etc., matching vehicles also disappeared from the map.",
    now: "The map now always renders every driver. Filters only narrow the side list." },
  { title: "Stale error message",
    was: "Once the tracker errored, the red banner stayed on screen even after subsequent successful updates.",
    now: "Successful persists clear stats.error." },
  { title: "Wrong Supabase project",
    was: ".env pointed to a project that didn't exist in the account, breaking every fetch.",
    now: ".env fixed. .env.example committed. Real values live only in local .env / Vercel dashboard." },
  { title: "Loading screen looked like a blank blue page",
    was: "Dashboard showed muted-on-muted 'Loading...' text with no background -- read as 'the app is broken'.",
    now: "Explicit background, spinner icon, clear label." },
];

const FEATURES = [
  { title: "Signup with vehicle profile",
    body: "Driver name, vehicle name, plate number, vehicle type from a 9-option grid, and seat count for buses/vans -- all captured on signup and stored on the profile." },
  { title: "Realistic vehicle icons",
    body: "Custom SVG silhouettes for each type. Icons render both in the signup grid, in the driver list, and inside the map markers." },
  { title: "Real-time admin dashboard",
    body: "Every vehicle on one CARTO Voyager map with a vehicle-shaped marker. Side list shows driver, plate, vehicle, speed, address, battery, and 'Phone off' chip when the driver stops tracking. Realtime updates via Supabase channels." },
  { title: "Human-readable addresses",
    body: "OSM Nominatim reverse-geocoding with in-memory + sessionStorage cache and in-flight dedupe. Shown on tracker, dashboard cards, map popups, and PDF reports." },
  { title: "Trip history + route playback",
    body: "/history route: admin picks a driver + a date, sees the day's polyline on the map with stop pins. Summary tiles: distance, driving time, stopped time, top speed." },
  { title: "PDF daily reports",
    body: "One-click download: purple gradient header, identity card with plate, six summary tiles, route overview with battery start/end + drop, stops table, sampled points table. Footer on every page." },
  { title: "Wake Lock while tracking",
    body: "Screen stays on for the entire shift so the tab isn't backgrounded and throttled. Lock is reacquired when the tab returns to visible." },
  { title: "Mobile-first responsive layout",
    body: "Below 1024px, both /dashboard and /history collapse to a tab-switch layout so the map and the driver list each get full-width real estate. Header labels drop to icons." },
  { title: "Auto-confirmed accounts",
    body: "A BEFORE INSERT trigger on auth.users sets email_confirmed_at so signUp() returns a session immediately -- no verification email required for this deployment." },
  { title: "Deployment-ready repo",
    body: "vercel.json + api/ssr.js Node function wrap the TanStack Start SSR bundle. .env.example documents required vars. .gitignore prevents leaking .env. README walks through the 5-step Vercel deploy." },
];

const TECHNICAL = [
  { title: "Database schema", detail: "user_roles (admin/user enum), profiles (display_name, vehicle_name, vehicle_type enum, plate_number, seats), device_status (per-user snapshot), location_history (per-point log). RLS enabled on all four." },
  { title: "RLS policies",    detail: "SELECT own row OR admin (via has_role SECURITY DEFINER helper). INSERT/UPDATE limited to own user_id." },
  { title: "Migrations",      detail: "restore_rls_policies_and_triggers, auto_confirm_email_on_signup, add_vehicle_type, add_plate_and_seats." },
  { title: "Realtime",        detail: "device_status REPLICA IDENTITY FULL and added to supabase_realtime publication. Dashboard subscribes to postgres_changes for live updates." },
  { title: "Auth model",      detail: "Client uses supabase-js v2 with autoRefreshToken. Auth context single-flights role fetches to avoid concurrent refresh cycles." },
  { title: "Frontend stack",  detail: "TanStack Start (SSR) + React 19 + Tailwind CSS 4 + Framer Motion + Leaflet + Lucide + jsPDF + jspdf-autotable." },
];

const USER_FLOWS = [
  { role: "Driver", steps: [
    "Open the app, tap Create account.",
    "Fill in name, vehicle name, plate number, pick vehicle type (bus/van also asks for seat count).",
    "Enter email + password -> account is created + session issued instantly (no email verification).",
    "Land on /track. Location permission is requested. Tap Start tracking.",
    "Status shows Parked/Moving with a LIVE pulsing badge. Speed, distance, battery, address all update live.",
    "Wake Lock keeps the screen on. Stop tracking any time.",
  ]},
  { role: "Admin", steps: [
    "Sign in — land on /dashboard (once the account has been promoted to admin in user_roles).",
    "See every driver as a vehicle-shaped marker on the map, plus a side list with plate, address, battery, phone status.",
    "Filter list by status (All/Moving/Parked/Idle/Offline) or search by name/plate/street. Map still shows everyone.",
    "Click History -> pick a driver + date -> see the full route polyline with stops.",
    "Click Export PDF -> downloads a full daily report.",
  ]},
];

const DEPLOY = [
  "Push the repo to GitHub.",
  "In Vercel: Add New Project -> Import the repo.",
  "Framework preset: Other (vercel.json handles it).",
  "Set env vars from .env.example: SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY.",
  "Deploy. Static assets are served from dist/client, SSR is served by api/ssr.js on the Node runtime.",
];

// -----------------------------------------------------------------------------
// Layout helpers
// -----------------------------------------------------------------------------
const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
const W = doc.internal.pageSize.getWidth();
const H = doc.internal.pageSize.getHeight();
const M = 18;
let y = M;

function assertRgb(c, label) {
  if (!Array.isArray(c) || c.length !== 3 || c.some((v) => typeof v !== "number" || !Number.isFinite(v))) {
    throw new Error(`Bad color for ${label}: ${JSON.stringify(c)}`);
  }
}
function setFillC(c)   { assertRgb(c, "fill"); doc.setFillColor(c[0], c[1], c[2]); }
function setStrokeC(c) { assertRgb(c, "stroke"); doc.setDrawColor(c[0], c[1], c[2]); }
function setTextC(c)   { assertRgb(c, "text"); doc.setTextColor(c[0], c[1], c[2]); }

function needPage(next = 10) {
  if (y + next > H - 20) { doc.addPage(); y = M; }
}

function h1(text) {
  needPage(18);
  setTextC(C.ink);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(22);
  doc.text(ascii(text), M, y);
  // accent underline
  setFillC(C.primary);
  doc.rect(M, y + 3, 34, 1.2, "F");
  y += 12;
}

function h2(text) {
  needPage(14);
  setTextC(C.ink);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text(ascii(text), M, y);
  y += 8;
}

function paragraph(text, opts = {}) {
  const { color = C.ink, size = 10.5, gap = 5 } = opts;
  setTextC(color);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(size);
  const wrapped = doc.splitTextToSize(ascii(text), W - M * 2);
  const lineH = size * 0.42;
  needPage(wrapped.length * lineH + gap);
  doc.text(wrapped, M, y);
  y += wrapped.length * lineH + gap;
}

function bulletList(items, opts = {}) {
  const { color = C.ink, size = 10, indent = 6, gap = 3 } = opts;
  setTextC(color);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(size);
  const lineH = size * 0.42;
  for (const item of items) {
    const wrapped = doc.splitTextToSize(ascii(item), W - M * 2 - indent);
    needPage(wrapped.length * lineH + gap + 2);
    // bullet dot
    setFillC(C.primary);
    doc.circle(M + 1.5, y - 1.2, 0.8, "F");
    setTextC(color);
    doc.text(wrapped, M + indent, y);
    y += wrapped.length * lineH + gap;
  }
  y += 2;
}

function calloutRow(kind, title, was, now) {
  const badge = { fixed: ["FIXED", C.good], improved: ["IMPROVED", C.info], new: ["NEW", C.primary] }[kind] ?? ["", C.muted];
  // Measure first
  doc.setFontSize(8.5);
  const wasText = doc.splitTextToSize(ascii(was), W - M * 2 - 10);
  const nowText = doc.splitTextToSize(ascii(now), W - M * 2 - 10);
  const lineH = 3.6;
  const wasBlockH = wasText.length * lineH;
  const nowBlockH = nowText.length * lineH;
  const boxH = 14 /* header row */ + 4 + wasBlockH + 4 + nowBlockH + 5;

  needPage(boxH + 4);

  // Container
  setStrokeC(C.line);
  doc.roundedRect(M, y, W - M * 2, boxH, 2.5, 2.5, "S");

  // Badge
  setFillC(badge[1]);
  doc.roundedRect(M + 4, y + 4, 24, 5.5, 1, 1, "F");
  doc.setTextColor(255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  doc.text(ascii(badge[0]), M + 16, y + 8, { align: "center" });

  // Title
  setTextC(C.ink);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11.5);
  doc.text(ascii(title), M + 32, y + 8.2);

  // Divider under header
  setStrokeC(C.line);
  doc.line(M + 4, y + 12, W - M - 4, y + 12);

  // BEFORE label
  const beforeY = y + 16.5;
  setTextC(C.muted);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7);
  doc.text("BEFORE", M + 5, beforeY);
  setTextC(C.ink);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.text(wasText.map(ascii), M + 5, beforeY + 4);

  // NOW label
  const nowLabelY = beforeY + 4 + wasBlockH + 2;
  setTextC(C.muted);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7);
  doc.text("NOW", M + 5, nowLabelY);
  setTextC(C.ink);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.text(nowText.map(ascii), M + 5, nowLabelY + 4);

  y += boxH + 4;
}

// -----------------------------------------------------------------------------
// COVER PAGE
// -----------------------------------------------------------------------------
setFillC(C.panelDark);
doc.rect(0, 0, W, H, "F");
// diagonal band
setFillC(C.primary);
doc.rect(0, 60, W, 90, "F");
setFillC(C.primaryDeep);
doc.rect(0, 148, W, 3, "F");

// logo dot
setFillC([255, 255, 255]);
doc.circle(M, 100, 5, "F");
setFillC(C.primary);
doc.circle(M, 100, 2.5, "F");

doc.setTextColor(255);
doc.setFont("helvetica", "bold");
doc.setFontSize(11);
doc.text("PULSE", M + 10, 96);
doc.setFont("helvetica", "normal");
doc.setFontSize(8);
doc.text("Real-time GPS fleet tracking", M + 10, 101);

doc.setFont("helvetica", "bold");
doc.setFontSize(38);
doc.text("Platform", M, 128);
doc.text("Change Report", M, 143);

doc.setFont("helvetica", "normal");
doc.setFontSize(11);
doc.text("Everything that changed on Pulse, in one document.", M, 168);

doc.setFontSize(9);
setTextC(C.faint);
doc.text(REPORT_DATE.toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" }), M, 178);
doc.text("Prepared for the Pulse team.", M, 184);

// footer marker
setFillC(C.primary);
doc.rect(0, H - 12, W, 4, "F");
doc.setFontSize(8);
doc.setTextColor(255);
doc.text("PULSE  -  Change Report", M, H - 5);
doc.text("v1.0", W - M, H - 5, { align: "right" });

// -----------------------------------------------------------------------------
// PAGE: What is Pulse
// -----------------------------------------------------------------------------
doc.addPage();
y = M;
h1("What is Pulse?");
for (const p of OVERVIEW) paragraph(p);

h2("The people who use it");
bulletList([
  "Drivers open the app on any smartphone and tap Start tracking. Their position streams live to the admin.",
  "Admins watch every vehicle on one map, filter and search, replay any day's route, and download PDF trip reports.",
]);

// -----------------------------------------------------------------------------
// PAGE: Before -> After summary
// -----------------------------------------------------------------------------
doc.addPage();
y = M;
h1("Before -> After, at a glance");
paragraph("A one-table summary of every visible change. Details for each row follow in later sections.", { color: C.muted, gap: 6 });

autoTable(doc, {
  startY: y,
  margin: { left: M, right: M },
  head: [["Area", "Before", "Now"]],
  body: BEFORE_AFTER.map((row) => row.map(ascii)),
  headStyles: { fillColor: C.primary, textColor: 255, fontStyle: "bold", fontSize: 9 },
  alternateRowStyles: { fillColor: C.tile },
  styles: { fontSize: 8.5, cellPadding: 2.5, textColor: C.ink, valign: "top" },
  columnStyles: { 0: { cellWidth: 34, fontStyle: "bold" }, 1: { cellWidth: 63 }, 2: { cellWidth: "auto" } },
});

// -----------------------------------------------------------------------------
// PAGE: Bugs fixed
// -----------------------------------------------------------------------------
doc.addPage();
y = M;
h1("Bugs fixed");
paragraph("These are the concrete defects users could see before, and how each was addressed.", { color: C.muted, gap: 8 });
for (const b of BUGS_FIXED) calloutRow("fixed", b.title, b.was, b.now);

// -----------------------------------------------------------------------------
// PAGE: New features
// -----------------------------------------------------------------------------
doc.addPage();
y = M;
h1("New features");
paragraph("Capabilities that did not exist (or did not work) in the previous version.", { color: C.muted, gap: 8 });

for (const f of FEATURES) {
  needPage(20);
  // Card
  setStrokeC(C.line);
  setFillC(C.tile);
  const wrapped = doc.splitTextToSize(ascii(f.body), W - M * 2 - 8);
  const hgt = 10 + wrapped.length * 4.4;
  doc.roundedRect(M, y, W - M * 2, hgt, 2.5, 2.5, "FD");

  // Corner accent
  setFillC(C.primary);
  doc.rect(M, y, 1.8, hgt, "F");

  setTextC(C.ink);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text(ascii(f.title), M + 5, y + 6);

  setTextC(C.muted);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text(wrapped, M + 5, y + 12);

  y += hgt + 4;
}

// -----------------------------------------------------------------------------
// PAGE: Technical details
// -----------------------------------------------------------------------------
doc.addPage();
y = M;
h1("Under the hood");
paragraph("For anyone who wants to open the code — here's how the pieces fit together.", { color: C.muted, gap: 8 });

for (const t of TECHNICAL) {
  needPage(16);
  setTextC(C.primary);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10.5);
  doc.text(ascii(t.title), M, y);
  y += 4.5;
  setTextC(C.ink);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9.5);
  const wrapped = doc.splitTextToSize(ascii(t.detail), W - M * 2);
  doc.text(wrapped, M, y);
  y += wrapped.length * 4.4 + 4;
}

// -----------------------------------------------------------------------------
// PAGE: User flows
// -----------------------------------------------------------------------------
doc.addPage();
y = M;
h1("How people use it, step by step");

for (const f of USER_FLOWS) {
  h2(f.role);
  bulletList(f.steps.map((s, i) => `${i + 1}. ${s}`));
  y += 2;
}

// -----------------------------------------------------------------------------
// PAGE: Deploy
// -----------------------------------------------------------------------------
h1("Deploying to Vercel");
paragraph("The repo is already configured. Steps to push to production:", { color: C.muted, gap: 6 });
bulletList(DEPLOY);

// -----------------------------------------------------------------------------
// FOOTER on every page (except cover)
// -----------------------------------------------------------------------------
const total = doc.getNumberOfPages();
for (let i = 2; i <= total; i++) {
  doc.setPage(i);
  setStrokeC(C.line);
  doc.line(M, H - 12, W - M, H - 12);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  setTextC(C.muted);
  doc.text("PULSE  -  Platform Change Report", M, H - 7);
  doc.text(`Page ${i} of ${total}`, W - M, H - 7, { align: "right" });
}

// -----------------------------------------------------------------------------
// Write to disk
// -----------------------------------------------------------------------------
const bytes = doc.output("arraybuffer");
writeFileSync(OUT, Buffer.from(bytes));
console.log(`Wrote ${OUT}  (${(bytes.byteLength / 1024).toFixed(1)} KB, ${total} pages)`);
