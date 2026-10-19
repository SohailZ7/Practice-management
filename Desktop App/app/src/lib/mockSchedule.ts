// Synthetic schedule for the spike. Every name here is made up. The real app reads the web app's Desktop API instead.
import type { ScheduleItem } from "./types";

const blank = { absent: false, canceled: false, completed: false, missed: false };

export const mockSchedule = (today: string): { date: string; entries: ScheduleItem[] } => ({
  date: today,
  entries: [
    { id: "m1", time: "Psych Eval 9:00", program: "Psych Eval", type: "Psych Eval", provider: { id: "p1", name: "Dr. Example" }, status: blank, patient: { id: "pt1", lastName: "Testcase", firstName: "Alpha" }, clientInfo: "", consent: "on_file" },
    { id: "m2", time: "Track 1 IOP", program: "Track 1 IOP", type: "Follow-up", provider: { id: "p1", name: "Dr. Example" }, status: blank, patient: { id: "pt2", lastName: "Sample", firstName: "Bravo" }, clientInfo: "", consent: "on_file" },
    { id: "m3", time: "Track 1 PHP", program: "Track 1 PHP", type: "Follow-up & Admit Order", provider: { id: "p1", name: "Dr. Example" }, status: blank, patient: { id: "pt3", lastName: "Fixture", firstName: "Charlie" }, clientInfo: "", consent: "none" },
    { id: "m4", time: "AM 2 IOP", program: "AM 2 IOP", type: "DC Orders Only", provider: { id: "p1", name: "Dr. Example" }, status: blank, patient: { id: "pt4", lastName: "Mockup", firstName: "Delta" }, clientInfo: "", consent: "on_file" },
    { id: "m5", time: "PM IOP", program: "PM IOP", type: "Follow-up", provider: { id: "p1", name: "Dr. Example" }, status: { ...blank, canceled: true }, patient: { id: "pt5", lastName: "Dummy", firstName: "Echo" }, clientInfo: "", consent: "on_file" },
    { id: "m6", time: "EVE 1 IOP", program: "EVE 1 IOP", type: "Follow-up", provider: { id: "p1", name: "Dr. Example" }, status: blank, patient: null, clientInfo: "Unlinked, Foxtrot", consent: "unlinked" },
  ],
});
