// Turning a pasted board into visits. Shared by the web app's own paste screen and the recorder's, so there is one
// parser and one set of rules rather than two that can drift apart.

import { db } from "../db";
import { parseSchedule } from "./scheduleParse";
import { validatePatient } from "../billing/validate";

export type LoadResult = {
  created: number;
  skippedExisting: number;
  kept: number;
  skippedNoClient: number;
  skippedOtherProvider: number;
  otherProviders: string[];
};

/**
 * Creates a visit per parsed row, and a patient where one is not already on file. Re-pasting the same day adds only
 * what is missing: an existing visit is left alone, so a transcript or a document already written is never lost.
 */
export async function loadScheduleForDate(
  date: string,
  pasted: string,
  provider: string,
  actor: { id: string; email: string },
): Promise<LoadResult> {
  const { entries, summary, otherProviders } = parseSchedule(pasted.slice(0, 500_000), provider);
  let created = 0;
  let skippedExisting = 0;

  for (const e of entries) {
    if (!e.patient) continue;
    const { values, errors } = validatePatient({ lastName: e.patient.lastName, firstName: e.patient.firstName });
    if (Object.keys(errors).length) continue;

    const patient =
      (await db.billingPatient.findFirst({
        where: { lastName: values.lastName, firstName: values.firstName, mergedIntoId: null },
      })) ??
      (await db.billingPatient.create({
        data: { lastName: values.lastName, firstName: values.firstName, createdById: actor.id },
      }));

    if (await db.visit.findFirst({ where: { patientId: patient.id, visitDate: date } })) {
      skippedExisting += 1;
      continue;
    }
    await db.visit.create({
      data: {
        patientId: patient.id,
        visitDate: date,
        appointmentType: e.type,
        program: e.program,
        providerName: e.provider?.name ?? "",
        createdByEmail: actor.email,
      },
    });
    created += 1;
  }
  return {
    created,
    skippedExisting,
    kept: summary.kept,
    skippedNoClient: summary.skippedNoClient,
    skippedOtherProvider: summary.skippedOtherProvider,
    otherProviders,
  };
}
