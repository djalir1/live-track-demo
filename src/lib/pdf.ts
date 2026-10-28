import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { tripColor, type DayReport, type LatLon } from "./day-report";
import { reverseGeocode, reverseGeocodeAddress } from "./geocode";
import { fmtShortDay, type RangeSummary } from "./range-report";
import { fmtDate, fmtDateTime, fmtDuration, fmtLongDate, fmtTime, serverNow } from "./time";

// Daily vehicle report: what an owner needs at a glance — trips, where it
// went and stopped, how long the engine ran, how long it was parked. All
// times are Kigali time regardless of the computer that prints it.
// Below it, the same look for a period of several days.

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
const fileSafe = (s: string) => s.replace(/[^\w-]+/g, "_");

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
  spots.push(...report.signalLost);
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

  const w = startDoc(
    "Daily vehicle report",
    fmtLongDate(dayDate),
    [city, district].filter(Boolean).join(" · ") || "Kigali time (UTC+2)",
  );
  w.vehicleCard(
    vehicle,
    plate,
    drivers.length
      ? `Driver${drivers.length > 1 ? "s" : ""}: ${drivers.join(", ")}`
      : "Driver: not assigned",
  );

  // ── Totals ────────────────────────────────────────────────────────────────
  const T = report.totals;
  w.tiles([
    { label: "Distance", value: `${T.distanceKm.toFixed(1)} km`, color: BRAND.primary },
    { label: "Driving time", value: fmtDuration(T.drivingMs), color: BRAND.green },
    { label: "Stops", value: String(T.stops), color: BRAND.amber },
    { label: "Top speed", value: `${T.topSpeedKmh.toFixed(0)} km/h`, color: BRAND.pink },
  ]);
  w.paragraph(
    (T.trips
      ? `${T.trips} trip${T.trips > 1 ? "s" : ""} between ${fmtTime(T.firstStart!)} and ${fmtTime(T.lastEnd!)}. Engine on ${fmtDuration(T.engineOnMs)} (stopped with engine on ${fmtDuration(T.stoppedMs)}), parked ${fmtDuration(T.parkedMs)}.${T.gaps ? ` ${T.estimatedKm.toFixed(1)} km estimated where the signal was lost.` : ""}`
      : "The vehicle stayed parked all day.") +
      (T.signalLost
        ? ` The tracker lost its connection ${T.signalLost} time${T.signalLost > 1 ? "s" : ""} (${fmtDuration(T.signalLostMs)} in total), listed below.`
        : ""),
  );

  // ── Trips ─────────────────────────────────────────────────────────────────
  if (report.trips.length) {
    w.section("Trips", "Kigali time");
    w.table(
      ["#", "Time", "From  →  To", "Distance", "Driving", "Stops"],
      report.trips.map((t) => [
        String(t.index),
        `${fmtTime(t.startedAt)}–${t.ongoing ? "now" : fmtTime(t.endedAt)}`,
        `${place(t.start)}  →  ${t.ongoing ? "on the road" : place(t.end)}${
          driverAt(t.startedAt) && drivers.length > 1
            ? `
${driverAt(t.startedAt)}`
            : ""
        }`,
        `${t.distanceKm.toFixed(1)} km`,
        fmtDuration(t.drivingMs),
        String(t.stops.length),
      ]),
      {
        columnStyles: {
          0: { cellWidth: 8, fontStyle: "bold" },
          1: { cellWidth: 24 },
          2: { cellWidth: "auto" },
          3: { cellWidth: 20, halign: "right" },
          4: { cellWidth: 20, halign: "right" },
          5: { cellWidth: 14, halign: "right" },
        },
        didParseCell: (d) => {
          const t = report.trips[d.row.index];
          if (d.section === "body" && d.column.index === 0 && t)
            d.cell.styles.textColor = hex(tripColor(t.index));
        },
      },
    );
  }

  // ── Stops ─────────────────────────────────────────────────────────────────
  const stops = report.trips.flatMap((t) => t.stops.map((st) => ({ t, st })));
  if (stops.length) {
    w.section("Stops", "where the vehicle stood still for a minute or more during a trip");
    w.table(
      ["Trip", "Time", "Stopped", "Place"],
      stops.map(({ t, st }) => [
        String(t.index),
        `${fmtTime(st.startedAt)}–${fmtTime(st.endedAt)}`,
        fmtDuration(st.ms),
        place(st),
      ]),
      {
        columnStyles: {
          0: { cellWidth: 12, fontStyle: "bold", halign: "center" },
          1: { cellWidth: 26 },
          2: { cellWidth: 20 },
          3: { cellWidth: "auto" },
        },
        didParseCell: (d) => {
          const r = stops[d.row.index];
          if (d.section === "body" && d.column.index === 0 && r)
            d.cell.styles.textColor = hex(tripColor(r.t.index));
        },
      },
    );
  }

  // ── Connection lost ───────────────────────────────────────────────────────
  if (report.signalLost.length) {
    w.section("Connection lost", "no report from the tracker; positions in between are missing");
    w.table(
      ["Time", "Lasted", "While", "Last known place"],
      report.signalLost.map((g) => [
        `${fmtTime(g.from)}–${g.ongoing ? "now" : fmtTime(g.to)}`,
        fmtDuration(g.ms),
        g.during === "trip" ? "on a trip" : "parked",
        place(g),
      ]),
      {
        columnStyles: {
          0: { cellWidth: 26 },
          1: { cellWidth: 20 },
          2: { cellWidth: 20 },
          3: { cellWidth: "auto" },
        },
        didParseCell: (d) => {
          if (d.section === "body" && d.column.index === 1) d.cell.styles.textColor = BRAND.danger;
        },
      },
    );
  }

  w.finish(`livetrack-${fileSafe(vehicle)}-${day}.pdf`);
}

// ── Period report (several days) ────────────────────────────────────────────

export interface RangeReportPdfInput {
  vehicle: string;
  plate: string | null;
  range: RangeSummary;
}

export async function generateRangeReportPdf(input: RangeReportPdfInput): Promise<void> {
  const { vehicle, plate, range: R } = input;
  const noon = (day: string) => `${day}T12:00:00+02:00`;
  const w = startDoc(
    "Vehicle report for a period",
    `${fmtDate(noon(R.from))} – ${fmtDate(noon(R.to))}`,
    `${R.days.length} days · Kigali time`,
  );
  w.vehicleCard(
    vehicle,
    plate,
    R.drivers.length
      ? `Driver${R.drivers.length > 1 ? "s" : ""}: ${R.drivers.join(", ")}`
      : "Driver: not assigned",
  );
  w.tiles([
    { label: "Distance", value: `${R.distanceKm.toFixed(0)} km`, color: BRAND.primary },
    { label: "Per week", value: `${R.perWeekKm.toFixed(0)} km`, color: BRAND.blue },
    { label: "Driving time", value: fmtDuration(R.drivingMs), color: BRAND.green },
    { label: "Trips", value: String(R.trips), color: BRAND.amber },
  ]);
  w.paragraph(
    `Used on ${R.activeDays} of ${R.days.length} days, ${R.perActiveDayKm.toFixed(0)} km on an average working day.` +
      (R.busiest
        ? ` Busiest day: ${fmtLongDate(noon(R.busiest.day))} (${R.busiest.distanceKm.toFixed(0)} km).`
        : "") +
      (R.trips ? ` Top speed ${R.topSpeedKmh.toFixed(0)} km/h.` : "") +
      (R.signalLost
        ? ` The tracker lost its connection ${R.signalLost} time${R.signalLost > 1 ? "s" : ""} (${fmtDuration(R.signalLostMs)} in total); distance covered while it was offline may be missing.`
        : ""),
  );

  const right = { halign: "right" as const };
  if (R.weeks.length > 1) {
    w.section("Week by week", "Monday to Sunday");
    w.table(
      ["Week", "Distance", "Driving", "Trips", "Days used"],
      R.weeks.map((wk) => [
        `${fmtDate(noon(wk.from))} – ${fmtDate(noon(wk.to))}`,
        `${wk.distanceKm.toFixed(1)} km`,
        fmtDuration(wk.drivingMs),
        String(wk.trips),
        `${wk.activeDays} of ${wk.days}`,
      ]),
      { columnStyles: { 1: right, 2: right, 3: right, 4: right } },
    );
  }

  w.section("Day by day");
  w.table(
    ["Day", "Distance", "Driving", "Trips", "Top speed", "Connection lost"],
    R.days.map((d) => [
      fmtShortDay(d.day),
      `${d.distanceKm.toFixed(1)} km`,
      d.trips ? fmtDuration(d.drivingMs) : "—",
      String(d.trips),
      d.trips ? `${d.topSpeedKmh.toFixed(0)} km/h` : "—",
      d.signalLost ? `${d.signalLost}× · ${fmtDuration(d.signalLostMs)}` : "—",
    ]),
    {
      columnStyles: { 1: right, 2: right, 3: right, 4: right, 5: right },
      didParseCell: (d) => {
        if (d.section === "body" && d.column.index === 5 && R.days[d.row.index]?.signalLost)
          d.cell.styles.textColor = BRAND.danger;
      },
    },
  );

  w.finish(`livetrack-${fileSafe(vehicle)}-${R.from}_to_${R.to}.pdf`);
}

// ── Shared page furniture ───────────────────────────────────────────────────

function startDoc(kind: string, rightTitle: string, rightSub: string) {
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
  doc.text(kind, M, 19.5);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text(rightTitle, W - M, 13, { align: "right" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.text(rightSub, W - M, 19.5, { align: "right" });

  const w = {
    y: 38,
    vehicleCard(vehicle: string, plate: string | null, line2: string) {
      const y = w.y;
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
      doc.text(line2, M + 4, y + 18.5);
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
      w.y += 28;
    },
    tiles(tiles: Array<{ label: string; value: string; color: RGB }>) {
      const gap = 3;
      const tw = (W - 2 * M - gap * (tiles.length - 1)) / tiles.length;
      const th = 17;
      tiles.forEach((t, i) => {
        const x = M + i * (tw + gap);
        doc.setDrawColor(...BRAND.line);
        doc.setFillColor(255, 255, 255);
        doc.roundedRect(x, w.y, tw, th, 2, 2, "FD");
        doc.setFillColor(...t.color);
        doc.rect(x, w.y, 1.3, th, "F");
        doc.setTextColor(...BRAND.muted);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(6.8);
        doc.text(t.label.toUpperCase(), x + 4, w.y + 6);
        doc.setTextColor(...BRAND.ink);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(11.5);
        doc.text(t.value, x + 4, w.y + 13);
      });
      w.y += th + 6;
    },
    paragraph(text: string) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.setTextColor(...BRAND.muted);
      const lines = doc.splitTextToSize(text, W - 2 * M);
      doc.text(lines, M, w.y);
      w.y += lines.length * 4.2 + 5;
    },
    section(title: string, note?: string) {
      if (w.y > H - 40) {
        doc.addPage();
        w.y = 18;
      }
      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
      doc.setTextColor(...BRAND.ink);
      doc.text(title, M, w.y);
      const titleW = doc.getTextWidth(title);
      if (note) {
        doc.setFont("helvetica", "normal");
        doc.setFontSize(8);
        doc.setTextColor(...BRAND.muted);
        doc.text(note, M + titleW + 3, w.y, { maxWidth: W - 2 * M - titleW - 3 });
      }
      w.y += 2.5;
    },
    table(head: string[], body: string[][], opts: Parameters<typeof autoTable>[1] = {}) {
      autoTable(doc, {
        startY: w.y,
        margin: { left: M, right: M },
        head: [head],
        body,
        headStyles: { fillColor: BRAND.primary, textColor: 255, fontStyle: "bold", fontSize: 8.5 },
        alternateRowStyles: { fillColor: BRAND.tileBg },
        styles: { fontSize: 8.5, cellPadding: 2, textColor: BRAND.ink, overflow: "linebreak" },
        ...opts,
      });
      // @ts-expect-error autoTable augments the doc with lastAutoTable
      w.y = doc.lastAutoTable.finalY + 7;
    },
    /** Footer on every page, then download. */
    finish(filename: string) {
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
      doc.save(filename);
    },
  };
  return w;
}
