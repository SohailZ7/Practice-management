// Which sections of Psychiatric_Master_Template_v2.docx each note type fills (desktop spec NOT-1, NOT-2, NOT-6).
// Headings must match the template's Heading 1 text exactly. A different template needs only a different map.
import type { NoteKind } from "./types";

export const NOT_DISCUSSED = "Not discussed in this recording.";
export const NOT_ASSESSED = "Not assessed in this recording.";

export type SectionSpec = {
  heading: string;
  action: "fill" | "keep" | "drop" | "info";
  /** What to extract. With `labels`, the model writes one "Label: text" line per label; otherwise short paragraphs. */
  instruction?: string;
  labels?: string[];
  /** Risk-bearing sections the provider must confirm before saving (DOC-2). */
  mustConfirm?: boolean;
  /** Draw on the patient's earlier note as well as this visit. */
  usesPriorNote?: boolean;
  /** Ask each label as its own question that must be answered YES, NO or NOT_ASKED with a quote (used for suicide risk). */
  questions?: Record<string, string>;
  /** Facts in this section must be about the patient. A relative's or another person's facts are removed by the verification pass. */
  aboutPatient?: boolean;
};

const H = {
  info: "1. Patient / Encounter Information",
  cc: "2. Chief Complaint",
  hpi: "3. History of Present Illness / Current Episode",
  ros: "4. Psychiatric Review of Symptoms",
  pph: "5. Past Psychiatric History",
  ssrs: "6. Suicide Risk Assessment - Columbia / C-SSRS Documentation Area",
  sub: "7. Substance Use History",
  med: "8. Medical / Surgical History",
  rosMed: "9. Focused Medical Review of Systems",
  fam: "10. Family History",
  soc: "11. Personal / Social History",
  mse: "12. Mental Status Examination",
  summary: "13. Auto-Generated Clinical Summary / Narrative",
  form: "14. Formulation / Assessment",
  dx: "15. Diagnoses / Problem List",
  plan: "16. Problem-Based Assessment & Treatment Plan",
  consent: "17. Medication / Biological Treatment Informed-Consent Module",
  dispo: "18. Level of Care / Disposition",
  progress: "19. Progress Note Carry-Forward Block",
  dc: "20. Discharge Summary Carry-Forward Block",
  attest: "21. Attestation / Billing",
} as const;

export const ALL_HEADINGS: string[] = Object.values(H);

const ssrs: SectionSpec = {
  heading: H.ssrs,
  action: "fill",
  mustConfirm: true,
  instruction: "Record only what the patient said about suicidal thoughts, behavior and safety. Do not rate risk.",
  labels: ["Wish to be dead", "Suicidal thoughts", "Method / intent / plan", "Suicidal behavior", "Protective factors", "Safety plan discussed"],
  aboutPatient: true,
  questions: {
    "Wish to be dead": "Did the patient say they wish they were dead, or would not wake up, or that others would be better off without them, or deny this?",
    "Suicidal thoughts": "Did the patient say they have had thoughts of killing themselves, or deny having such thoughts?",
    "Method / intent / plan": "Did the patient describe a method, an intent to act, or a plan to kill themselves, or deny having any?",
    "Suicidal behavior": "Did the patient say whether THEY THEMSELVES have ever attempted suicide or harmed themselves (an attempt, preparing to act, self-harm), or deny it? What a relative or friend did does not count.",
    "Protective factors": "Did the patient give reasons for living or things that keep them safe (family, children, pets, faith, plans for the future)?",
    "Safety plan discussed": "Did the doctor review a safety plan, give a crisis line number, or discuss removing means such as a firearm?",
  },
};
const consent: SectionSpec = {
  heading: H.consent,
  action: "fill",
  mustConfirm: true,
  instruction: "Record only medication decisions, doses, risks and alternatives that were actually said in the visit.",
  labels: ["Medication action", "Medication and dose", "Risks / benefits / alternatives discussed", "Patient preference / consent / refusal"],
};
const dispo: SectionSpec = {
  heading: H.dispo,
  action: "fill",
  instruction: "Record only what was said about level of care, safety plan, follow-up and referrals.",
  labels: ["Level of care", "Safety plan / precautions", "Follow-up / referrals"],
};

export const PLANS: Record<NoteKind, { title: string; sections: SectionSpec[] }> = {
  EVAL: {
    title: "PSYCHIATRIC EVALUATION",
    sections: [
      { heading: H.info, action: "info" },
      { heading: H.cc, action: "fill", instruction: "The patient's main complaint in the patient's own words where possible.", labels: ["Patient's words"] },
      { heading: H.hpi, action: "fill", instruction: "History of the current episode.", aboutPatient: true, labels: ["Primary reason for treatment", "Duration of current episode", "Precipitating / contextual factors", "Functional impact", "Narrative / additional details"] },
      { heading: H.ros, action: "fill", instruction: "One line per symptom area that was discussed (depression, mania, anxiety, panic, psychosis, trauma, OCD, ADHD, other). Skip areas not discussed. State what the patient reported.", labels: [] },
      { heading: H.pph, action: "fill", instruction: "Past psychiatric history.", aboutPatient: true, labels: ["Diagnoses", "Prior hospitalizations", "Prior suicide attempts / self-harm", "Prior medications and response", "Prior therapy / other treatment", "Current psychiatric providers"] },
      ssrs,
      { heading: H.sub, action: "fill", instruction: "Substance use history as described.", aboutPatient: true, labels: ["Substances and pattern", "Withdrawal / overdose / treatment history"] },
      { heading: H.med, action: "fill", instruction: "Medical and surgical history as described.", aboutPatient: true, labels: ["Medical history", "Surgical history", "Neurologic history", "Current non-psychiatric medications", "Allergies"] },
      { heading: H.rosMed, action: "keep" },
      { heading: H.fam, action: "fill", instruction: "Family history as described.", labels: ["Family psychiatric history", "Family history of suicide", "Family medical history"] },
      { heading: H.soc, action: "fill", instruction: "Personal and social history as described.", aboutPatient: true, labels: ["Born / raised", "Education / employment", "Relationship / children / living situation", "Social supports", "Trauma history", "Legal history", "Firearms / lethal means access"] },
      { heading: H.mse, action: "keep" },
      { heading: H.summary, action: "keep" },
      { heading: H.form, action: "keep" },
      { heading: H.dx, action: "keep" },
      { heading: H.plan, action: "fill", instruction: "Treatment plan items the provider said aloud, grouped by problem. Do not add any that were not said.", labels: [] },
      consent,
      dispo,
      { heading: H.progress, action: "drop" },
      { heading: H.dc, action: "drop" },
      { heading: H.attest, action: "keep" },
    ],
  },
  FOLLOW_UP: {
    title: "PSYCHIATRIC PROGRESS NOTE",
    sections: [
      { heading: H.info, action: "info" },
      { heading: H.progress, action: "fill", usesPriorNote: true, instruction: "Interval update since the last note. Use the prior note only for context. Describe changes that were said in this visit.", labels: ["Interval clinical status", "Current symptoms / changes", "Current MSE / risk changes", "Problem-based assessment and plan updates"] },
      ssrs,
      consent,
      dispo,
      ...[H.cc, H.hpi, H.ros, H.pph, H.sub, H.med, H.rosMed, H.fam, H.soc, H.mse, H.summary, H.form, H.dx, H.plan, H.dc].map((heading) => ({ heading, action: "drop" as const })),
      { heading: H.attest, action: "keep" },
    ],
  },
  DISCHARGE: {
    title: "DISCHARGE SUMMARY",
    sections: [
      { heading: H.info, action: "info" },
      { heading: H.dc, action: "fill", usesPriorNote: true, instruction: "Summary of the stay. Use the prior note for history. Use this visit for course, response and condition at discharge.", labels: ["Opening narrative", "Psychiatric history", "Medical history", "Family psychiatric history", "Substance use history", "Program course by problem", "Response to interventions", "Condition at discharge", "Discharge risk assessment", "Discharge medications / follow-up / disposition"] },
      { ...consent, instruction: "Record only discharge medications and counseling actually said in this visit." },
      dispo,
      ...[H.cc, H.hpi, H.ros, H.pph, H.ssrs, H.sub, H.med, H.rosMed, H.fam, H.soc, H.mse, H.summary, H.form, H.dx, H.plan, H.progress].map((heading) => ({ heading, action: "drop" as const })),
      { heading: H.attest, action: "keep" },
    ],
  },
};
