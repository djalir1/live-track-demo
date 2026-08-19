import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { format } from "date-fns";
import type { TripSummary } from "./trip";
import { formatDurationMinutes, selectWaypoints } from "./trip";
import { getVehicle, type VehicleType } from "./vehicles";
import { reverseGeocode, reverseGeocodeAddress } from "./geocode";

export interface ReportInput {
  driverName: string;
  vehicleName: string | null;
  vehicleType: VehicleType;
  plateNumber: string | null;
  seats: number | null;
  date: Date;
  trip: TripSummary;
}

// Brand palette (RGB) — kept in one place so a rebrand is one edit.
const BRAND = {
  primary: [88, 80, 236] as [number, number, number],
  primaryDark: [56, 48, 180] as [number, number, number],
  ink: [24, 27, 40] as [number, number, number],
  muted: [110, 116, 138] as [number, number, number],
  line: [225, 228, 235] as [number, number, number],
  tileBg: [246, 247, 251] as [number, number, number],
  moving: [34, 197, 94] as [number, number, number],
  stopped: [59, 130, 246] as [number, number, number],
  amber: [245, 158, 11] as [number, number, number],
  danger: [239, 68, 68] as [number, number, number],
};

export async function generateTripReport(input: ReportInput): Promise<void> {
  const { driverName, vehicleName, vehicleType, plateNumber, seats, date, trip } = input;
  const vehicle = getVehicle(vehicleType);

  const startPt = trip.points[0];
  const endPt = trip.points[trip.points.length - 1];
  const waypoints = selectWaypoints(trip.points);
  // Rate-limited queue lives inside geocode.ts (1 request/second globally). We
  // fire everything here in parallel and let the queue serialize the network.
  const [startRec, endRec, stopAddrs, waypointAddrs] = await Promise.all([
    startPt ? reverseGeocodeAddress(startPt.latitude, startPt.longitude) : Promise.resolve(null),
    endPt ? reverseGeocodeAddress(endPt.latitude, endPt.longitude) : Promise.resolve(null),
    Promise.all(trip.stops.map((s) => reverseGeocode(s.lat, s.lon))),
    Promise.all(waypoints.map((p) => reverseGeocode(p.latitude, p.longitude))),
  ]);
  const startAddr = startRec?.label ?? null;
  const endAddr = endRec?.label ?? null;
  // District for the report header: prefer the start point's district, fall back to end.
  const district =
    startRec?.parts.city_district ?? startRec?.parts.county ??
    endRec?.parts.city_district ?? endRec?.parts.county ?? null;
  const city = startRec?.parts.city ?? endRec?.parts.city ?? null;

  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 15;

  // -------- Header band --------
  doc.setFillColor(...BRAND.primary);
  doc.rect(0, 0, W, 34, "F");
  doc.setFillColor(...BRAND.primaryDark);
  doc.rect(0, 30, W, 4, "F");

  doc.setTextColor(255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(22);
  doc.text("PULSE", M, 15);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text("Daily Trip Report", M, 21);

  doc.setFontSize(11);
  doc.setFont("helvetica", "bold");
  doc.text(format(date, "EEEE, LLLL d, yyyy"), W - M, 15, { align: "right" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text(format(date, "yyyy-MM-dd"), W - M, 21, { align: "right" });
  if (district || city) {
    doc.setFontSize(8);
    doc.text([city, district].filter(Boolean).join(" · "), W - M, 27, { align: "right" });
  }

  // -------- Driver / vehicle identity card --------
  let y = 46;
  doc.setDrawColor(...BRAND.line);
  doc.setFillColor(255, 255, 255);
  doc.roundedRect(M, y, W - M * 2, 30, 3, 3, "S");

  doc.setTextColor(...BRAND.muted);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.text("DRIVER", M + 5, y + 7);
  doc.setTextColor(...BRAND.ink);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.text(driverName, M + 5, y + 15);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...BRAND.muted);
  const vehParts = [vehicle.label];
  if (vehicleName) vehParts.push(vehicleName);
  if (seats != null) vehParts.push(`${seats} seats`);
  doc.text(vehParts.join(" · "), M + 5, y + 22);

  // Plate on the right
  if (plateNumber) {
    doc.setDrawColor(...BRAND.ink);
    doc.setFillColor(...BRAND.tileBg);
    const plateW = 46;
    const plateX = W - M - 5 - plateW;
    const plateY = y + 8;
    doc.roundedRect(plateX, plateY, plateW, 14, 2, 2, "FD");
    doc.setTextColor(...BRAND.muted);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(6);
    doc.text("PLATE", plateX + 3, plateY + 4);
    doc.setTextColor(...BRAND.ink);
    doc.setFont("courier", "bold");
    doc.setFontSize(13);
    doc.text(plateNumber, plateX + plateW / 2, plateY + 11, { align: "center" });
  }

  y += 40;

  // -------- Summary tiles --------
  const tiles: Array<{ label: string; value: string; color: [number, number, number] }> = [
    { label: "Distance",        value: `${trip.totalDistanceKm.toFixed(2)} km`,        color: BRAND.primary },
    { label: "Driving time",    value: formatDurationMinutes(trip.totalMovingMinutes), color: BRAND.moving },
    { label: "Stopped time",    value: formatDurationMinutes(trip.totalStoppedMinutes), color: BRAND.amber },
    { label: "Top speed",       value: `${trip.topSpeedKmh.toFixed(0)} km/h`,          color: BRAND.stopped },
    { label: "Avg moving speed",value: `${trip.averageMovingSpeedKmh.toFixed(0)} km/h`, color: BRAND.primary },
    { label: "Stops",           value: `${trip.stops.length}`,                          color: BRAND.amber },
  ];
  const cols = 3;
  const gap = 4;
  const tileW = (W - M * 2 - gap * (cols - 1)) / cols;
  const tileH = 22;
  tiles.forEach((t, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = M + col * (tileW + gap);
    const yy = y + row * (tileH + gap);
    doc.setDrawColor(...BRAND.line);
    doc.setFillColor(255, 255, 255);
    doc.roundedRect(x, yy, tileW, tileH, 2.5, 2.5, "FD");
    // Colored side bar
    doc.setFillColor(...t.color);
    doc.rect(x, yy, 1.5, tileH, "F");
    doc.setTextColor(...BRAND.muted);
    doc.setFontSize(7);
    doc.setFont("helvetica", "normal");
    doc.text(t.label.toUpperCase(), x + 5, yy + 7);
    doc.setTextColor(...BRAND.ink);
    doc.setFontSize(13);
    doc.setFont("helvetica", "bold");
    doc.text(t.value, x + 5, yy + 16);
  });
  y += Math.ceil(tiles.length / cols) * (tileH + gap) + 5;

  // -------- Route overview: start / end + battery --------
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(...BRAND.ink);
  doc.text("Route overview", M, y);
  y += 5;

  const batteryStart = trip.points[0]?.battery_level ?? null;
  const batteryEnd = trip.points[trip.points.length - 1]?.battery_level ?? null;
  const batteryDrop = batteryStart != null && batteryEnd != null ? batteryStart - batteryEnd : null;

  const infoLines: Array<{ label: string; value: string; color?: [number, number, number] }> = [];
  if (trip.startedAt) infoLines.push({
    label: "Started",
    value: `${format(new Date(trip.startedAt), "p")}${trip.startedAtApprox ? " (approx)" : ""} — ${startAddr ?? "—"}`,
  });
  if (trip.endedAt) infoLines.push({
    label: "Ended",
    value: `${format(new Date(trip.endedAt), "p")}${trip.endedAtApprox ? " (approx)" : ""} — ${endAddr ?? "—"}`,
  });
  if (batteryStart != null) infoLines.push({ label: "Battery at start", value: `${batteryStart}%`, color: batteryStart <= 20 ? BRAND.danger : BRAND.moving });
  if (batteryEnd != null) infoLines.push({ label: "Battery at end", value: `${batteryEnd}%${batteryDrop != null ? ` (dropped ${batteryDrop}%)` : ""}`, color: batteryEnd <= 20 ? BRAND.danger : BRAND.stopped });

  doc.setDrawColor(...BRAND.line);
  doc.setFillColor(...BRAND.tileBg);
  const overviewH = infoLines.length * 6 + 6;
  doc.roundedRect(M, y, W - M * 2, overviewH, 2.5, 2.5, "FD");
  let iy = y + 6;
  for (const line of infoLines) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.5);
    doc.setTextColor(...BRAND.muted);
    doc.text(line.label + ":", M + 4, iy);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(...(line.color ?? BRAND.ink));
    doc.text(line.value, M + 34, iy);
    iy += 6;
  }
  y += overviewH + 6;

  // -------- Signal-lost segments --------
  if (trip.gaps.length > 0) {
    if (y > H - 60) { doc.addPage(); y = 20; }
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(...BRAND.danger);
    doc.text(`Signal lost (${trip.gaps.length})`, M, y);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...BRAND.muted);
    doc.text("intervals excluded from distance and driving time", M + 40, y);
    y += 3;
    autoTable(doc, {
      startY: y,
      margin: { left: M, right: M },
      head: [["From", "To", "Duration", "Discarded jump"]],
      body: trip.gaps.map((g) => [
        format(new Date(g.from), "HH:mm"),
        format(new Date(g.to), "HH:mm"),
        formatDurationMinutes(g.durationMinutes),
        `${g.jumpedKm.toFixed(1)} km`,
      ]),
      headStyles: {
        fillColor: BRAND.danger,
        textColor: 255,
        fontStyle: "bold",
        fontSize: 9,
      },
      alternateRowStyles: { fillColor: BRAND.tileBg },
      styles: { fontSize: 9, cellPadding: 2.5, textColor: BRAND.ink },
    });
    // @ts-expect-error autoTable augments the doc with lastAutoTable
    y = doc.lastAutoTable.finalY + 8;
  }

  // -------- Stops table --------
  if (trip.stops.length > 0) {
    if (y > H - 60) { doc.addPage(); y = 20; }
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(...BRAND.ink);
    doc.text(`Stops (${trip.stops.length})`, M, y);
    y += 3;
    autoTable(doc, {
      startY: y,
      margin: { left: M, right: M },
      head: [["#", "Started", "Ended", "Duration", "Location"]],
      body: trip.stops.map((s, i) => [
        i + 1,
        format(new Date(s.startedAt), "HH:mm"),
        format(new Date(s.endedAt), "HH:mm"),
        formatDurationMinutes(s.durationMinutes),
        stopAddrs[i] ?? "—",
      ]),
      headStyles: {
        fillColor: BRAND.primary,
        textColor: 255,
        fontStyle: "bold",
        fontSize: 9,
      },
      alternateRowStyles: { fillColor: BRAND.tileBg },
      styles: { fontSize: 9, cellPadding: 2.5, textColor: BRAND.ink },
      columnStyles: {
        0: { cellWidth: 8, halign: "center" },
        1: { cellWidth: 20 },
        2: { cellWidth: 20 },
        3: { cellWidth: 22 },
        4: { cellWidth: "auto" },
      },
    });
    // @ts-expect-error autoTable augments the doc with lastAutoTable
    y = doc.lastAutoTable.finalY + 8;
  }

  // -------- Route narrative (waypoints) --------
  if (waypoints.length > 0) {
    if (y > H - 60) { doc.addPage(); y = 20; }
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(...BRAND.ink);
    doc.text(`Route (${waypoints.length + 2} places)`, M, y);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...BRAND.muted);
    doc.text("sparse waypoints between Start and End · names from OpenStreetMap", M + 44, y);
    y += 3;
    const rows: (string | number)[][] = [];
    if (startPt && startAddr) rows.push(["Start", format(new Date(startPt.recorded_at), "HH:mm"), startAddr]);
    waypoints.forEach((p, i) => {
      rows.push([
        `${i + 1}`,
        format(new Date(p.recorded_at), "HH:mm"),
        waypointAddrs[i] ?? "—",
      ]);
    });
    if (endPt && endAddr) rows.push(["End", format(new Date(endPt.recorded_at), "HH:mm"), endAddr]);
    autoTable(doc, {
      startY: y,
      margin: { left: M, right: M },
      head: [["#", "Time", "Place"]],
      body: rows,
      headStyles: {
        fillColor: BRAND.primary,
        textColor: 255,
        fontStyle: "bold",
        fontSize: 9,
      },
      alternateRowStyles: { fillColor: BRAND.tileBg },
      styles: { fontSize: 9, cellPadding: 2.2, textColor: BRAND.ink },
      columnStyles: {
        0: { cellWidth: 14, halign: "center", fontStyle: "bold" },
        1: { cellWidth: 20 },
        2: { cellWidth: "auto" },
      },
    });
  }

  // -------- Footer on every page --------
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setDrawColor(...BRAND.line);
    doc.line(M, H - 12, W - M, H - 12);
    doc.setFontSize(7.5);
    doc.setTextColor(...BRAND.muted);
    doc.setFont("helvetica", "normal");
    doc.text(`Pulse Tracking · Generated ${format(new Date(), "PPpp")}`, M, H - 7);
    doc.text(`Page ${i} of ${pageCount}`, W - M, H - 7, { align: "right" });
  }

  const fname = `pulse-${driverName.replace(/\s+/g, "_")}-${format(date, "yyyy-MM-dd")}.pdf`;
  doc.save(fname);
}
