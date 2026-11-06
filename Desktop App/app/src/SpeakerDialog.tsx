import { Modal } from "./Modal";

/**
 * Shown right after a recording made on one microphone, when two voices were found: "Which speaker is the patient?".
 * The first words of each speaker are shown to help; the labels are only a guess until the provider picks.
 */
export function SpeakerDialog({ speakers, onChoose }: {
  speakers: { label: string; sample: string }[];
  /** `patient` is the chosen speaker's label, or null to keep "Speaker 1" / "Speaker 2" for now. */
  onChoose: (patient: string | null) => void;
}) {
  return (
    <Modal title="Which speaker is the patient?" width={560} onClose={() => onChoose(null)}
      footer={<button className="secondary" onClick={() => onChoose(null)}>Not sure, decide later</button>}>
      <p className="small" style={{ marginTop: 0 }}>
        This Mac separated two voices on the microphone. This is a guess based on how the voices sound, so please
        confirm. The other speaker will be labelled Provider. You can change it later from the transcript window.
      </p>
      {speakers.map((s) => (
        <div key={s.label} className="speaker-choice">
          <div className="small"><strong>{s.label}</strong> (unconfirmed)</div>
          <div className="small speaker-sample">{s.sample ? `“${s.sample}…”` : "No words captured."}</div>
          <button onClick={() => onChoose(s.label)}>{s.label} is the patient</button>
        </div>
      ))}
    </Modal>
  );
}
