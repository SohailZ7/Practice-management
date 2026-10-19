export type ConsentBadge = "unlinked" | "none" | "on_file";

/** One row of the day's schedule, shaped like the web app's Desktop API (requirements v19, API-4). */
export type ScheduleItem = {
  id: string;
  time: string;
  program: string;
  type: string;
  provider: { id: string | null; name: string } | null;
  status: { absent: boolean; canceled: boolean; completed: boolean; missed: boolean };
  patient: { id: string; lastName: string; firstName: string } | null;
  clientInfo: string;
  consent: ConsentBadge;
};

export type NoteKind = "EVAL" | "FOLLOW_UP" | "DISCHARGE";

/** How a visit is captured: a recorded conversation, or the provider's dictated summary (no consent needed). */
export type CaptureMode = "recording" | "dictation";

export type Para = {
  label?: string;
  text: string;
  /** Needs the provider's eye: not discussed, not assessed, or contains a value not found in the source. */
  flag?: "not_discussed" | "not_assessed" | "ungrounded" | "confirm";
};

export type DraftSection = {
  heading: string; // exact Heading 1 text in the template
  action: "fill" | "keep" | "drop" | "info";
  paragraphs: Para[];
  /** The provider must tick this section off before saving (desktop spec DOC-2). */
  mustConfirm?: boolean;
};

export type DraftNote = {
  kind: NoteKind;
  title: string;
  sections: DraftSection[];
};

/** Runs one prompt on the local language model and returns its text. */
export type Llm = (req: { system: string; prompt: string }) => Promise<string>;
