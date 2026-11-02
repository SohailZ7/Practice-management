# How Dr. Ahmed fills these forms, and how the app should map a transcript into them

Read on 2026-10-28 from four filled scans in `~/Documents/B&B Center/Documents/Templates`. Those scans carry patient
names, MRNs and signatures, so they are **never copied into this repo** and are not used as test data. What follows is the
writing style only, with no patient detail.

**How reliable this is:** four examples, almost all handwritten, and parts of the handwriting are not clearly legible.
Enough to learn conventions. Not enough to learn clinical judgment, and not a substitute for a clinician's review.

## The forms
| Form | Pages | Rebuilt as |
|---|---|---|
| Psychiatrist Progress Note (Fairfax form 4071 rev. 07/24) | 2 | `Templates/forms/Psychiatrist_Progress_Note_v1.docx` |
| Physician Discharge Order (Fairfax form 4012 rev. 10/19) | 1 | `Templates/forms/Physician_Discharge_Order_v1.docx` |
| Admit to Outpatient Program order | 1 | `Templates/forms/Admit_Outpatient_Program_Order_v1.docx` |

They were rebuilt from the scans because no blank originals exist here. `Templates/forms/build_forms.py` regenerates them.
A Word recreation is **not** the official Fairfax form and may not be accepted in its place; ask Fairfax for the blank
originals, ideally fillable PDFs, and the app can fill those instead.

## The style, from the examples
1. **Very short entries.** Free-text fields hold a phrase, not a sentence: a complaint in a few words, an assessment in
   one clause. Nothing like the paragraphs the Word master template invites.
2. **The patient's own words in Chief Complaint**, written as fragments, in the first person as the patient said them.
   This is the one place where first person is right; everywhere else is clinical shorthand.
3. **Diagnosis with its ICD-10 code first**, then the name and qualifiers, for example a code followed by the disorder,
   "recurrent", and an added feature.
4. **Medications as a list in the margin**: drug, dose, frequency, one per line, abbreviations throughout (TID, QAM, BID,
   XL). Dose changes are written as an arrow or "decrease X to Y", with "cont" for everything continuing unchanged.
5. **Assessment states a cause when he believes one**, in the shape "finding, likely due to drug". Short, and committed.
6. **Follow-up written as a plain instruction**, for example "following on Thursday".
7. **Checkboxes carry most of the content.** The interval history, mental status exam, risk, care coordination and
   discharge instruction sections are ticked, not written. Free text is only for what the boxes cannot say.
8. **Boxes that do not apply are left blank**, not crossed out. Blank means "not assessed", not "normal".
9. **Risk is always marked.** Suicide and violence risk, and SI/HI on the discharge order, are filled in every example.
10. **Margin notes carry context the form has no box for**, such as a transfer, a same-day admit and discharge, or an
    instruction to staff.

## What this means for the app
- **Fill boxes before prose.** For each section the model's job is to choose from a fixed list of options, not to write.
  A chosen option must be supported by the transcript; otherwise the box stays blank.
- **Keep free text to a phrase.** Target roughly 8 to 15 words per free-text field, in his clipped style, not full
  paragraphs. This is a different instruction from the one the Word master template uses.
- **Blank is a real answer.** Since a blank box means "not assessed", the app must leave boxes blank rather than guess,
  and the "Needs your attention" list should name the sections left blank.
- **Medications want their own extraction step**: drug, dose, frequency, and the change (start, stop, increase, decrease,
  continue). That is structured data, so it should be pulled out as fields and then written in his format, not free text.
- **Risk sections are never left to the model alone.** The existing suicide-risk question pass maps well onto the
  Suicidal ideation, Homicidal ideation and the two Risk Assessment rows; the risk level itself (low, moderate, high) is a
  clinical judgment and should stay blank for the provider unless the doctor said it aloud.
- **Diagnosis codes are not invented.** If the doctor said a code, use it; otherwise write the words he used and leave the
  code blank.
- **The discharge order is mostly orders, not observations.** Labs, diet, disposition and prognosis come from what the
  doctor decides, so expect most of it to be blank unless said during the visit.

## Answered by the owner (2026-10-28)
1. **A Follow-up produces both** the Fairfax progress note form and the Word master template note. The Word master
   template is no longer used for follow-ups alone; it runs alongside the form.
2. **The admit and discharge orders are generated.** Each is filled only where the recording supports it. Everything else
   is left blank for the provider, and the blank fields are named in the document's "Needs your attention" list.
3. **"ITA Only" and "Rationale for continuous hospitalization" stay blank by default.** They are inpatient items on a form
   used for outpatient visits, and nothing in an outpatient recording should tick them.
4. **The CPT code stays blank.** It is a billing decision, not something to infer from a recording.

## Still open
- Ask Fairfax for the blank originals, ideally fillable PDFs. A Word recreation is not the official form and the hospital
  may not accept it in place of the real one.
- Page 2 of the progress note was the only page 2 available; if the practice has a newer revision, the rebuilt form should
  be regenerated from it.

## Measured: the form questions were far too cautious (2026-11-01)
Running a real follow-up transcript through the real model filled only **3 of 24** fields. The transcript plainly
covered sleep, energy and missed doses, but the patient had not used the form's own words ("about seven hours", not
"Good"), and the prompt treated a different wording as "not discussed".

Telling the model to map what was said onto the nearest option, with examples, took it to **9 of 24**, and the
answers were right: seven hours of sleep became Good, low energy became Poor, two missed doses became Intermittent,
and "better" became Improving. Topics the visit never touched (anxiety, group attendance) stayed blank, so it is
choosing rather than ticking everything.

The lesson generalises: a prompt that says "only what was said" without saying "in whatever words" produces a form
that is safe and useless. The safety rule has to be about **inventing facts**, not about matching vocabulary.
