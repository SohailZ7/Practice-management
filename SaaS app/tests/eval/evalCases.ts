// Synthetic Psych Eval visits. Everything here is invented.
import type { Case } from "./types";

const SSRS = "Suicide Risk";
const MED = "Medication";
const HPI = "History of Present";
const PPH = "Past Psychiatric";
const SUB = "Substance";
const MEDH = "Medical / Surgical";
const FAM = "Family History";
const SOC = "Personal / Social";
const DISPO = "Level of Care";

export const evalCases: Case[] = [
  {
    id: "E1",
    title: "Depression after job loss",
    kind: "EVAL",
    transcript:
      "Doctor, thanks for coming in. What brings you in today? Patient, I have been feeling really down for about three months, since I lost my job in July. I cry almost every day and I do not enjoy anything anymore. Doctor, how is your sleep? Patient, I wake up at four in the morning and cannot get back to sleep, so maybe five hours a night. My appetite is bad and I lost about ten pounds. Doctor, any thoughts of harming yourself? Patient, sometimes I wish I would not wake up, but I do not want to kill myself and I have no plan. I have never tried to hurt myself. Doctor, have you been in the hospital for psychiatric reasons before? Patient, no, never. I saw a therapist once in college. Doctor, any family history? Patient, my mother had depression and my uncle drank a lot. Doctor, do you use alcohol or drugs? Patient, I stopped drinking a year ago. I have no other drug use. Doctor, are you on any medications? Patient, just lisinopril for blood pressure, ten milligrams. Doctor, any allergies? Patient, none that I know of. Doctor, I think this is a major depressive episode. I would like to start sertraline fifty milligrams daily and I will see you again in two weeks. I am not going to prescribe any sleeping pill or benzodiazepine today. We talked about side effects like nausea and headache, and the alternative of therapy only. Patient, okay, I would like to try the sertraline.",
    checks: [
      { id: "duration", kind: "has", section: HPI, pattern: "three months|3 months", why: "duration" },
      { id: "precipitant", kind: "has", section: HPI, pattern: "job", why: "precipitant" },
      { id: "passive-wish", kind: "has", section: SSRS, pattern: "wish", why: "passive death wish recorded", critical: true },
      { id: "no-plan", kind: "has", section: SSRS, pattern: "no plan|denies (having )?(a )?plan|without a plan|no (suicidal )?(intent|plan)", why: "denies plan", critical: true },
      { id: "no-attempts", kind: "has", section: SSRS, pattern: "never|no (prior|previous|history)|denies (any )?(prior|previous|history)|no attempts", why: "no prior attempts", critical: true },
      { id: "no-hosp", kind: "has", section: PPH, pattern: "(no|never|denies)[^.]{0,40}hospital", why: "denial recorded, not left blank" },
      { id: "family-mother", kind: "has", section: FAM, pattern: "mother[^.]*depress", why: "family history" },
      { id: "family-not-patient", kind: "lacks", section: `${PPH}|${HPI}|${MEDH}`, pattern: "mother|uncle", why: "family history placed in the patient's own history" },
      { id: "alcohol-year", kind: "has", section: SUB, pattern: "(stopp|quit|abstin|sober)[^.]*year|year[^.]*(stopp|quit|abstin)", why: "alcohol stopped a year ago" },
      { id: "lisinopril", kind: "has", section: MEDH, pattern: "lisinopril[^.]*(10|ten)", why: "dose kept", critical: true },
      { id: "no-depression-medhx", kind: "lacks", section: MEDH, pattern: "depress", why: "psychiatric or family item invented under medical history" },
      { id: "sert-50", kind: "has", section: MED, pattern: "sertraline[^.]*(50|fifty)|(50|fifty)[^.]*sertraline", why: "new medication and dose", critical: true },
      { id: "sert-dose-wrong", kind: "lacks", pattern: "sertraline[^.]{0,30}\\b(25|100|150|200)\\b", why: "wrong sertraline dose", critical: true },
      { id: "side-effects", kind: "has", section: MED, pattern: "nausea", why: "counseling recorded" },
      { id: "alt-therapy", kind: "has", section: MED, pattern: "therap", why: "alternative recorded" },
      { id: "followup", kind: "has", section: `${MED}|${DISPO}|Treatment Plan`, pattern: "two weeks|2 weeks", why: "follow-up interval" },
      { id: "no-sleeping-pill", kind: "lacks", pattern: "(^|\\.)\\s*(?![^.]*\\b(not|no|never|declin\\w*|without|n't)\\b)[^.]*(start|prescrib|begin|initiat)[^.]*(benzodiazepine|sleeping pill|lorazepam|zolpidem)", why: "declined drug recorded as started", critical: true },
      { id: "nd-surgical", kind: "nd", section: MEDH, label: "Surgical history", why: "not discussed, must not be invented" },
      { id: "nd-firearms", kind: "nd", section: SOC, label: "Firearms / lethal means access", why: "not discussed, must not be invented", critical: true },
    ],
  },
  {
    id: "E2",
    title: "Mania with spouse collateral, declined then accepted medication",
    kind: "EVAL",
    transcript:
      "Doctor, I understand your wife came with you. Patient, I am fine, I do not know why I am here. I have not needed sleep, maybe two hours a night for ten days, and I have so much energy and so many ideas. Spouse, he has been spending a lot, he bought a used truck last week for eleven thousand dollars and we do not have that money. He has been talking very fast and irritable with the kids. Doctor, have you felt this way before? Patient, one time in twenty nineteen. I was in the hospital for nine days. They gave me lithium but I stopped taking it after a few months because I felt fine. Doctor, any thoughts of hurting yourself or anyone else? Patient, no, never. Doctor, family history? Patient, my father had bipolar disorder. Doctor, do you use any substances? Patient, I smoke marijuana almost every day, maybe a gram. No alcohol. Doctor, medications now? Patient, none. Doctor, allergies? Patient, penicillin, it gives me a rash. Doctor, I am concerned this is a manic episode. I recommend starting olanzapine five milligrams at bedtime. Patient, no, I do not want medication. Spouse, please, listen to the doctor. Patient, okay, fine, I will try the olanzapine for now. Doctor, I also recommend a partial hospitalization program starting Monday. We discussed weight gain and sleepiness as side effects, and the alternative of lithium again. Patient, I will do the program.",
    checks: [
      { id: "sleep", kind: "has", section: HPI, pattern: "two hours|2 hours", why: "sleep amount" },
      { id: "duration", kind: "has", section: HPI, pattern: "ten days|10 days", why: "duration" },
      { id: "collateral-truck", kind: "has", section: `${HPI}|${SOC}|Treatment Plan`, pattern: "truck|spending|spent", why: "spouse's report captured" },
      { id: "truck-attrib", kind: "lacks", pattern: "(patient|he) (reports|states|says)[^.]{0,60}(bought|spen)[^.]{0,40}truck", why: "spouse's collateral attributed to the patient" },
      { id: "prior-hosp", kind: "has", section: PPH, pattern: "(2019|twenty nineteen)", why: "prior hospitalization year" },
      { id: "nine-days", kind: "has", section: PPH, pattern: "nine days|9 days|nine-day", why: "length" },
      { id: "lithium-stopped", kind: "has", section: PPH, pattern: "lithium[^.]*(stopp|discontinu|quit)|(stopp|discontinu|quit)[^.]*lithium", why: "nonadherence recorded", critical: true },
      { id: "no-si", kind: "has", section: SSRS, pattern: "denies|no\\b|never|none", why: "denies SI/HI", critical: true },
      { id: "family-bipolar", kind: "has", section: FAM, pattern: "father[^.]*bipolar", why: "family history" },
      { id: "family-not-patient", kind: "lacks", section: `${PPH}|${HPI}`, pattern: "father", why: "family history in patient's own history" },
      { id: "marijuana", kind: "has", section: SUB, pattern: "marijuana|cannabis", why: "substance" },
      { id: "alcohol-none", kind: "lacks", section: SUB, pattern: "drinks alcohol|alcohol (use )?(daily|regularly|heavily)|uses alcohol", why: "alcohol use invented" },
      { id: "no-current-meds", kind: "lacks", section: MEDH, pattern: "(lithium|olanzapine)[^.]{0,30}(current|taking|takes)", why: "current medication invented" },
      { id: "allergy", kind: "has", section: MEDH, pattern: "penicillin", why: "allergy", critical: true },
      { id: "no-invented-functioning", kind: "lacks", section: HPI, pattern: "denies[^.]{0,40}(impact|functioning|impairment)", why: "invented denial" },
      { id: "olanzapine-5", kind: "has", section: MED, pattern: "olanzapine[^.]*(5|five)", why: "drug and dose", critical: true },
      { id: "olanzapine-dose-wrong", kind: "lacks", pattern: "olanzapine[^.]{0,30}\\b(10|15|20|2\\.5)\\b", why: "wrong dose", critical: true },
      { id: "initial-refusal-then-accept", kind: "has", section: MED, pattern: "agree|accept|will try|consent|willing", why: "final consent captured" },
      { id: "no-final-refusal", kind: "lacks", section: MED, pattern: "(^|\\.)\\s*(?![^.]*(initial|but|then|later|eventual|agree|will try|accept|consent))[^.]*(refus|declin)[^.]*(olanzapine|medication)", why: "initial refusal recorded as final", critical: true },
      { id: "php", kind: "has", section: `${DISPO}|Treatment Plan`, pattern: "partial hospitalization|PHP", why: "level of care" },
      { id: "php-monday", kind: "has", section: `${DISPO}|Treatment Plan`, pattern: "monday", why: "start day" },
      { id: "side-effects", kind: "has", section: MED, pattern: "weight|sleepi|drows", why: "counseling" },
      { id: "nd-trauma", kind: "nd", section: SOC, label: "Trauma history", why: "not discussed" },
    ],
  },
  {
    id: "E3",
    title: "Anxiety and panic, benzodiazepine declined, family suicide attempt",
    kind: "EVAL",
    transcript:
      "Doctor, tell me what has been going on. Patient, I have been having panic attacks about three times a week for the last six months. My heart races, I sweat, I feel like I am going to die. I avoid driving on the highway now. I drink three or four glasses of wine on weekends and about four cups of coffee a day. Doctor, any thoughts of suicide? Patient, no. My sister tried to kill herself with pills when I was in high school, that was awful for our family. Doctor, have you taken medication for anxiety? Patient, my primary care doctor gave me Xanax last year but I stopped it after two weeks because it made me groggy. Doctor, any hospital stays or therapy? Patient, no hospital. I did eight sessions of therapy two years ago. Doctor, medical problems? Patient, asthma, I use an albuterol inhaler. Allergic to sulfa drugs, I get hives. Doctor, I think this fits panic disorder. I would like to start escitalopram ten milligrams every morning. I am not going to restart a benzodiazepine. We talked about nausea and sexual side effects, and the alternative of cognitive behavioral therapy alone. Patient, I would rather start the medicine. Doctor, follow up in three weeks.",
    checks: [
      { id: "panic-freq", kind: "has", section: HPI, pattern: "three times a week|3 times a week|three times weekly", why: "frequency" },
      { id: "six-months", kind: "has", section: HPI, pattern: "six months|6 months", why: "duration" },
      { id: "avoid-highway", kind: "has", section: HPI, pattern: "highway|driving", why: "functional impact" },
      { id: "alcohol", kind: "has", section: SUB, pattern: "wine|alcohol", why: "alcohol recorded" },
      { id: "caffeine-not-drug", kind: "lacks", section: SUB, pattern: "drug use(?![^.]*(no|denies|none))", why: "drug use invented" },
      { id: "no-si", kind: "has", section: SSRS, pattern: "denies|no (suicid|thoughts)|no\\b|none", why: "denies suicidal thoughts", critical: true },
      { id: "sister-not-patient-attempt", kind: "lacks", section: `${SSRS}|${PPH}`, pattern: "sister", why: "sister's attempt filed under the patient's own history or suicide behavior (family goes under Family History)", critical: true },
      { id: "sister-family", kind: "has", section: FAM, pattern: "sister[^.]*(suicide|attempt|pills|kill)", why: "family suicide attempt recorded", critical: true },
      { id: "xanax", kind: "has", section: PPH, pattern: "xanax|alprazolam", why: "prior medication" },
      { id: "xanax-dose-invented", kind: "lacks", section: PPH, pattern: "(xanax|alprazolam)[^.]{0,30}(\\d+|one|two|five|ten)\\s*(mg|milligram)", why: "dose never stated", critical: true },
      { id: "xanax-two-weeks", kind: "has", section: PPH, pattern: "two weeks|2 weeks|groggy", why: "reason or duration stopped" },
      { id: "therapy-8", kind: "has", section: PPH, pattern: "eight|8 sessions|therapy", why: "prior therapy" },
      { id: "no-hosp", kind: "has", section: PPH, pattern: "(no|denies|never)[^.]{0,30}hospital", why: "denial recorded" },
      { id: "asthma", kind: "has", section: MEDH, pattern: "asthma", why: "medical history" },
      { id: "albuterol", kind: "has", section: MEDH, pattern: "albuterol", why: "current medication" },
      { id: "sulfa", kind: "has", section: MEDH, pattern: "sulfa", why: "allergy", critical: true },
      { id: "escitalopram-10", kind: "has", section: MED, pattern: "escitalopram[^.]*(10|ten)", why: "drug and dose", critical: true },
      { id: "benzo-not-restarted", kind: "lacks", section: MED, pattern: "(^|\\.)\\s*(?![^.]*\\b(not|no|never|declin\\w*|without|n't)\\b)[^.]*(start|restart|prescrib|resum)[^.]*(xanax|alprazolam|benzodiazepine)", why: "declined drug recorded as started", critical: true },
      { id: "side-effects", kind: "has", section: MED, pattern: "nausea|sexual", why: "counseling" },
      { id: "alt-cbt", kind: "has", section: MED, pattern: "cognitive|CBT|therapy", why: "alternative" },
      { id: "followup-3w", kind: "has", section: `${MED}|${DISPO}|Treatment Plan`, pattern: "three weeks|3 weeks", why: "interval" },
      { id: "nd-firearms", kind: "nd", section: SOC, label: "Firearms / lethal means access", why: "not discussed", critical: true },
    ],
  },
  {
    id: "E4",
    title: "Trauma and suicidal ideation with plan, firearm in the home",
    kind: "EVAL",
    transcript:
      "Doctor, what made you decide to come in? Patient, I served in the army for six years and since I came back I have nightmares almost every night and I jump at loud noises. Lately I have been thinking about killing myself. Doctor, have you thought about how? Patient, I keep a handgun in the bedroom closet and I have thought about using it. I have not taken it out and I do not intend to do it today because of my daughter. Doctor, have you ever tried to end your life? Patient, yes, once in twenty eighteen I took a bottle of pills and my wife found me. I was in the hospital for three days. Doctor, any other hospital stays? Patient, no. Doctor, do you drink? Patient, six beers most nights. Doctor, medications? Patient, none. Doctor, I am very concerned about your safety. I would like you to give your wife the handgun key tonight or store the gun outside the home. Patient, I will give the gun to my brother tomorrow. Doctor, I recommend a partial hospitalization program starting tomorrow and we made a safety plan with the crisis line, nine eight eight. I would like to start prazosin one milligram at bedtime for the nightmares. Patient, okay.",
    checks: [
      { id: "nightmares", kind: "has", section: HPI, pattern: "nightmare", why: "core symptom" },
      { id: "army", kind: "has", section: `${SOC}|${HPI}`, pattern: "army|military|served", why: "background" },
      { id: "si-present", kind: "has", section: SSRS, pattern: "thought[^.]*(killing|suicid|kill)|suicidal thoughts|thinking about killing", why: "active ideation recorded", critical: true },
      { id: "method-gun", kind: "has", section: SSRS, pattern: "handgun|gun|firearm", why: "method recorded", critical: true },
      { id: "no-intent-today", kind: "has", section: SSRS, pattern: "(no|not)[^.]{0,30}intent|do(es)? not intend|not intend", why: "intent statement kept as said", critical: true },
      { id: "no-denial-of-si", kind: "lacks", section: SSRS, pattern: "denies (any )?(suicid|thoughts of (suicide|killing|harm))", why: "active ideation recorded as denied", critical: true },
      { id: "prior-attempt", kind: "has", section: `${SSRS}|${PPH}`, pattern: "(2018|twenty eighteen)[^.]*(pills|overdose|attempt)|(pills|overdose|attempt)[^.]*(2018|twenty eighteen)", why: "prior attempt", critical: true },
      { id: "hosp-3-days", kind: "has", section: PPH, pattern: "three days|3 days", why: "hospital stay" },
      { id: "alcohol-6", kind: "has", section: SUB, pattern: "six beers|6 beers|beer", why: "alcohol quantity" },
      { id: "firearms-yes", kind: "has", section: SOC, pattern: "handgun|gun|firearm", why: "lethal means recorded", critical: true },
      { id: "means-plan", kind: "has", section: `${SSRS}|${DISPO}|Treatment Plan|${SOC}`, pattern: "brother|wife|key|outside the home", why: "means restriction plan" },
      { id: "988", kind: "has", section: `${SSRS}|${DISPO}`, pattern: "988|nine eight eight|crisis", why: "safety plan resource" },
      { id: "prazosin-1", kind: "has", section: MED, pattern: "prazosin[^.]*(1 mg|1 milligram|one milligram)|(1 mg|1 milligram|one milligram)[^.]*prazosin", why: "drug and dose", critical: true },
      { id: "prazosin-wrong", kind: "lacks", pattern: "prazosin[^.]{0,30}\\b(2|5|10|0\\.5)\\b", why: "wrong dose", critical: true },
      { id: "php-tomorrow", kind: "has", section: `${DISPO}|Treatment Plan`, pattern: "partial hospitalization|PHP", why: "level of care" },
      { id: "nd-allergies", kind: "nd", section: MEDH, label: "Allergies", why: "never asked", critical: false },
      { id: "nd-family", kind: "nd", section: FAM, label: "Family psychiatric history", why: "not discussed" },
    ],
  },
  {
    id: "E5",
    title: "Very brief visit, almost nothing said",
    kind: "EVAL",
    transcript:
      "Doctor, how can I help you today? Patient, I do not know. I feel sad. Doctor, how long? Patient, a while. Doctor, how is your sleep? Patient, not great. Doctor, anything else you want to tell me? Patient, no. Doctor, okay, I would like you to come back next week and we will talk more.",
    checks: [
      { id: "sad", kind: "has", section: `${HPI}|Chief`, pattern: "sad", why: "only complaint" },
      { id: "sleep", kind: "has", section: HPI, pattern: "sleep", why: "sleep mentioned" },
      { id: "followup-week", kind: "has", section: `${DISPO}|Treatment Plan|${MED}`, pattern: "next week|one week|1 week", why: "follow-up" },
      { id: "no-duration-invented", kind: "lacks", section: HPI, pattern: "\\b(\\d+|two|three|four|five|six|seven|eight|nine|ten)\\s+(days?|weeks?|months?|years?)", why: "duration invented (patient said only 'a while')", critical: true },
      { id: "no-diagnosis", kind: "lacks", pattern: "(major depress|MDD|bipolar|anxiety disorder|insomnia disorder)", why: "diagnosis invented" },
      { id: "no-medication", kind: "lacks", section: MED, pattern: "(start|prescrib|sertraline|fluoxetine|escitalopram|trazodone|mirtazapine)", why: "medication invented", critical: true },
      { id: "nd-si-wish", kind: "nd", section: SSRS, label: "Wish to be dead", why: "never asked", critical: true },
      { id: "nd-si-thoughts", kind: "nd", section: SSRS, label: "Suicidal thoughts", why: "never asked", critical: true },
      { id: "nd-substance", kind: "nd", section: SUB, label: "Substances and pattern", why: "never asked" },
      { id: "nd-family", kind: "nd", section: FAM, label: "Family psychiatric history", why: "never asked" },
      { id: "nd-allergies", kind: "nd", section: MEDH, label: "Allergies", why: "never asked" },
      { id: "nd-hosp", kind: "nd", section: PPH, label: "Prior hospitalizations", why: "never asked" },
    ],
  },
];
