import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import {
  busName,
  formatPeriod,
  loadHistory,
  type Assignment,
  type Bus,
  type Driver,
} from "@/lib/fleet";
import { friendlyError } from "@/lib/friendly-errors";

/** Who drove a vehicle, or which vehicles a driver drove, newest first. */
export function AssignmentHistory({
  busId,
  driverId,
  buses,
  drivers,
}: {
  busId?: string;
  driverId?: string;
  buses: Bus[];
  drivers: Driver[];
}) {
  const [rows, setRows] = useState<Assignment[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    loadHistory({ busId, driverId })
      .then((r) => live && setRows(r))
      .catch((e) => live && setError(friendlyError(e, "Couldn't load history.")));
    return () => {
      live = false;
    };
  }, [busId, driverId]);

  if (error) return <p className="text-xs text-destructive">{error}</p>;
  if (!rows)
    return (
      <p className="text-xs text-muted-foreground flex items-center gap-1.5">
        <Loader2 className="h-3 w-3 animate-spin" /> Loading history…
      </p>
    );
  if (!rows.length) return <p className="text-xs text-muted-foreground italic">No history yet.</p>;

  return (
    <ol className="space-y-1.5">
      {rows.map((a) => {
        const who = busId
          ? (drivers.find((d) => d.id === a.driver_id)?.full_name ?? "Removed driver")
          : busName(buses.find((b) => b.id === a.bus_id));
        return (
          <li key={a.id} className="text-xs flex flex-col sm:flex-row sm:items-center sm:gap-2">
            <span className="font-medium flex items-center gap-1.5">
              <span
                className={`h-1.5 w-1.5 rounded-full ${a.ended_at ? "bg-muted-foreground/50" : "bg-primary"}`}
              />
              {who}
              {!a.ended_at && <span className="text-[10px] text-primary">current</span>}
            </span>
            <span className="text-muted-foreground pl-3 sm:pl-0">{formatPeriod(a)}</span>
          </li>
        );
      })}
    </ol>
  );
}
