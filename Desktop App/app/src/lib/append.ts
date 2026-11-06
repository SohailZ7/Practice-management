// Adding a new recording to a visit's existing transcript: the earlier text stays in front, then a time line, then the new text.
export const addedSeparator = (when: Date): string =>
  `\n\n--- Added ${when.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} ---\n\n`;

/** Earlier text and the separator, joined with the new text, as the saved transcript will read. */
export const combineTranscript = (previous: string, separator: string, added: string): string =>
  previous.trim() ? `${previous.trimEnd()}${separator}${added}` : added;
