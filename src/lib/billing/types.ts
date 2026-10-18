export type EncounterFormInput = {
  encounterId?: string;
  /** Pick an existing patient (from the search) instead of typing one. */
  patientId?: string;
  mrn?: string;
  lastName?: string;
  firstName?: string;
  /** Answer to "is this the same person?": a patient id to reuse, or "new". */
  confirm?: string;
  encounterDate: string;
  programId: string;
  icd10Input: string;
  chargeCode: string;
  note: string;
};

export type SaveResult =
  | { ok: true; encounterId: string; patientId: string }
  | {
      ok: false;
      errors: Record<string, string>;
      confirm?: { patientId: string; name: string };
    };

export type PatientHit = { id: string; mrn: string | null; name: string };

export type EncounterFilters = {
  q: string;
  from: string;
  to: string;
  programId: string;
  status: "all" | "pending" | "entered";
  mrn: "any" | "missing";
  by: string;
  show: "active" | "deleted";
};

export type EncounterRow = {
  id: string;
  date: string;
  patientId: string;
  patientName: string;
  mrn: string | null;
  program: string;
  icd10Codes: string[];
  chargeCode: string;
  note: string;
  enteredBy: string;
  getixEntered: boolean;
  getixEnteredAt: string | null;
  deleted: boolean;
  canChange: boolean;
};

export type PatientFilters = {
  q: string;
  from: string;
  to: string;
  programId: string;
  waiting: boolean;
  mrn: "any" | "missing";
  by: string;
};

export type PatientRow = {
  id: string;
  mrn: string | null;
  name: string;
  lastSeen: string;
  encounters: number;
  waiting: number;
};
