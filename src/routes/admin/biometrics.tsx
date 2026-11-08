import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Fingerprint,
  Plus,
  Cpu,
  ShieldCheck,
  Usb,
  CreditCard,
  ScanFace,
  Trash2,
} from "lucide-react";
import { AppShell, PageHeader, useCurrentSchool } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  EmptyState,
  Field,
  MigrationNotice,
  NativeSelect,
  Panel,
  Pill,
  StatCard,
  UnderConstruction,
} from "@/components/school/ui";
import { db } from "@/lib/fleet";
import { friendlyError } from "@/lib/friendly-errors";
import { FINGERPRINT_STATUS } from "@/lib/biometrics";
import { busName, isMissingTable, type BusLite } from "@/lib/school";

export const Route = createFileRoute("/admin/biometrics")({
  head: () => ({ meta: [{ title: "Fingerprint check-in — Live Track" }] }),
  component: () => (
    <AppShell>
      <BiometricsPage />
    </AppShell>
  ),
});

interface Device {
  id: string;
  bus_id: string | null;
  kind: "fingerprint" | "card" | "face";
  name: string;
  model: string | null;
  serial: string | null;
  status: string;
}

const STEPS = [
  {
    Icon: ShieldCheck,
    title: "Consent and legal check",
    text: "Parents sign consent on the Students page. Register the processing with the national data protection authority (Law N° 058/2021).",
  },
  {
    Icon: Cpu,
    title: "Choose and buy the readers",
    text: "One fingerprint reader per bus, plugged into the attendant's Android phone (USB-OTG). See ATTENDANCE_SYSTEM.md for models and prices.",
  },
  {
    Icon: Usb,
    title: "Connect the reader driver",
    text: "We add the reader's Android SDK to the app. Nothing else changes: a match calls the same check-in as a tap.",
  },
  {
    Icon: Fingerprint,
    title: "Enrol each child",
    text: "Two fingers per child at school, once. Only the reader's encrypted template is kept — never a fingerprint image.",
  },
];

function BiometricsPage() {
  const { schoolId } = useCurrentSchool();
  const [devices, setDevices] = useState<Device[]>([]);
  const [buses, setBuses] = useState<BusLite[]>([]);
  const [consent, setConsent] = useState({ yes: 0, total: 0 });
  const [missing, setMissing] = useState(false);
  const [name, setName] = useState("");
  const [model, setModel] = useState("");
  const [bus, setBus] = useState("");

  async function load() {
    if (!schoolId) return;
    const [d, b, s] = await Promise.all([
      db.from("biometric_devices").select("*").eq("school_id", schoolId).order("created_at"),
      db.from("buses").select("*").eq("school_id", schoolId).order("label"),
      db.from("students").select("biometric_consent").eq("school_id", schoolId).eq("active", true),
    ]);
    if (isMissingTable(d.error)) return setMissing(true);
    setDevices((d.data ?? []) as Device[]);
    setBuses((b.data ?? []) as BusLite[]);
    const list = (s.data ?? []) as { biometric_consent: boolean }[];
    setConsent({ yes: list.filter((x) => x.biometric_consent).length, total: list.length });
  }
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schoolId]);

  if (missing)
    return (
      <>
        <PageHeader title="Fingerprint check-in" />
        <MigrationNotice />
      </>
    );

  return (
    <>
      <PageHeader
        title="Fingerprint check-in"
        description="Children press a finger on a reader at the bus door instead of the attendant tapping their name."
      />
      <UnderConstruction title="Fingerprint check-in is being built">
        {FINGERPRINT_STATUS.detail} The foundation is ready: consent is recorded per child, readers
        can be registered here, and every check-in already records how the child was identified.
      </UnderConstruction>

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4 my-6">
        <StatCard
          label="Parent consent"
          value={`${consent.yes}/${consent.total}`}
          hint="children with fingerprint consent"
          Icon={ShieldCheck}
          tone="success"
        />
        <StatCard label="Readers registered" value={devices.length} Icon={Cpu} tone="info" />
        <StatCard
          label="Children enrolled"
          value={0}
          hint="Enrolment opens with the readers"
          Icon={Fingerprint}
          tone="warning"
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="Road to automatic check-in">
          <ol className="space-y-4">
            {STEPS.map((s, i) => (
              <li key={s.title} className="flex gap-3">
                <span
                  className={`h-9 w-9 rounded-xl grid place-items-center shrink-0 ${i === 0 ? "bg-success/15 text-success" : "bg-muted text-muted-foreground"}`}
                >
                  <s.Icon className="h-4 w-4" />
                </span>
                <div>
                  <div className="font-medium text-sm">
                    {i + 1}. {s.title}{" "}
                    {i === 0 ? (
                      <Pill tone="success" className="ml-1">
                        Ready
                      </Pill>
                    ) : (
                      <Pill tone="warning" className="ml-1">
                        To do
                      </Pill>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">{s.text}</p>
                </div>
              </li>
            ))}
          </ol>
          <div className="mt-5 grid grid-cols-2 gap-2 text-xs">
            <div className="rounded-xl border border-border p-3 flex gap-2">
              <CreditCard className="h-4 w-4 text-primary shrink-0" /> Smart cards can use the same
              screens (backup for small or wet fingers).
            </div>
            <div className="rounded-xl border border-border p-3 flex gap-2">
              <ScanFace className="h-4 w-4 text-primary shrink-0" /> Face check is possible later,
              after a legal review.
            </div>
          </div>
        </Panel>

        <Panel
          title="Readers"
          description="Register readers as they arrive. Status changes to Active once the driver is connected."
        >
          <div className="grid sm:grid-cols-3 gap-2 mb-4">
            <Field label="Name">
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Bus A reader"
              />
            </Field>
            <Field label="Model">
              <Input
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder="SecuGen Hamster Pro 20"
              />
            </Field>
            <Field label="Bus">
              <NativeSelect value={bus} onChange={setBus}>
                <option value="">Not on a bus</option>
                {buses.map((b) => (
                  <option key={b.id} value={b.id}>
                    {busName(b)}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          </div>
          <Button
            size="sm"
            variant="outline"
            disabled={!name.trim()}
            onClick={async () => {
              const { error } = await db.from("biometric_devices").insert({
                school_id: schoolId,
                name: name.trim(),
                model: model.trim() || null,
                bus_id: bus || null,
                kind: "fingerprint",
              });
              if (error) return toast.error(friendlyError(error, "Couldn't save"));
              setName("");
              setModel("");
              void load();
            }}
          >
            <Plus className="h-4 w-4 mr-1.5" /> Register reader
          </Button>
          {devices.length === 0 ? (
            <EmptyState Icon={Cpu} title="No readers yet" />
          ) : (
            <ul className="mt-4 divide-y divide-border rounded-xl border border-border">
              {devices.map((d) => (
                <li key={d.id} className="flex items-center gap-3 px-3 py-2.5">
                  <Fingerprint className="h-4 w-4 text-primary" />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium truncate">{d.name}</div>
                    <div className="text-xs text-muted-foreground truncate">
                      {d.model ?? "Model not set"} ·{" "}
                      {d.bus_id ? busName(buses.find((b) => b.id === d.bus_id)) : "No bus"}
                    </div>
                  </div>
                  <Pill tone="warning">{d.status === "planned" ? "Not connected" : d.status}</Pill>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={async () => {
                      await db.from("biometric_devices").delete().eq("id", d.id);
                      void load();
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </>
  );
}
