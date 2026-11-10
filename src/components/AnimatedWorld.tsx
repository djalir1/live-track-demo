import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";

// Landing-page hero background: a stylised world with vehicle icons that
// actually TRAVEL between cities and pause when they arrive.
//
// The world silhouette is a dot-pattern-masked SVG. Cities are pulsing dots.
// A handful of vehicles ride SVG paths via <animateMotion>, each with its own
// speed and colour so the map feels alive without being noisy.

const CITIES: Array<{ x: number; y: number; name: string }> = [
  { x: 155, y: 220, name: "New York" },
  { x: 200, y: 275, name: "Sao Paulo" },
  { x: 440, y: 180, name: "London" },
  { x: 465, y: 165, name: "Berlin" },
  { x: 500, y: 220, name: "Cairo" },
  { x: 495, y: 260, name: "Kigali" },
  { x: 640, y: 240, name: "Delhi" },
  { x: 750, y: 210, name: "Tokyo" },
  { x: 700, y: 305, name: "Jakarta" },
  { x: 800, y: 340, name: "Sydney" },
];

// Which cities each vehicle visits, in order. The path animation loops.
const ROUTES = [
  { color: "#22c55e", speed: 12, cities: [0, 3, 4, 6, 7], vehicle: "car" as const }, // NY -> Berlin -> Cairo -> Delhi -> Tokyo
  { color: "#3b82f6", speed: 16, cities: [4, 5, 8, 9], vehicle: "van" as const }, // Cairo -> Kigali -> Jakarta -> Sydney
  { color: "#f59e0b", speed: 14, cities: [1, 0, 3, 2], vehicle: "truck" as const }, // Sao Paulo -> NY -> Berlin -> London
  { color: "#a855f7", speed: 18, cities: [7, 8, 9, 6], vehicle: "bus" as const }, // Tokyo -> Jakarta -> Sydney -> Delhi
  { color: "#ec4899", speed: 10, cities: [2, 3, 4, 5], vehicle: "car" as const }, // London -> Berlin -> Cairo -> Kigali
];

// Very small icons that read at 16px — a filled roundrect with a wheel dot.
const VEHICLE_SVG: Record<"car" | "van" | "truck" | "bus", string> = {
  car: `M-6 0 L-4 -3 L4 -3 L6 0 L6 2 L-6 2 Z`,
  van: `M-7 -3 L5 -3 L7 0 L7 2 L-7 2 Z`,
  truck: `M-7 -3 L1 -3 L1 -1 L4 -1 L7 1 L7 2 L-7 2 Z`,
  bus: `M-8 -3 L8 -3 L8 2 L-8 2 Z`,
};

function pathThrough(indices: number[]) {
  // Build a smooth curved SVG path visiting each city center in order,
  // then closing back to the first city so the animation loops seamlessly.
  const points = indices.map((i) => CITIES[i]);
  const loop = [...points, points[0]];
  let d = `M ${loop[0].x} ${loop[0].y}`;
  for (let i = 1; i < loop.length; i++) {
    const a = loop[i - 1];
    const b = loop[i];
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2 - Math.abs(b.x - a.x) * 0.08;
    d += ` Q ${mx} ${my} ${b.x} ${b.y}`;
  }
  return d;
}

// Sum of segment distances — used to give animateMotion a keyTimes profile
// where the vehicle SLOWS DOWN to a stop at each city (2s pause), then
// smoothly resumes to the next.
function segmentLengths(indices: number[]) {
  const pts = indices.map((i) => CITIES[i]);
  const loop = [...pts, pts[0]];
  const lens: number[] = [];
  for (let i = 1; i < loop.length; i++) {
    const a = loop[i - 1];
    const b = loop[i];
    // approximate curve length as straight-line * 1.05
    lens.push(Math.hypot(b.x - a.x, b.y - a.y) * 1.05);
  }
  return lens;
}

// Build keyTimes/keyPoints so the animation pauses at every city.
function buildMotionTimes(indices: number[], stopFrac = 0.14) {
  const lens = segmentLengths(indices);
  const totalTravel = lens.reduce((a, b) => a + b, 0);
  const numStops = indices.length;
  // Total normalized time = 1. Reserve `stopFrac` for each stop.
  const totalStopTime = stopFrac * numStops;
  const travelTimeBudget = Math.max(0.05, 1 - totalStopTime);
  const keyTimes: number[] = [0];
  const keyPoints: number[] = [0];
  let travelSoFar = 0;
  let tSoFar = 0;
  for (let i = 0; i < lens.length; i++) {
    // Move segment
    travelSoFar += lens[i];
    const moveTime = (lens[i] / totalTravel) * travelTimeBudget;
    tSoFar += moveTime;
    const kp = travelSoFar / totalTravel;
    keyTimes.push(tSoFar);
    keyPoints.push(kp);
    // Stop dwell — same keyPoint, later keyTime.
    tSoFar += stopFrac;
    keyTimes.push(Math.min(1, tSoFar));
    keyPoints.push(kp);
  }
  // Snap final to 1 exactly.
  keyTimes[keyTimes.length - 1] = 1;
  keyPoints[keyPoints.length - 1] = 1;
  return { keyTimes: keyTimes.join(";"), keyPoints: keyPoints.join(";") };
}

export function AnimatedWorld({ className = "" }: { className?: string }) {
  const routeData = useMemo(
    () =>
      ROUTES.map((r) => {
        const d = pathThrough(r.cities);
        const { keyTimes, keyPoints } = buildMotionTimes(r.cities);
        return { ...r, d, keyTimes, keyPoints };
      }),
    [],
  );

  return (
    <div
      className={`pointer-events-none absolute inset-0 overflow-hidden ${className}`}
      aria-hidden
    >
      <svg viewBox="0 0 960 500" className="absolute inset-0 h-full w-full opacity-80">
        <defs>
          <radialGradient id="city-glow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="oklch(0.75 0.2 256)" stopOpacity="1" />
            <stop offset="100%" stopColor="oklch(0.75 0.2 256)" stopOpacity="0" />
          </radialGradient>
          <pattern id="worlddots" width="14" height="14" patternUnits="userSpaceOnUse">
            <circle cx="1.5" cy="1.5" r="0.9" fill="oklch(0.6 0.05 256 / 0.35)" />
          </pattern>
          <mask id="continents">
            <path
              d="M80 130 Q120 100 180 120 Q230 130 240 175 L235 220 Q220 260 180 275 L140 290 Q100 275 90 240 Q65 200 80 160 Z"
              fill="white"
            />
            <path
              d="M195 275 Q220 260 240 275 Q250 320 235 370 Q210 410 195 380 Q175 340 185 305 Z"
              fill="white"
            />
            <path
              d="M425 145 Q470 130 500 145 Q505 170 495 190 L470 205 Q440 200 425 180 Z"
              fill="white"
            />
            <path
              d="M455 210 Q510 200 530 235 Q540 285 510 335 Q485 370 470 340 Q450 300 445 260 Z"
              fill="white"
            />
            <path
              d="M540 170 Q640 155 720 175 Q790 195 800 235 Q770 275 700 290 Q620 300 560 275 Q525 245 535 205 Z"
              fill="white"
            />
            <path d="M695 295 Q740 300 760 320 Q740 345 700 340 Z" fill="white" />
            <path d="M765 320 Q820 315 850 340 Q855 375 815 380 Q780 375 765 355 Z" fill="white" />
          </mask>
        </defs>

        {/* Backdrop grid */}
        <rect width="960" height="500" fill="url(#worlddots)" opacity="0.35" />
        {/* Continents as dots + subtle glow */}
        <rect
          width="960"
          height="500"
          fill="url(#worlddots)"
          mask="url(#continents)"
          opacity="0.95"
        />
        <rect width="960" height="500" fill="oklch(0.55 0.2 256 / 0.06)" mask="url(#continents)" />

        {/* Route paths — very subtle */}
        {routeData.map((r, i) => (
          <path key={`p-${i}`} d={r.d} stroke={`${r.color}30`} strokeWidth="1.2" fill="none" />
        ))}

        {/* Cities */}
        {CITIES.map((c, i) => (
          <g key={`c-${i}`} transform={`translate(${c.x} ${c.y})`}>
            <circle r="12" fill="url(#city-glow)" />
            <circle r="3" fill="oklch(0.8 0.18 256)" />
            <circle r="5.5" fill="none" stroke="oklch(0.8 0.18 256 / 0.5)" strokeWidth="0.8" />
          </g>
        ))}

        {/* Vehicles traveling along their routes with stops at every city */}
        {routeData.map((r, i) => (
          <g key={`v-${i}`}>
            {/* Motion path applies to the whole group */}
            <g>
              {/* halo */}
              <circle r="7" fill={r.color} opacity="0.25" />
              {/* body */}
              <path
                d={VEHICLE_SVG[r.vehicle]}
                fill={r.color}
                stroke="white"
                strokeWidth="0.8"
                strokeLinejoin="round"
              />
              {/* wheels */}
              <circle cx="-3.5" cy="2.5" r="1" fill="oklch(0.15 0.02 250)" />
              <circle cx="3.5" cy="2.5" r="1" fill="oklch(0.15 0.02 250)" />
              <animateMotion
                dur={`${r.speed}s`}
                repeatCount="indefinite"
                path={r.d}
                keyTimes={r.keyTimes}
                keyPoints={r.keyPoints}
                rotate="auto"
                calcMode="linear"
              />
            </g>
          </g>
        ))}
      </svg>
    </div>
  );
}

/** Live-preview widget shown inside the hero: mock driver list + tiny map with a
 *  vehicle icon that travels along a route and stops. */
export function LivePreviewCard() {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1600);
    return () => clearInterval(id);
  }, []);

  const drivers = useMemo(
    () => [
      {
        name: "Bus 1 · Kimironko",
        vehicle: "Morning pickup",
        plate: "RAD 101 A",
        status: "moving" as const,
        color: "var(--moving)",
        km: 32 + (tick % 5),
        onBoard: `${12 + (tick % 3)}/15 on board`,
      },
      {
        name: "Bus 2 · Kicukiro",
        vehicle: "Morning pickup",
        plate: "RAD 101 B",
        status: "moving" as const,
        color: "var(--moving)",
        km: 28 + (tick % 4),
        onBoard: "9/14 on board",
      },
      {
        name: "Bus 3 · Nyamirambo",
        vehicle: "At a stop",
        plate: "RAD 101 C",
        status: "stopped" as const,
        color: "var(--stopped)",
        km: 0,
        onBoard: "6/12 on board",
      },
      {
        name: "Bus 4 · Remera",
        vehicle: "At school",
        plate: "RAD 101 D",
        status: "idle" as const,
        color: "var(--idle)",
        km: 0,
        onBoard: "All off ✓",
      },
    ],
    [tick],
  );

  // Route path for the mini-map: a curved journey with 3 waypoints where the
  // vehicle stops (start, mid-corner, end).
  const routeD = "M 25 210 Q 90 200 130 155 Q 175 105 220 105 Q 260 105 290 55";
  const stopKeyTimes = "0;0.35;0.4;0.7;0.75;1";
  const stopKeyPoints = "0;0.45;0.45;0.8;0.8;1";

  return (
    <motion.div
      initial={{ opacity: 0, y: 24, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.7, delay: 0.4 }}
      className="relative w-full rounded-2xl border border-border/60 bg-card/80 backdrop-blur-xl shadow-2xl overflow-hidden"
    >
      {/* Fake browser toolbar */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border/60 bg-muted/40">
        <div className="flex gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-[oklch(0.7_0.2_27)]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[oklch(0.78_0.17_80)]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[oklch(0.72_0.18_150)]" />
        </div>
        <div className="text-xs font-medium text-muted-foreground ml-2">
          livetrack.app/dashboard
        </div>
        <div className="ml-auto flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--moving)]">
          <span className="relative flex h-2 w-2">
            <span className="absolute inset-0 rounded-full bg-[var(--moving)] animate-ping opacity-60" />
            <span className="relative h-2 w-2 rounded-full bg-[var(--moving)]" />
          </span>
          Live
        </div>
      </div>

      <div className="grid grid-cols-[1fr_1.4fr] min-h-[280px]">
        {/* Driver list */}
        <div className="border-r border-border/60 p-3 space-y-2">
          {drivers.map((d) => (
            <motion.div
              key={d.plate}
              layout
              className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg hover:bg-accent/40 transition-colors"
            >
              <span
                className="h-2.5 w-2.5 rounded-full shrink-0"
                style={{ background: d.color, boxShadow: `0 0 8px ${d.color}` }}
              />
              <div className="min-w-0 flex-1">
                <div className="text-xs font-semibold truncate">{d.name}</div>
                <div className="text-[10px] text-muted-foreground truncate">
                  {d.vehicle} · {d.plate}
                </div>
              </div>
              <div className="text-right shrink-0">
                <div className="text-xs font-bold tabular-nums" style={{ color: d.color }}>
                  {d.km} km/h
                </div>
                <div className="text-[10px] text-muted-foreground">{d.onBoard}</div>
              </div>
            </motion.div>
          ))}
        </div>

        {/* Mini map with a moving vehicle */}
        <div className="relative">
          <svg viewBox="0 0 320 260" className="h-full w-full">
            <defs>
              <pattern id="mini-grid" width="18" height="18" patternUnits="userSpaceOnUse">
                <path
                  d="M18 0 L0 0 0 18"
                  fill="none"
                  stroke="oklch(0.5 0.02 250 / 0.15)"
                  strokeWidth="0.5"
                />
              </pattern>
              <linearGradient id="route-g" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="oklch(0.72 0.18 150)" stopOpacity="0.35" />
                <stop offset="100%" stopColor="oklch(0.72 0.18 150)" stopOpacity="1" />
              </linearGradient>
            </defs>
            <rect width="320" height="260" fill="url(#mini-grid)" />

            {/* Fake streets */}
            <path
              d="M 20 210 Q 90 200 130 155 Q 175 105 220 105 Q 260 105 290 55"
              stroke="oklch(0.4 0.02 250 / 0.35)"
              strokeWidth="6"
              fill="none"
              strokeLinecap="round"
            />
            <path
              d="M 40 40 L 260 240"
              stroke="oklch(0.4 0.02 250 / 0.22)"
              strokeWidth="4"
              fill="none"
              strokeLinecap="round"
            />
            <path
              d="M 20 130 L 300 130"
              stroke="oklch(0.4 0.02 250 / 0.18)"
              strokeWidth="3"
              fill="none"
              strokeLinecap="round"
            />

            {/* Traced trip line */}
            <path
              d={routeD}
              stroke="url(#route-g)"
              strokeWidth="3"
              fill="none"
              strokeLinecap="round"
              strokeDasharray="6 6"
              style={{ animation: "trip-dash 2s linear infinite" }}
            />

            {/* Static markers at the stops */}
            <g>
              <circle r="7" fill="oklch(0.72 0.18 150 / 0.25)" cx="25" cy="210" />
              <circle
                r="4"
                fill="oklch(0.72 0.18 150)"
                cx="25"
                cy="210"
                stroke="white"
                strokeWidth="1.2"
              />

              <circle r="7" fill="oklch(0.78 0.17 80 / 0.2)" cx="150" cy="130" />
              <circle
                r="4"
                fill="oklch(0.78 0.17 80)"
                cx="150"
                cy="130"
                stroke="white"
                strokeWidth="1.2"
              />

              <circle r="7" fill="oklch(0.62 0.14 240 / 0.2)" cx="290" cy="55" />
              <circle
                r="4"
                fill="oklch(0.62 0.14 240)"
                cx="290"
                cy="55"
                stroke="white"
                strokeWidth="1.2"
              />
            </g>

            {/* Vehicle icon that follows the route and STOPS at each marker */}
            <g>
              {/* Halo */}
              <circle r="9" fill="oklch(0.72 0.18 150 / 0.35)" />
              {/* Body */}
              <rect
                x="-8"
                y="-4"
                width="16"
                height="7"
                rx="1.5"
                fill="oklch(0.72 0.18 150)"
                stroke="white"
                strokeWidth="0.9"
              />
              <path
                d="M-6 -4 L-4 -6 L4 -6 L6 -4 Z"
                fill="oklch(0.72 0.18 150)"
                stroke="white"
                strokeWidth="0.9"
              />
              {/* Wheels */}
              <circle cx="-4.5" cy="3" r="1.5" fill="oklch(0.15 0.02 250)" />
              <circle cx="4.5" cy="3" r="1.5" fill="oklch(0.15 0.02 250)" />

              <animateMotion
                dur="7s"
                repeatCount="indefinite"
                path={routeD}
                keyTimes={stopKeyTimes}
                keyPoints={stopKeyPoints}
                rotate="auto"
              />
            </g>
          </svg>
        </div>
      </div>

      <style>{`
        @keyframes trip-dash { 0% { stroke-dashoffset: 0 } 100% { stroke-dashoffset: -24 } }
      `}</style>
    </motion.div>
  );
}
