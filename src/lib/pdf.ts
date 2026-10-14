import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { tripColor, type DayReport, type LatLon } from "./day-report";
import { reverseGeocode, reverseGeocodeAddress } from "./geocode";
import { fmtDateTime, fmtDuration, fmtLongDate, fmtTime, serverNow } from "./time";

// Daily vehicle report: what an owner needs at a glance — trips, where it
// went and stopped, how long the engine ran, how long it was parked. All
// times are Kigali time regardless of the computer that prints it.

export interface DayReportPdfInput {
  vehicle: string;
  plate: string | null;
  /** yyyy-MM-dd, a Kigali calendar day */
  day: string;
  report: DayReport;
  driverAt: (iso: string) => string | null;
}

type RGB = [number, number, number];
const BRAND = {
  primary: [88, 80, 236] as RGB,
  primaryDark: [56, 48, 180] as RGB,
  ink: [24, 27, 40] as RGB,
  muted: [110, 116, 138] as RGB,
  line: [225, 228, 235] as RGB,
  tileBg: [246, 247, 251] as RGB,
  green: [22, 163, 74] as RGB,
  amber: [217, 119, 6] as RGB,
  blue: [37, 99, 235] as RGB,
  pink: [219, 39, 119] as RGB,
  danger: [220, 38, 38] as RGB,
};
const hex = (h: string): RGB => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as RGB;

export async function generateDayReportPdf(input: DayReportPdfInput): Promise<void> {
  const { vehicle, plate, day, report, driverAt } = input;
  const dayDate = `${day}T12:00:00+02:00`;

  // Place names (geocode.ts caches and rate-limits to 1 request/second).
  const spots: LatLon[] = [];
  for (const t of report.trips) {
    if (t.start) spots.push(t.start);
    spots.push(...t.stops);
    if (t.end) spots.push(t.end);
  }
  spots.push(...report.parked);
  const key = (p: LatLon) => `${p.lat.toFixed(4)},${p.lon.toFixed(4)}`;
  const names = new Map<string, string>();
  const uniq = [...new Map(spots.map((p) => [key(p), p])).values()];
  const [labels, area] = await Promise.all([
    Promise.all(uniq.map((p) => reverseGeocode(p.lat, p.lon))),
    uniq[0] ? reverseGeocodeAddress(uniq[0].lat, uniq[0].lon) : Promise.resolve(null),
  ]);
  uniq.forEach((p, i) => labels[i] && names.set(key(p), labels[i]!));
  const place = (p: LatLon | null) =>
    p ? (names.get(key(p)) ?? `${p.lat.toFixed(4)}, ${p.lon.toFixed(4)}`) : "—";
  const district = area?.parts.city_district ?? area?.parts.county ?? null;
  const city = area?.parts.city ?? null;

  const drivers = [
    ...new Set(report.trips.map((t) => driverAt(t.startedAt)).filter(Boolean)),
  ] as string[];

  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 14;

  // ── Header ────────────────────────────────────────────────────────────────
  doc.setFillColor(...BRAND.primary);
  doc.rect(0, 0, W, 30, "F");
  doc.setFillColor(...BRAND.primaryDark);
  doc.rect(0, 27, W, 3, "F");
  doc.setTextColor(255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.text("LIVE TRACK", M, 13);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text("Daily vehicle report", M, 19.5);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text(fmtLongDate(dayDate), W - M, 13, { align: "right" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.text([city, district].filter(Boolean).join(" · ") || "Kigali time (UTC+2)", W - M, 19.5, {
    align: "right",
  });

  // ── Vehicle card ──────────────────────────────────────────────────────────
  let y = 38;
  doc.setDrawColor(...BRAND.line);
  doc.roundedRect(M, y, W - 2 * M, 22, 2.5, 2.5, "S");
  doc.setTextColor(...BRAND.muted);
  doc.setFontSize(7.5);
  doc.text("VEHICLE", M + 4, y + 6);
  doc.setTextColor(...BRAND.ink);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text(vehicle, M + 4, y + 13);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...BRAND.muted);
  doc.text(
    drivers.length
      ? `Driver${drivers.length > 1 ? "s" : ""}: ${drivers.join(", ")}`
      : "Driver: not assigned",
    M + 4,
    y + 18.5,
  );
  if (plate) {
    const pw = 40;
    const px = W - M - 4 - pw;
    doc.setDrawColor(...BRAND.ink);
    doc.setFillColor(...BRAND.tileBg);
    doc.roundedRect(px, y + 5, pw, 12, 2, 2, "FD");
    doc.setFont("courier", "bold");
    doc.setFontSize(12.5);
    doc.setTextColor(...BRAND.ink);
    doc.text(plate, px + pw / 2, y + 13, { align: "center" });
  }
  y += 28;

  // ── Totals ────────────────────────────────────────────────────────────────
  const T = report.totals;
  const tiles: Array<{ label: string; value: string; color: RGB }> = [
    { label: "Trips", value: String(T.trips), color: BRAND.primary },
    { label: "Distance", value: `${T.distanceKm.toFixed(1)} km`, color: BRAND.primary },
    { label: "Driving", value: fmtDuration(T.drivingMs), color: BRAND.green },
    { label: "Engine on", value: fmtDuration(T.engineOnMs), color: BRAND.blue },
    { label: "Stopped, engine on", value: fmtDuration(T.stoppedMs), color: BRAND.amber },
    { label: "Parked", value: fmtDuration(T.parkedMs), color: BRAND.blue },
    { label: "Stops", value: String(T.stops), color: BRAND.amber },
    {
      label: "Top / avg speed",
      value: `${T.topSpeedKmh.toFixed(0)} / ${T.avgMovingKmh.toFixed(0)} km/h`,
      color: BRAND.pink,
    },
  ];
  const cols = 4;
  const gap = 3;
  const tw = (W - 2 * M - gap * (cols - 1)) / cols;
  const th = 17;
  tiles.forEach((t, i) => {
    const x = M + (i % cols) * (tw + gap);
    const yy = y + Math.floor(i / cols) * (th + gap);
    doc.setDrawColor(...BRAND.line);
    doc.setFillColor(255, 255, 255);
    doc.roundedRect(x, yy, tw, th, 2, 2, "FD");
    doc.setFillColor(...t.color);
    doc.rect(x, yy, 1.3, th, "F");
    doc.setTextColor(...BRAND.muted);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(6.8);
    doc.text(t.label.toUpperCase(), x + 4, yy + 6);
    doc.setTextColor(...BRAND.ink);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11.5);
    doc.text(t.value, x + 4, yy + 13);
  });
  y += 2 * (th + gap) + 4;

  const span = T.trips
    ? `First departure ${fmtTime(T.firstStart!)} · last arrival ${fmtTime(T.lastEnd!)}`
    : "The vehicle did not move this day.";
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(...BRAND.muted);
  doc.text(span, M, y);
  if (T.gaps > 0) {
    doc.setTextColor(...BRAND.danger);
    doc.text(
      `Signal lost ${T.gaps}× while driving (${fmtDuration(T.gapMs)}); ${T.estimatedKm.toFixed(1)} km estimated across the gaps.`,
      W - M,
      y,
      { align: "right" },
    );
  }
  y += 6;

  const section = (title: string, note?: string) => {
    if (y > H - 40) {
      doc.addPage();
      y = 18;
    }
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(...BRAND.ink);
    doc.text(title, M, y);
    const titleW = doc.getTextWidth(title);
    if (note) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(...BRAND.muted);
      doc.text(note, M + titleW + 3, y, { maxWidth: W - 2 * M - titleW - 3 });
    }
    y += 2.5;
  };
  const table = (head: string[], body: string[][], opts: Parameters<typeof autoTable>[1] = {}) => {
    autoTable(doc, {
      startY: y,
      margin: { left: M, right: M },
      head: [head],
      body,
      headStyles: { fillColor: BRAND.primary, textColor: 255, fontStyle: "bold", fontSize: 8.5 },
      alternateRowStyles: { fillColor: BRAND.tileBg },
      styles: { fontSize: 8.5, cellPadding: 2, textColor: BRAND.ink, overflow: "linebreak" },
      ...opts,
    });
    // @ts-expect-error autoTable augments the doc with lastAutoTable
    y = doc.lastAutoTable.finalY + 7;
  };

  // ── Day at a glance ───────────────────────────────────────────────────────
  type Row = { at: number; cells: string[]; color?: RGB };
  const rows: Row[] = [
    ...report.parked.map((p) => ({
      at: Date.parse(p.from),
      cells: [
        `${fmtTime(p.from)}–${p.ongoing ? "end" : fmtTime(p.to)}`,
        "Parked",
        place(p),
        fmtDuration(p.ms),
      ],
    })),
    ...report.trips.map((t) => ({
      at: Date.parse(t.startedAt),
      color: hex(tripColor(t.index)),
      cells: [
        `${fmtTime(t.startedAt)}–${t.ongoing ? "now" : fmtTime(t.endedAt)}`,
        `Trip ${t.index}${driverAt(t.startedAt) ? ` · ${driverAt(t.startedAt)}` : ""}`,
        `${place(t.start)}  →  ${t.ongoing ? "on the road" : place(t.end)}`,
        `${t.distanceKm.toFixed(1)} km · ${fmtDuration(t.drivingMs)} driving${t.stops.length ? ` · ${t.stops.length} stop${t.stops.length > 1 ? "s" : ""}` : ""}`,
      ],
    })),
  ].sort((a, b) => a.at - b.at);

  section("Day at a glance", "Kigali time");
  table(
    ["Time", "Activity", "Where", "Summary"],
    rows.map((r) => r.cells),
    {
      columnStyles: {
        0: { cellWidth: 25 },
        1: { cellWidth: 32, fontStyle: "bold" },
        2: { cellWidth: "auto" },
        3: { cellWidth: 46 },
      },
      didParseCell: (d) => {
        const r = rows[d.row.index];
        if (d.section === "body" && d.column.index === 1 && r?.color)
          d.cell.styles.textColor = r.color;
      },
    },
  );

  // ── Each trip ─────────────────────────────────────────────────────────────
  for (const t of report.trips) {
    const driver = driverAt(t.startedAt);
    section(
      `Trip ${t.index} · ${fmtTime(t.startedAt)}–${t.ongoing ? "now" : fmtTime(t.endedAt)}`,
      [
        driver,
        `${t.distanceKm.toFixed(1)} km`,
        `engine on ${fmtDuration(t.engineOnMs)}`,
        `driving ${fmtDuration(t.drivingMs)}`,
        `stopped ${fmtDuration(t.stoppedMs)}`,
        `top ${t.topSpeedKmh.toFixed(0)} km/h`,
      ]
        .filter(Boolean)
        .join(" · "),
    );
    const body: string[][] = [[fmtTime(t.startedAt), "Departed", place(t.start), ""]];
    t.stops.forEach((s, i) =>
      body.push([
        `${fmtTime(s.startedAt)}–${fmtTime(s.endedAt)}`,
        `Stop ${i + 1}`,
        place(s),
        fmtDuration(s.ms),
      ]),
    );
    for (const g of t.gaps)
      body.push([
        `${fmtTime(g.from)}–${fmtTime(g.to)}`,
        "Signal lost",
        place(g),
        `${fmtDuration(g.ms)} · ~${g.estimatedKm.toFixed(1)} km`,
      ]);
    body.sort((a, b) => a[0].localeCompare(b[0]));
    if (!t.ongoing) body.push([fmtTime(t.endedAt), "Arrived", place(t.end), ""]);
    table(["Time", "Event", "Place", "Duration"], body, {
      headStyles: {
        fillColor: hex(tripColor(t.index)),
        textColor: 255,
        fontStyle: "bold",
        fontSize: 8.5,
      },
      columnStyles: {
        0: { cellWidth: 25 },
        1: { cellWidth: 24, fontStyle: "bold" },
        2: { cellWidth: "auto" },
        3: { cellWidth: 30 },
      },
    });
  }

  // ── Footer ────────────────────────────────────────────────────────────────
  const generated = fmtDateTime(serverNow());
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setDrawColor(...BRAND.line);
    doc.line(M, H - 11, W - M, H - 11);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(...BRAND.muted);
    doc.text(
      `Live Track · generated ${generated} (Kigali) · places from OpenStreetMap`,
      M,
      H - 6.5,
    );
    doc.text(`Page ${i} of ${pages}`, W - M, H - 6.5, { align: "right" });
  }

  doc.save(`livetrack-${vehicle.replace(/[^\w-]+/g, "_")}-${day}.pdf`);
}
