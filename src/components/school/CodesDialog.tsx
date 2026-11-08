import { Copy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatPhone } from "@/lib/phone";

export interface CodeHolder {
  id: string;
  full_name: string;
  phone: string;
  activation_code: string | null;
}

// Activation codes to hand out after registering parents or attendants.
export function CodesDialog({
  guardians,
  onClose,
  kind = "parent",
}: {
  guardians: CodeHolder[];
  onClose: () => void;
  kind?: "parent" | "attendant";
}) {
  const page = kind === "parent" ? "/parent" : "/auth";
  const text = guardians
    .map(
      (g) =>
        `${g.full_name}: open ${window.location.origin}${page}, tap "First time", enter ${formatPhone(g.phone)} and code ${g.activation_code}`,
    )
    .join("\n");
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            Give these codes to the new {kind === "parent" ? "parents" : "attendants"}
          </DialogTitle>
          <DialogDescription>
            Each person opens Live Track, taps “First time here?”, and enters their phone number and
            code to choose a password. Codes are valid for 30 days and can be seen again on the{" "}
            {kind === "parent" ? "Parents" : "Bus attendants"} page.
          </DialogDescription>
        </DialogHeader>
        <ul className="divide-y divide-border rounded-xl border border-border">
          {guardians.map((g) => (
            <li key={g.id} className="flex items-center justify-between px-3 py-2.5">
              <div className="min-w-0">
                <div className="font-medium truncate">{g.full_name}</div>
                <div className="text-xs text-muted-foreground">{formatPhone(g.phone)}</div>
              </div>
              <span className="font-mono text-lg font-bold tracking-[0.2em] text-primary">
                {g.activation_code}
              </span>
            </li>
          ))}
        </ul>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              void navigator.clipboard.writeText(text);
              toast.success("Copied — paste it into WhatsApp or SMS");
            }}
          >
            <Copy className="h-4 w-4 mr-1.5" /> Copy messages
          </Button>
          <Button onClick={onClose}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
