// What the model chose for each field of a checkbox form. Kept separate from the Word-specific filler the desktop
// app used, because the web app stores Markdown rather than .docx.

export type FieldValue = {
  /** Option labels to tick. */
  ticked?: string[];
  /** Short free text for the field's blank. */
  text?: string;
};

export type FormValues = Record<string, FieldValue>;
