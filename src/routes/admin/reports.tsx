import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  BarChart3,
  Download,
  FileText,
  Users,
  UserX,
  Bus as BusIcon,
  CalendarDays,
} from "lucide-react";
import { AppShell, PageHeader, useCurrentSchool } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  EmptyState,
  Loading,
  MigrationNotice,
  NativeSelect,
  Panel,
  StatCard,
  StudentAvatar,
} from "@/components/school/ui";
import { db } from "@/lib/fleet";
import {
  kigaliDate,
  toCsv,
  usageByStudent,
  type RideRow,
  type RiderStatus,
  type Run,
} from "@/lib/attendance";
import { busName, isMissingTable, type BusLite, type StudentRow } from "@/lib/school";

export const Route = createFileRoute("/admin/reports")({
  head: () => ({ meta: [{ title: "Attendance reports — Live Track" }] }),
  component: () => (
    <AppShell>
      <ReportsPage />
    </AppShell>
  ),
});

type Preset = "week" | "month" | "last30" | "custom";

function presetRange(p: Preset, today: string): { from: string; to: string } {
  const d = new Date(`${today}T12:00:00Z`);
  const iso = (x: Date) => x.toISOString().slice(0, 10);
  if (p === "week") {
    const dow = (d.getUTCDay() + 6) % 7;
    return { from: iso(new Date(d.getTime() - dow * 86_400_000)), to: today };
  }
  if (p === "month") return { from: `${today.slice(0, 8)}01`, to: today };
  return { from: iso(new Date(d.getTime() - 29 * 86_400_000)), to: today };
}

interface Row extends RideRow {
  bus_id: string;
}

const isRide = (s: RiderStatus) => s === "boarded" || s === "dropped_off";

function download(name: string, text: string, type = "text/csv;charset=utf-8") {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

function ReportsPage() {
  const { school, schoolId } = useCurrentSchool();
  const today = kigaliDate();
  const [preset, setPreset] = useState<Preset>("month");
  const [range, setRange] = useState(presetRange("month", today));
  const [busFilter, setBusFilter] = useState("all");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [students, setStudents] = useState<Map<string, StudentRow>>(new Map());
  const [buses, setBuses] = useState<BusLite[]>([]);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    if (preset !== "custom") setRange(presetRange(preset, today));
  }, [preset, today]);

  useEffect(() => {
    if (!schoolId) return;
    let alive = true;
    setRows(null);
    (async () => {
      const [s, b] = await Promise.all([
        db.from("students").select("id, name, class, photo_url, bus_id").eq("school_id", schoolId),
        db.from("buses").select("*").eq("school_id", schoolId).order("label"),
      ]);
      // Page through: a month for a big school is tens of thousands of rows.
      const out: Row[] = [];
      for (let from = 0; from < 200_000; from += 1000) {
        const { data, error } = await db
          .from("trip_students")
          .select("student_id, status, bus_trips!inner(service_date, run, bus_id, school_id)")
          .eq("bus_trips.school_id", schoolId)
          .gte("bus_trips.service_date", range.from)
          .lte("bus_trips.service_date", range.to)
          .range(from, from + 999);
        if (isMissingTable(error)) {
          if (alive) setMissing(true);
          return;
        }
        if (error) {
          toast.error("Couldn't load the report");
          break;
        }
        const page = (data ?? []) as unknown as {
          student_id: string;
          status: RiderStatus;
          bus_trips: { service_date: string; run: Run; bus_id: string };
        }[];
        out.push(
          ...page.map((r) => ({
            student_id: r.student_id,
            status: r.status,
            service_date: r.bus_trips.service_date,
            run: r.bus_trips.run,
            bus_id: r.bus_trips.bus_id,
          })),
        );
        if (page.length < 1000) break;
      }
      if (!alive) return;
      setStudents(new Map(((s.data ?? []) as StudentRow[]).map((x) => [x.id, x])));
      setBuses((b.data ?? []) as BusLite[]);
      setRows(out);
    })();
    return () => {
      alive = false;
    };
  }, [schoolId, range.from, range.to]);

  const filtered = useMemo(
    () => (rows ?? []).filter((r) => busFilter === "all" || r.bus_id === busFilter),
    [rows, busFilter],
  );
  const usage = useMemo(() => usageByStudent(filtered), [filtered]);
  const days = useMemo(() => {
    const m = new Map<
      string,
      {
        am: number;
        amPlanned: number;
        pm: number;
        pmPlanned: number;
        noShow: number;
        notRiding: number;
      }
    >();
    for (const r of filtered) {
      const d = m.get(r.service_date) ?? {
        am: 0,
        amPlanned: 0,
        pm: 0,
        pmPlanned: 0,
        noShow: 0,
        notRiding: 0,
      };
      const planned = r.status !== "not_riding";
      if (r.run === "morning") {
        d.amPlanned += planned ? 1 : 0;
        d.am += isRide(r.status) ? 1 : 0;
      } else {
        d.pmPlanned += planned ? 1 : 0;
        d.pm += isRide(r.status) ? 1 : 0;
      }
      if (r.status === "no_show") d.noShow++;
      if (r.status === "not_riding") d.notRiding++;
      m.set(r.service_date, d);
    }
    return [...m.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [filtered]);

  const rides = filtered.filter((r) => isRide(r.status)).length;
  const planned = filtered.filter((r) => r.status !== "not_riding").length;
  const noShows = filtered.filter((r) => r.status === "no_show").length;
  const perStudent = [...usage.entries()]
    .map(([id, u]) => ({ s: students.get(id), id, ...u }))
    .sort((a, b) => b.rides - a.rides);
  const label = `${range.from} to ${range.to}`;

  function exportDaily() {
    download(
      `attendance-daily-${range.from}-${range.to}.csv`,
      toCsv([
        [
          "Date",
          "Morning rode",
          "Morning expected",
          "Afternoon rode",
          "Afternoon expected",
          "Missed the bus",
          "Not riding (notice)",
        ],
        ...days.map(([d, x]) => [d, x.am, x.amPlanned, x.pm, x.pmPlanned, x.noShow, x.notRiding]),
      ]),
    );
  }
  function exportStudents() {
    download(
      `attendance-students-${range.from}-${range.to}.csv`,
      toCsv([
        [
          "Student",
          "Class",
          "Bus",
          "Trips on list",
          "Rides",
          "Missed the bus",
          "Not riding (notice)",
          "Ridership %",
        ],
        ...perStudent.map((p) => [
          p.s?.name ?? p.id,
          p.s?.class ?? "",
          busName(buses.find((b) => b.id === p.s?.bus_id)),
          p.trips,
          p.rides,
          p.noShows,
          p.notRiding,
          Math.round(p.rate * 100),
        ]),
      ]),
    );
  }
  async function exportPdf() {
    const { default: jsPDF } = await import("jspdf");
    const { default: autoTable } = await import("jspdf-autotable");
    const doc = new jsPDF({ unit: "pt", format: "a4" });
    doc.setFontSize(16);
    doc.text(`${school?.name ?? "School"} — bus attendance`, 40, 50);
    doc.setFontSize(10);
    doc.setTextColor(110);
    doc.text(
      `${label}${busFilter !== "all" ? ` · ${busName(buses.find((b) => b.id === busFilter))}` : ""} · ${rides} rides, ${noShows} no-shows`,
      40,
      68,
    );
    autoTable(doc, {
      startY: 86,
      head: [["Date", "Morning", "Afternoon", "Missed the bus", "Not riding"]],
      body: days.map(([d, x]) => [
        d,
        `${x.am}/${x.amPlanned}`,
        `${x.pm}/${x.pmPlanned}`,
        x.noShow,
        x.notRiding,
      ]),
      styles: { fontSize: 9 },
      headStyles: { fillColor: [79, 70, 229] },
    });
    autoTable(doc, {
      head: [["Student", "Class", "Rides", "Missed the bus", "Not riding", "Ridership"]],
      body: perStudent.map((p) => [
        p.s?.name ?? "",
        p.s?.class ?? "",
        p.rides,
        p.noShows,
        p.notRiding,
        `${Math.round(p.rate * 100)}%`,
      ]),
      styles: { fontSize: 9 },
      headStyles: { fillColor: [79, 70, 229] },
    });
    doc.save(`attendance-${range.from}-${range.to}.pdf`);
  }

  if (missing)
    return (
      <>
        <PageHeader title="Attendance reports" />
        <MigrationNotice />
      </>
    );

  return (
    <>
      <PageHeader
        title="Attendance reports"
        description="Who rode, who didn't, and why — per day and per child. Export for parents, billing or the ministry."
        actions={
          <>
            <Button variant="outline" onClick={exportDaily} disabled={!days.length}>
              <Download className="h-4 w-4 mr-1.5" /> Daily (Excel)
            </Button>
            <Button variant="outline" onClick={exportStudents} disabled={!perStudent.length}>
              <Download className="h-4 w-4 mr-1.5" /> Per child (Excel)
            </Button>
            <Button
              onClick={() => void exportPdf()}
              disabled={!days.length}
              className="bg-gradient-primary"
            >
              <FileText className="h-4 w-4 mr-1.5" /> PDF
            </Button>
          </>
        }
      />
      <div className="flex flex-wrap items-center gap-2 mb-5">
        {(
          [
            ["week", "This week"],
            ["month", "This month"],
            ["last30", "Last 30 days"],
            ["custom", "Custom"],
          ] as const
        ).map(([k, l]) => (
          <button
            key={k}
            onClick={() => setPreset(k)}
            className={`h-9 px-4 rounded-full text-sm font-medium border ${preset === k ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground"}`}
          >
            {l}
          </button>
        ))}
        {preset === "custom" && (
          <>
            <Input
              type="date"
              value={range.from}
              max={range.to}
              onChange={(e) => setRange((r) => ({ ...r, from: e.target.value || r.from }))}
              className="w-auto"
            />
            <Input
              type="date"
              value={range.to}
              min={range.from}
              max={today}
              onChange={(e) => setRange((r) => ({ ...r, to: e.target.value || r.to }))}
              className="w-auto"
            />
          </>
        )}
        <NativeSelect value={busFilter} onChange={setBusFilter} className="w-auto">
          <option value="all">All buses</option>
          {buses.map((b) => (
            <option key={b.id} value={b.id}>
              {busName(b)}
            </option>
          ))}
        </NativeSelect>
      </div>

      {rows == null ? (
        <Loading label="Building the report…" />
      ) : !filtered.length ? (
        <Panel>
          <EmptyState Icon={BarChart3} title="No trips in this period">
            Reports fill up as attendants mark children on the bus.
          </EmptyState>
        </Panel>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-6">
            <StatCard label="School days" value={days.length} Icon={CalendarDays} />
            <StatCard
              label="Rides"
              value={rides.toLocaleString()}
              hint={`${planned ? Math.round((rides / planned) * 100) : 0}% of planned seats`}
              Icon={BusIcon}
              tone="success"
            />
            <StatCard
              label="Missed the bus"
              value={noShows}
              hint="Not at the stop, parent gave no notice"
              Icon={UserX}
              tone={noShows ? "warning" : "neutral"}
            />
            <StatCard
              label="Children riding"
              value={perStudent.filter((p) => p.rides > 0).length}
              Icon={Users}
              tone="info"
            />
          </div>
          <div className="grid gap-5 xl:grid-cols-2">
            <Panel title="By day" bodyClassName="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-xs text-muted-foreground">
                    <tr className="border-b border-border">
                      <th className="text-left font-medium px-4 py-2">Date</th>
                      <th className="text-right font-medium px-4 py-2">Morning</th>
                      <th className="text-right font-medium px-4 py-2">Afternoon</th>
                      <th className="text-right font-medium px-4 py-2">Missed bus</th>
                    </tr>
                  </thead>
                  <tbody>
                    {days.map(([d, x]) => (
                      <tr key={d} className="border-b border-border/60 last:border-0">
                        <td className="px-4 py-2 whitespace-nowrap">
                          {new Date(`${d}T12:00:00`).toLocaleDateString("en-GB", {
                            weekday: "short",
                            day: "numeric",
                            month: "short",
                          })}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums">
                          {x.am}
                          <span className="text-muted-foreground">/{x.amPlanned}</span>
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums">
                          {x.pm}
                          <span className="text-muted-foreground">/{x.pmPlanned}</span>
                        </td>
                        <td
                          className={`px-4 py-2 text-right tabular-nums ${x.noShow ? "text-warning font-medium" : "text-muted-foreground"}`}
                        >
                          {x.noShow}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
            <Panel
              title="By child"
              description="Actual use — for planning seats and fair transport fees"
              bodyClassName="p-0"
            >
              <ul className="divide-y divide-border max-h-[560px] overflow-y-auto">
                {perStudent.map((p) => (
                  <li key={p.id} className="flex items-center gap-3 px-4 py-2.5">
                    <StudentAvatar name={p.s?.name ?? "?"} photo={p.s?.photo_url} size={30} />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium truncate">{p.s?.name ?? "Student"}</div>
                      <div className="h-1.5 mt-1 rounded-full bg-muted overflow-hidden">
                        <div
                          className="h-full bg-primary"
                          style={{ width: `${Math.round(p.rate * 100)}%` }}
                        />
                      </div>
                    </div>
                    <div className="text-right text-xs tabular-nums w-28">
                      <div>
                        <b className="text-sm">{p.rides}</b> rides
                      </div>
                      <div className="text-muted-foreground">
                        {p.noShows} missed · {p.notRiding} not riding (parent said)
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </Panel>
          </div>
        </>
      )}
    </>
  );
}
