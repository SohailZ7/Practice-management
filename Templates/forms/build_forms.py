"""Builds blank Word versions of the practice's three paper forms.

Source: scans of filled forms in ~/Documents/B&B Center/Documents/Templates, read on 2026-10-28.
Only the PRINTED structure is copied (headings, labels, checkbox lists, tables).
No handwriting and no patient detail from those scans appears here.

Layout aims at legibility and at being machine-fillable, not at matching the paper pixel for pixel:
each major block is a Heading 1 so the desktop app can find it, options are "[ ] Label" so ticking
means turning "[ ]" into "[X]", and blanks are "____" runs the app replaces.
"""
from docx import Document
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.shared import Pt, Inches, RGBColor

BOX = "[ ]"


def new_doc(title: str, form_line: str) -> Document:
    doc = Document()
    for name, size in (("Normal", 9.5), ("Heading 1", 11), ("Heading 2", 10)):
        st = doc.styles[name]
        st.font.name = "Calibri"
        st.font.size = Pt(size)
        if name.startswith("Heading"):
            st.font.color.rgb = RGBColor(0, 0, 0)
            st.font.bold = True
    for s in doc.sections:
        s.top_margin = s.bottom_margin = Inches(0.45)
        s.left_margin = s.right_margin = Inches(0.5)

    h = doc.add_paragraph()
    h.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r = h.add_run(title)
    r.bold = True
    r.font.size = Pt(14)

    sub = doc.add_paragraph()
    sub.alignment = WD_ALIGN_PARAGRAPH.CENTER
    sr = sub.add_run(form_line)
    sr.font.size = Pt(8)
    sr.italic = True
    return doc


def para(doc, text="", bold=False, size=9.5, space_after=2, italic=False):
    p = doc.add_paragraph()
    p.paragraph_format.space_after = Pt(space_after)
    p.paragraph_format.space_before = Pt(0)
    if text:
        r = p.add_run(text)
        r.bold = bold
        r.italic = italic
        r.font.size = Pt(size)
    return p


def heading(doc, text):
    p = doc.add_heading(text, level=1)
    p.paragraph_format.space_before = Pt(7)
    p.paragraph_format.space_after = Pt(2)
    return p


def field(doc, label, trail="_" * 60, bold_label=True):
    p = para(doc)
    r = p.add_run(label)
    r.bold = bold_label
    r.font.size = Pt(9.5)
    r2 = p.add_run(" " + trail)
    r2.font.size = Pt(9.5)
    return p


def options(doc, label, opts, trail=None, indent=0.0):
    """One line: bold label, then "[ ] opt" for each option, then an optional blank."""
    p = para(doc)
    if indent:
        p.paragraph_format.left_indent = Inches(indent)
    if label:
        r = p.add_run(label + "  ")
        r.bold = True
        r.font.size = Pt(9.5)
    for o in opts:
        r = p.add_run(f"{BOX} {o}   ")
        r.font.size = Pt(9.5)
    if trail:
        r = p.add_run(trail)
        r.font.size = Pt(9.5)
    return p


def grid(doc, rows, widths=None, header=None):
    """Table of [label, content] rows; content may hold checkbox options as plain text."""
    t = doc.add_table(rows=0, cols=2)
    t.style = "Table Grid"
    t.alignment = WD_TABLE_ALIGNMENT.LEFT
    if header:
        cells = t.add_row().cells
        for c, text in zip(cells, header):
            c.text = ""
            r = c.paragraphs[0].add_run(text)
            r.bold = True
            r.font.size = Pt(9)
    for label, content in rows:
        cells = t.add_row().cells
        for c, text, bold in ((cells[0], label, True), (cells[1], content, False)):
            c.text = ""
            p = c.paragraphs[0]
            p.paragraph_format.space_after = Pt(0)
            r = p.add_run(text)
            r.bold = bold
            r.font.size = Pt(9)
    if widths:
        for row in t.rows:
            for cell, w in zip(row.cells, widths):
                cell.width = Inches(w)
    return t


def opts_text(items, trail=""):
    return "   ".join(f"{BOX} {i}" for i in items) + (("   " + trail) if trail else "")


def footer_block(doc, form_name, form_number):
    para(doc)
    p = para(doc, "FAIRFAX BEHAVIORAL HEALTH", bold=True, size=9)
    p.alignment = WD_ALIGN_PARAGRAPH.LEFT
    para(doc, f"{form_name}    {form_number}", size=8, italic=True)
    para(doc, "PATIENT LABEL HERE: ______________________________", size=8)


# --------------------------------------------------------------------------- progress note
def progress_note(path):
    doc = new_doc("Psychiatrist Progress Note", "Form # 4071 Rev. 07/24 - Draft   |   Page 1 of 2")

    field(doc, "Patient:", "_" * 40 + "   MRN: " + "_" * 18 + "   Date: " + "_" * 14)

    heading(doc, "Chief Complaint")
    para(doc, "(Patient's own words related to problems identified in treatment plan)", italic=True, size=8)
    field(doc, "", "_" * 110, bold_label=False)

    heading(doc, "Subjective")
    for _ in range(4):
        field(doc, "", "_" * 110, bold_label=False)

    heading(doc, "Interval History (as Reported by Staff and Patient)")
    grid(doc, [
        ("*Sleep", opts_text(["Good", "Fair", "Poor"])),
        ("ADL's", opts_text(["Independent", "Fair", "Poor", "Needs Prompt", "Needs Assistance"])),
        ("Appetite", opts_text(["Good", "Fair", "Poor"])),
        ("Energy", opts_text(["Increased", "Good", "Fair", "Poor"])),
        ("Medication compliance", opts_text(["Good", "Intermittent"])),
        ("Self-harm Thoughts", opts_text(["Absent", "Present", "Improving", "Worse"])),
        ("Withdrawal Symptoms", opts_text(["Absent", "Present", "Improving", "Worse"])),
        ("PRN meds seeking", opts_text(["Appropriate", "Excessive", "Inappropriate"])),
        ("PRN meds taken", opts_text(["None", "Yes"], "_" * 30)),
        ("Anxiety", opts_text(["Absent", "Present", "Improving", "Worse"])),
        ("Depression", opts_text(["Absent", "Present", "Improving", "Worse"])),
        ("Group attendance", opts_text(["Good", "Fair", "Poor"])),
        ("Group participation", opts_text(["Good", "Fair", "Poor"])),
        ("Mood Instability", "_" * 55),
    ], widths=(1.7, 5.8))

    heading(doc, "Physical Status")
    options(doc, "Physical complaints:", ["None", "Headache", "Constipation", "Nausea", "Edema", "EPS", "Tremor", "Other:"], "_" * 18)
    field(doc, "Vital signs:", "BP: ____ / ____   Pulse: ______ /min   Temperature: ______   RR: ______ /min   O2 sat: ______   " + BOX + " Refused")
    options(doc, "Side effects:", ["None reported"], "_" * 55)
    options(doc, "Abnormal movements:", ["None", "Tremor", "Dyskinesia", "Akathisia", "Other:"], "_" * 25)
    field(doc, "Results of laboratory tests, ER visits and/or consults:", "_" * 45)

    heading(doc, "Mental Status Exam")
    grid(doc, [
        ("Attitude", opts_text(["Cooperative", "Superficial", "Uncooperative", "Guarded", "Hostile", "Intrusive"])),
        ("Eye contact", opts_text(["Good", "Better", "Fair", "Intermittent", "Avoid", "Poor", "Other"], "_" * 14)),
        ("Appearance (grooming/hygiene)", opts_text(["Appropriate", "Fair", "Poor", "Inappropriate", "Disheveled", "Other"], "_" * 12)),
        ("Gait", opts_text(["Normal", "Abnormal", "Uses wheelchair/cane", "Other:"], "_" * 16)),
        ("Psycho-motor", opts_text(["Normal", "Slowed", "Restless", "Fidgety", "Hyperactive", "Agitated", "Angry"])),
        ("Mood", "In patient's own words: “" + "_" * 40 + "”   " + BOX + " No Response"),
        ("Affect", opts_text(["Appropriate with mood", "Inappropriate with mood", "Full range", "Increased",
                              "Restricted", "Blunt", "Flat", "Detached", "Labile", "Other"])),
        ("Speech", opts_text(["Normal", "Pressured", "Hyperverbal", "Loud", "Slow", "Soft", "Halted", "Mumble", "Mute"])),
        ("Thought processes", opts_text(["Logical", "Goal directed", "Poor processing", "Illogical", "Circumstantial",
                                         "Tangential", "Latent", "Ruminative", "Concrete", "Other:"], "_" * 12)),
        ("Thought content", opts_text(["Appropriate", "Poverty", "Hallucinations", "Paranoia", "Delusions", "Grandiosity",
                                       "Obsession", "Hopelessness", "Helplessness", "Worthlessness", "Guilt feelings"])),
        ("Suicidal ideation", opts_text(["None", "Not active", "Thoughts", "Intent", "Plan:"], "_" * 22)),
        ("Homicidal ideation", opts_text(["None", "Not active", "Thoughts", "Intent", "Plan:"], "_" * 22)),
        ("Orientation", opts_text(["Full", "date", "month", "year", "Place", "Person", "Situation"])),
        ("Concentration", opts_text(["WNL", "Impaired"]) + "   How tested: " + opts_text(["Spelling WORLD backwards", "Other:"], "_" * 12)),
        ("Insight", opts_text(["WNL", "Impaired"]) + "   How tested: " + opts_text(["Recognizing need for treatment", "Denial of Illness", "Other:"], "_" * 10)),
        ("Judgement", opts_text(["WNL", "Impaired"]) + "   How tested: " + opts_text(["Understanding of relations between facts", "Willingness to accept treatment", "Other:"], "_" * 10)),
        ("Suicide Risk Assessment", opts_text(["No identified risk", "low", "mod", "high"], "_" * 24)),
        ("Violence Risk Assessment", opts_text(["No identified risk", "low", "mod", "high"], "_" * 24)),
    ], widths=(1.7, 5.8))

    footer_block(doc, "Psychiatrist Progress Note", "Form # 4071 Rev. 07/24 - Draft")

    # ---- page 2
    doc.add_page_break()
    p = para(doc, "Psychiatrist Progress Note", bold=True, size=12)
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p = para(doc, "Page 2 of 2", size=8, italic=True)
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER

    heading(doc, "Working Diagnosis (required)")
    field(doc, "", "_" * 110, bold_label=False)

    heading(doc, "Assessment / Plan / Medications change / Progress toward goals")
    for _ in range(4):
        field(doc, "", "_" * 110, bold_label=False)

    heading(doc, "Informed Consent")
    para(doc, "(check appropriate box)", italic=True, size=8)
    options(doc, "", ["Written informed consent has been obtained for all psychotropic medications."])
    options(doc, "", ["The following medications still need written consent"], "_" * 40)

    heading(doc, "Safety and Observation")
    options(doc, "", ["Safety concerns reported by staff, last 24 hours:"], "_" * 30 + "   " + BOX + " Reassessment of patient completed.")
    field(doc, "Brief description of event", "_" * 75)
    field(doc, "Justification for continuation/change of precautions or level of observation:", "_" * 30)
    for _ in range(2):
        field(doc, "", "_" * 110, bold_label=False)

    heading(doc, "Progress and Risk")
    options(doc, "New problem:", ["None", "Yes"], "_" * 30 + "   Change in Treatment Plan: " + BOX + " No  " + BOX + " Yes (if yes, see tx plan)")
    options(doc, "Patient Response to Treatment:", ["No change", "Worsening", "Minimal progress", "Improving but not at baseline yet"])
    options(doc, "", ["Approaching stability", "Discharge planning in progress", "Other"], "_" * 30, indent=0.25)
    options(doc, "Rationale for continuous hospitalization / Summary of risk:",
            ["Significant depression", "Severe mood instability", "Mania"])
    options(doc, "", ["Risk of violence", "Suicidal ideation", "Homicidal ideation", "Significant psychotic behavior", "Hallucinations"], indent=0.25)
    options(doc, "", ["Delusions/Paranoia", "Self-neglect/Unable to care for self", "Medications stabilization", "Others:"], "_" * 18, indent=0.25)
    options(doc, "Consults Ordered:", ["No", "Yes:"], "_" * 22 + "    Labs Ordered: " + BOX + " No   " + BOX + " Yes: " + "_" * 22)
    options(doc, "Therapy:", ["Psych education", "Medication education", "Supportive", "Family intervention", "Insight intervention"])
    options(doc, "", ["Insight oriented", "CBT", "Interpersonal", "Coping skills", "CD counseling", "other:"], "_" * 18, indent=0.25)

    heading(doc, "Care Coordination")
    grid(doc, [
        ("Signs, Symptoms, Treatment Course and Prognosis", opts_text(["Patient", "Treatment team", "Other:"], "_" * 14)),
        ("Medication Education, Benefits and Side Effects", opts_text(["Patient", "Treatment team", "Other:"], "_" * 14)),
        ("Managing the Behavior Problems", opts_text(["Patient", "Treatment team", "Other:"], "_" * 14)),
        ("Substance abuse & Symptom Reoccurrence", opts_text(["Patient", "Treatment team", "Other:"], "_" * 14)),
        ("Managing Physical Problems", opts_text(["Patient", "Treatment team", "Other:"], "_" * 14)),
        ("Care Coordination", opts_text(["Patient", "Treatment team", "Family", "Outpatient provider"])),
        ("Discharge Plan", opts_text(["Patient", "Treatment team", "Family", "Outpatient provider"])),
    ], widths=(3.0, 4.5))

    heading(doc, "Attestations")
    options(doc, "", ["Ongoing meds education: The patient/guardian was given the opportunity to discuss the concerns "
                      "about the medications and continues the consent to the medications."])
    options(doc, "", ["ITA Only: I have evaluated the patient and in my opinion the patient continues to require "
                      "inpatient involuntary treatment."])
    options(doc, "Reason for involuntary treatment:", ["Poor insight", "Poor judgement", "High risk of non-compliance", "LRO desired"])

    heading(doc, "Time and Signature")
    field(doc, "Total floor time:", "______ mins.   Majority of time spent in counseling and coordination of care.")
    options(doc, "CPT (choose one):", ["99231", "99232", "99233"])
    field(doc, "Provider Name:", "_" * 32 + "   Provider Signature: " + "_" * 26)
    field(doc, "Date:", "_" * 20 + "   Time: " + "_" * 16)

    footer_block(doc, "Psychiatrist Progress Note", "Form # 4071 Rev. 07/24 - Draft")
    doc.save(path)


# --------------------------------------------------------------------------- discharge order
def discharge_order(path):
    doc = new_doc("Physician Discharge Order", "Form # 4012 Rev. 10/19   |   Page 1 of 1")

    field(doc, "Patient:", "_" * 40 + "   MRN: " + "_" * 18 + "   Program: " + "_" * 16)
    field(doc, "Admission Date:", "_" * 22 + "    Discharge Date: " + "_" * 22)

    heading(doc, "Discharge Diagnoses")
    field(doc, "Discharge Psychiatric Diagnoses:", "_" * 60)
    field(doc, "Substance Use diagnosis:", "_" * 68)
    field(doc, "Medical diagnosis:", "_" * 74)

    heading(doc, "Discharge Medications")
    options(doc, "", ["Medication print out list attached", "None", "E-RX", "Paper RX", "Phoned to:"], "_" * 22)
    t = doc.add_table(rows=1, cols=4)
    t.style = "Table Grid"
    for c, text in zip(t.rows[0].cells, ["Medication", "Dose, instruction, quantity, refill", "Medication", "Dose, instruction, quantity, refill"]):
        c.text = ""
        r = c.paragraphs[0].add_run(text)
        r.bold = True
        r.font.size = Pt(9)
    for _ in range(5):
        for c in t.add_row().cells:
            c.text = ""
    for row in t.rows:
        for cell, w in zip(row.cells, (1.5, 2.3, 1.5, 2.3)):
            cell.width = Inches(w)

    heading(doc, "Mental Status Exam")
    para(doc, "UTA if unable to assess.", italic=True, size=8)
    grid(doc, [
        ("Psychiatric Condition", opts_text(["Stable"]) + "   " + "_" * 30),
        ("Speech", opts_text(["Normal"]) + "   " + "_" * 30),
        ("Thought contents", opts_text(["Denied SI, HI, AH, VH"]) + "   " + "_" * 22),
        ("Insight / Judgement", "_" * 45),
        ("Risk Assessment", opts_text(["No imminent risk to self or others"]) + "   " + "_" * 14),
        ("Cognition", opts_text(["Alert and Oriented x3"]) + "   " + "_" * 22),
        ("Mood / affect", "_" * 45),
    ], widths=(1.9, 5.6))

    heading(doc, "Discharge Type")
    options(doc, "", ["MD Discharge", "Unplanned; patient request", "Unplanned; other LOC"])

    heading(doc, "Tobacco Cessation Medication at Discharge")
    options(doc, "Tobacco Cessation Counseling provided:", ["Yes", "No"])
    options(doc, "", ["Patient declined smoking cessation medications at the time of discharge"])
    options(doc, "", ["OTC or Rx medications for tobacco cessation are recommended and are listed on discharge medications"])
    options(doc, "", ["Patient not a smoker"])

    heading(doc, "Discharge Instructions")
    for text in [
        "Take all medications as instructed and stay compliant with your treatment.",
        "Discuss any side effects with your outpatient providers immediately, or visit the nearest ER if they are severe.",
        "Call 911 immediately or report to the nearest ER if you are experiencing any suicidal or homicidal thoughts.",
        "Not advised to operate machinery until speaking with outpatient provider / PCP.",
        "Do not use alcohol, marijuana or illicit drugs.",
    ]:
        options(doc, "", [text])

    heading(doc, "Treatment Recommendations")
    options(doc, "", ["Outpatient Psychiatric follow up", "Medical follow up with PCP", "Substance use treatment", "Labs"])
    options(doc, "Prognosis:", ["Fair", "Guarded", "Poor", "Dependent upon compliance with recommended treatment"])
    options(doc, "Patient was discharged to:", ["Home", "Hospital", "Residential", "Adult family home", "Shelter", "Other:"], "_" * 16)

    heading(doc, "Signature")
    field(doc, "TORB:", "_" * 26 + " Telephone order given by medical provider    " + "_" * 26 + " Nurse (name and signature)")
    field(doc, "Date & Time:", "_" * 30)
    field(doc, "Provider Signature:", "_" * 30 + "   Printed Name: " + "_" * 26)
    field(doc, "Date & Time:", "_" * 30)
    options(doc, "Time spent with case on discharge:", ["less than 30 minutes", "More than 30 minutes"])
    field(doc, "Nuance/Inquiry dictation #", "_" * 30)

    footer_block(doc, "Physician Discharge Order", "Form # 4012 Rev. 10/19   |   Original to chart, copy to patient")
    doc.save(path)


# --------------------------------------------------------------------------- admit order
def admit_order(path):
    doc = new_doc("Admit to Outpatient Program", "Practice admission order")

    options(doc, "Admit to Outpatient Program:", ["Adult", "Adolescent"])
    field(doc, "Name:", "_" * 44 + "   MRN: " + "_" * 16 + "   Date: " + "_" * 14)
    field(doc, "Transcribed By (nurse, date, time):", "_" * 50)

    heading(doc, "Admitting Diagnosis")
    field(doc, "", "_" * 110, bold_label=False)

    heading(doc, "Medical Issues")
    options(doc, "", ["NKDA", "Allergies:"], "_" * 40)
    options(doc, "", ["Pregnant", "Lactating", "Other:"], "_" * 36)
    options(doc, "Diet:", ["Regular", "Special:"], "_" * 36)
    options(doc, "Vital Signs:", ["On Admission & Routine", "Telehealth Visit: Please refer to PCP"])

    heading(doc, "In House Consults and Tests")
    options(doc, "", ["Physical Exam to be done by primary care team"])
    options(doc, "", ["CD Evaluation (reason):"], "_" * 40)
    options(doc, "", ["Dietary Consult"], "(automatically pushed to the following business day, except Thursday and Friday, which complete the following Monday)")
    options(doc, "", ["Other Consult (reason):"], "_" * 40)
    options(doc, "", ["EKG (reason):"], "_" * 46)
    options(doc, "", ["Urine HCG Test", "COVID test", "Breathalyzer", "Urine Drug Test", "UA"])

    heading(doc, "Lab Test(s)")
    options(doc, "", ["CMP", "TSH", "Fasting Lipid Profile", "UA", "CBC w/Diff", "HBA1C"])
    options(doc, "", ["Urine Drug Screen", "Serum HCG", "Additional Tests:"], "_" * 34)

    heading(doc, "Group(s)")
    options(doc, "", ["Attend all as scheduled unless otherwise indicated", "Other:"], "_" * 30)

    heading(doc, "Medication(s)")
    para(doc, "Medications reviewed with patient; the following medications will be prescribed by the PHP/IOP provider. "
              "If a medication is not listed, the patient should refer to their established provider or the outpatient "
              "medication management supervisor.", size=8.5, italic=True)
    for _ in range(10):
        options(doc, "", [""], "_" * 90)

    heading(doc, "Signature")
    field(doc, "TORB:", "_" * 26 + " Given by medical provider (name)    " + "_" * 26 + " Nurse (signature)")
    field(doc, "Date & Time:", "_" * 30)
    field(doc, "Medical Provider Signature:", "_" * 28 + "   Printed Name: " + "_" * 24)
    field(doc, "Date:", "_" * 20 + "   Time: " + "_" * 16)

    footer_block(doc, "Admit to Outpatient Program", "Practice admission order")
    doc.save(path)


if __name__ == "__main__":
    import sys
    out = sys.argv[1]
    progress_note(f"{out}/Psychiatrist_Progress_Note_v1.docx")
    discharge_order(f"{out}/Physician_Discharge_Order_v1.docx")
    admit_order(f"{out}/Admit_Outpatient_Program_Order_v1.docx")
    print("built 3 forms")
