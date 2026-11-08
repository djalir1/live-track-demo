// Fingerprint check-in: FOUNDATION ONLY (under construction).
//
// No reader is connected yet. When the hardware is chosen (see
// ATTENDANCE_SYSTEM.md in the repo root), a driver for it implements
// FingerprintReader and is returned by getFingerprintReader(). Everything
// after the match is already built: the attendant screen calls
// mark_student(..., method = 'fingerprint'), and the trip list, parent
// alerts, reports and school alerts work exactly as for a manual tap.
//
// Data rules (Rwanda Law N° 058/2021 on personal data):
//   • enrol only with the parent's recorded consent (students.biometric_consent)
//   • never store fingerprint images; only the reader's encrypted template
//     reference (student_credentials.template_ref)
//   • delete templates when the child leaves or consent is withdrawn
//   • the manual tap always stays available

export const FINGERPRINT_STATUS = {
  ready: false,
  label: "Under construction",
  detail:
    "Fingerprint check-in is being built. Until the readers are installed, the attendant marks each child by hand.",
} as const;

export interface FingerprintMatch {
  studentId: string;
  /** 0..1 from the reader's matcher */
  score: number;
}

export interface FingerprintReader {
  readonly model: string;
  /** USB-OTG / Bluetooth connection to the reader. */
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  /** Capture a finger and return a template reference for enrolment. */
  enroll(studentId: string, finger: string): Promise<{ templateRef: string }>;
  /** Capture a finger and match it against the bus's enrolled children. */
  identify(
    candidates: { studentId: string; templateRef: string }[],
  ): Promise<FingerprintMatch | null>;
}

class NotConnectedReader implements FingerprintReader {
  readonly model = "None";
  private fail(): never {
    throw new Error(FINGERPRINT_STATUS.detail);
  }
  connect() {
    return Promise.reject(new Error(FINGERPRINT_STATUS.detail));
  }
  disconnect() {
    return Promise.resolve();
  }
  enroll(): Promise<{ templateRef: string }> {
    return Promise.resolve().then(() => this.fail());
  }
  identify(): Promise<FingerprintMatch | null> {
    return Promise.resolve().then(() => this.fail());
  }
}

export function getFingerprintReader(): FingerprintReader {
  return new NotConnectedReader();
}

export const FINGERS = ["Right thumb", "Right index", "Left thumb", "Left index"] as const;
