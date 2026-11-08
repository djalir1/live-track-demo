/**
 * Pure-logic tests for src/lib/attendance.ts and src/lib/phone.ts.
 * Run with: npx tsx scripts/test-attendance.ts
 */
import {
  compareWithRegister,
  countTrip,
  groupByStop,
  parseCsv,
  toCsv,
  usageByStudent,
  type RiderLite,
} from "../src/lib/attendance";
import { accountEmail, formatPhone, looksLikePhone, normalizePhone } from "../src/lib/phone";

let failed = 0;
function ok(name: string, cond: boolean, got?: unknown) {
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${name}${cond || got === undefined ? "" : `  got=${JSON.stringify(got)}`}`);
  if (!cond) failed++;
}

console.log("Phone numbers");
ok("0788 123 456", normalizePhone("0788 123 456") === "250788123456");
ok("+250 788-123-456", normalizePhone("+250 788-123-456") === "250788123456");
ok("788123456", normalizePhone("788123456") === "250788123456");
ok("rejects 'abc'", normalizePhone("abc") === null);
ok("rejects too short", normalizePhone("0788") === null);
ok("formats", formatPhone("250788123456") === "+250 788 123 456", formatPhone("250788123456"));
ok("parent email", accountEmail("250788123456", "parent") === "250788123456@parent.livetrack.app");
ok("email is not a phone", !looksLikePhone("admin@school.rw") && looksLikePhone("0788123456"));

console.log("Bus list vs class register (plan p.4)");
ok("boarded + in class = all good", compareWithRegister("dropped_off", true) === "ok");
ok("not riding + in class = came by car", compareWithRegister("not_riding", true) === "came_by_car");
ok("no-show + in class = came another way", compareWithRegister("no_show", true) === "came_another_way");
ok("not riding + absent = excused", compareWithRegister("not_riding", false) === "absent_excused");
ok("no-show + absent = check now", compareWithRegister("no_show", false) === "check_now");
ok("boarded + not in class = URGENT", compareWithRegister("boarded", false) === "urgent");
ok("register not taken = unknown", compareWithRegister("boarded", null) === "unknown");

console.log("Trip list");
const riders: RiderLite[] = [
  { student_id: "a", status: "boarded", stop_id: "s1" },
  { student_id: "b", status: "expected", stop_id: "s2" },
  { student_id: "c", status: "not_riding", stop_id: "s2" },
  { student_id: "d", status: "no_show", stop_id: null },
];
const c = countTrip(riders);
ok("counts", c.onBoard === 1 && c.expected === 1 && c.notRiding === 1 && c.noShow === 1 && c.pending === 2, c);
const stops = [
  { id: "s1", name: "Kimironko", sequence: 1 },
  { id: "s2", name: "Remera", sequence: 2 },
  { id: "sch", name: "School", sequence: 3, type: "school" },
];
const am = groupByStop(riders, stops, "morning", null).map((g) => g.stop?.name ?? "none");
ok("morning order + no-stop last", am.join() === "Kimironko,Remera,none", am);
const pm = groupByStop(riders, stops, "afternoon", null).map((g) => g.stop?.name ?? "none");
ok("afternoon runs backwards", pm.join() === "Remera,Kimironko,none", pm);
const here = groupByStop(riders, stops, "morning", "s2");
ok("stop the bus is at goes first", here[0].stop?.id === "s2" && here[0].isCurrent);

console.log("Reports");
const u = usageByStudent([
  { student_id: "a", service_date: "2026-11-02", run: "morning", status: "boarded" },
  { student_id: "a", service_date: "2026-11-02", run: "afternoon", status: "dropped_off" },
  { student_id: "a", service_date: "2026-11-03", run: "morning", status: "not_riding" },
  { student_id: "a", service_date: "2026-11-03", run: "afternoon", status: "no_show" },
]).get("a")!;
ok("2 rides, 1 no-show, 1 excused, 67% ridership", u.rides === 2 && u.noShows === 1 && u.notRiding === 1 && Math.abs(u.rate - 2 / 3) < 1e-9, u);

console.log("CSV");
const csv = toCsv([["name", "class"], ['Amina "Mimi" Uwase', "P3, A"]]);
const back = parseCsv(csv);
ok("round-trip with quotes and commas", back[1][0] === 'Amina "Mimi" Uwase' && back[1][1] === "P3, A", back);
ok("semicolon CSV (French Excel)", parseCsv("name;class\nBrian;P5")[1].join() === "Brian,P5");

console.log(failed ? `\n${failed} FAILED` : "\nAll passed");
process.exit(failed ? 1 : 0);
