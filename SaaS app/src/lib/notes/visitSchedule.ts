// Release B2a: the ScheduleEntry mirror is retired (a Visit is the appointment). Only the pure field mapping remains.

/** Pure mapping, for tests. A program means a track row (the track name is its label); no program means a psych-eval row at the appointment time. */
export function scheduleFieldsFor(v: { program: string; apptTime: string; appointmentType: string }) {
  const program = v.program.trim();
  return program
    ? { section: "TRACK", timeLabel: program, trackName: program, typeName: v.appointmentType }
    : { section: "PSYCH_EVAL", timeLabel: v.apptTime, trackName: "", typeName: v.appointmentType };
}
