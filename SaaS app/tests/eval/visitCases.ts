// Synthetic follow-up and discharge visits, each with the patient's earlier note. Everything here is invented.
import type { Case } from "./types";

const PROG = "Progress Note Carry";
const DC = "Discharge Summary Carry";
const SSRS = "Suicide Risk";
const MED = "Medication";
const DISPO = "Level of Care";

export const visitCases: Case[] = [
  {
    id: "F1",
    title: "Follow-up: doctor proposes raising sertraline (attribution)",
    kind: "FOLLOW_UP",
    priorNote:
      "Patient: Testcase, Alpha. Psychiatric evaluation 2026-10-05. Major depressive episode, moderate. Started sertraline 50 milligrams every morning. Allergies: none known. Medical history: hypertension on lisinopril 10 milligrams. Family history: mother with depression. Alcohol: stopped one year ago. No prior hospitalizations. Plan: follow up in two weeks.",
    transcript:
      "Doctor, what brings you in today? Patient, I have not been sleeping well for about two weeks. I only get around three hours a night and I feel low most days. I have been missing work. Doctor, any thoughts of hurting yourself? Patient, no, I deny any thoughts of suicide. Doctor, are you taking any medication? Patient, I take sertraline fifty milligrams every morning. Doctor, I would like to increase it to one hundred milligrams and review in two weeks. The patient agrees.",
    checks: [
      { id: "sleep-3h", kind: "has", section: PROG, pattern: "three hours|3 hours", why: "sleep" },
      { id: "missing-work", kind: "has", section: PROG, pattern: "work", why: "functional impact" },
      { id: "denies-si", kind: "has", section: `${SSRS}|${PROG}`, pattern: "deni|no (thoughts|suicid)", why: "denies SI", critical: true },
      { id: "increase-100", kind: "has", section: `${PROG}|${MED}`, pattern: "(100|hundred)", why: "new dose", critical: true },
      { id: "doctor-proposes", kind: "lacks", pattern: "patient[^.]{0,50}(request|ask|want|would like|propos|suggest)[^.]{0,50}(increase|100|hundred)", why: "doctor's proposal attributed to the patient", critical: true },
      { id: "current-50", kind: "has", section: `${PROG}|${MED}`, pattern: "(50|fifty)", why: "current dose" },
      { id: "wrong-dose", kind: "lacks", pattern: "sertraline[^.]{0,30}\\b(25|150|200)\\b", why: "wrong dose", critical: true },
      { id: "two-weeks", kind: "has", section: `${PROG}|${MED}|${DISPO}`, pattern: "two weeks|2 weeks", why: "follow-up" },
      { id: "no-new-dx", kind: "lacks", section: PROG, pattern: "(bipolar|schizo|anxiety disorder)", why: "diagnosis invented" },
      { id: "prior-not-restated-as-new", kind: "lacks", section: PROG, pattern: "lisinopril|hypertension|mother", why: "old history presented as today's report" },
    ],
  },
  {
    id: "F2",
    title: "Follow-up: improving, side effect resolved, spouse disagrees",
    kind: "FOLLOW_UP",
    priorNote:
      "Patient: Sample, Bravo. Follow-up 2026-10-05. Major depressive disorder. Sertraline 100 milligrams every morning started two weeks ago, with nausea reported. Allergy: penicillin, rash. No suicidal ideation. Plan: continue sertraline, review in two weeks.",
    transcript:
      "Doctor, how have the last two weeks been? Patient, better. The nausea went away after the first week. I am sleeping about seven hours now. I still have low energy in the afternoons. Doctor, any thoughts of hurting yourself? Patient, no, none. Doctor, any missed doses? Patient, I missed two doses last week. My husband thinks I should stop the medicine, but I want to keep taking it. Doctor, I will continue the sertraline at one hundred milligrams. I would also like to refer you to therapy, a counselor called Dr. Okafor. Patient, okay. Doctor, see you in four weeks.",
    checks: [
      { id: "nausea-resolved", kind: "has", section: PROG, pattern: "nausea[^.]*(went away|resolv|gone|improv|stopped|subsid)|(resolv|improv|subsid)[^.]*nausea", why: "side effect resolved" },
      { id: "sleep-7", kind: "has", section: PROG, pattern: "seven hours|7 hours", why: "sleep" },
      { id: "low-energy", kind: "has", section: PROG, pattern: "energy", why: "residual symptom" },
      { id: "no-si", kind: "has", section: `${SSRS}|${PROG}`, pattern: "deni|no\\b|none", why: "denies SI", critical: true },
      { id: "missed-two", kind: "has", section: `${PROG}|${MED}`, pattern: "(missed|skipped)[^.]*(two|2)|(two|2)[^.]*(missed|skipped)", why: "adherence" },
      { id: "husband-opinion-not-patient", kind: "lacks", pattern: "patient[^.]{0,40}(wants|wishes|plans|decid)[^.]{0,30}(stop|discontinue)", why: "husband's opinion attributed to the patient", critical: true },
      { id: "keep-taking", kind: "has", section: `${PROG}|${MED}`, pattern: "continue|keep taking|keep", why: "patient preference" },
      { id: "sert-100", kind: "has", section: `${PROG}|${MED}`, pattern: "(100|hundred)", why: "dose", critical: true },
      { id: "okafor", kind: "has", section: `${PROG}|${DISPO}|${MED}`, pattern: "okafor", why: "referral name" },
      { id: "four-weeks", kind: "has", section: `${PROG}|${DISPO}|${MED}`, pattern: "four weeks|4 weeks", why: "interval" },
      { id: "allergy-not-restated", kind: "lacks", section: PROG, pattern: "penicillin", why: "old allergy presented as today's statement" },
    ],
  },
  {
    id: "F3",
    title: "Follow-up: lithium dose reduced for tremor",
    kind: "FOLLOW_UP",
    priorNote:
      "Patient: Fixture, Charlie. Bipolar I disorder, recent manic episode, stabilizing. Lithium 900 milligrams at bedtime. Olanzapine stopped. Prior hospitalization 2019. Allergy: none. Plan: lithium level and thyroid tests at next visit.",
    transcript:
      "Doctor, how are you feeling? Patient, calmer. I am sleeping six hours and my thoughts are not racing. The only problem is my hands shake, especially in the morning. Doctor, your lithium level came back at point eight and your thyroid test was normal. Any thoughts of harming yourself or anyone else? Patient, no. Doctor, because of the tremor I will lower the lithium from nine hundred to six hundred milligrams at bedtime. Patient, that is fine. Doctor, we will recheck the level in two weeks and I will see you in three weeks.",
    checks: [
      { id: "calmer", kind: "has", section: PROG, pattern: "calm", why: "improvement" },
      { id: "sleep-6", kind: "has", section: PROG, pattern: "six hours|6 hours", why: "sleep" },
      { id: "tremor", kind: "has", section: PROG, pattern: "tremor|shak", why: "side effect" },
      { id: "level-0.8", kind: "has", section: `${PROG}|${MED}`, pattern: "(0\\.8|point eight)", why: "lab value", critical: true },
      { id: "thyroid-normal", kind: "has", section: `${PROG}|${MED}`, pattern: "thyroid[^.]*normal|normal[^.]*thyroid", why: "lab result" },
      { id: "no-si-hi", kind: "has", section: `${SSRS}|${PROG}`, pattern: "deni|no\\b", why: "denies SI/HI", critical: true },
      { id: "lithium-reduced", kind: "has", section: `${PROG}|${MED}`, pattern: "(600|six hundred)", why: "new dose", critical: true },
      { id: "direction", kind: "lacks", pattern: "(increas|rais)[^.]{0,30}lithium|lithium[^.]{0,30}(increas|raised)", why: "dose change direction reversed", critical: true },
      { id: "from-900", kind: "has", section: `${PROG}|${MED}`, pattern: "(900|nine hundred)", why: "previous dose" },
      { id: "level-recheck-2w", kind: "has", section: `${PROG}|${MED}|${DISPO}`, pattern: "two weeks|2 weeks", why: "recheck interval" },
      { id: "visit-3w", kind: "has", section: `${PROG}|${MED}|${DISPO}`, pattern: "three weeks|3 weeks", why: "next visit" },
      { id: "olanzapine-not-restarted", kind: "lacks", section: `${PROG}|${MED}`, pattern: "olanzapine[^.]{0,30}(start|continu|resum|taking)", why: "stopped drug presented as current" },
    ],
  },
  {
    id: "F4",
    title: "Follow-up: worsening, passive suicidal thoughts after a breakup",
    kind: "FOLLOW_UP",
    priorNote:
      "Patient: Mockup, Delta. Depression, improving on bupropion 150 milligrams every morning. No suicidal ideation at last visit. Prior suicide attempt: none. Lives with roommate. Plan: continue bupropion, review in three weeks.",
    transcript:
      "Doctor, you look tired. What has changed? Patient, my girlfriend left me on Sunday. I have barely eaten or slept since. Doctor, are you having thoughts of hurting yourself? Patient, sometimes I think everyone would be better off without me. I do not have a plan and I would not do anything, my dog needs me. Doctor, have you taken any extra medication? Patient, no. Doctor, we reviewed the safety plan together and I gave you the crisis line, nine eight eight. I am worried about the next few days. I recommend moving you from weekly visits to the intensive outpatient program starting Monday. Patient, okay. Doctor, continue the bupropion one hundred fifty milligrams in the morning.",
    checks: [
      { id: "breakup", kind: "has", section: PROG, pattern: "girlfriend|breakup|break-up|relationship", why: "stressor" },
      { id: "barely-eaten-slept", kind: "has", section: PROG, pattern: "eaten|eating|appetite|slept|sleep", why: "symptom change" },
      { id: "passive-si", kind: "has", section: SSRS, pattern: "better off without|would be better off|passive|thoughts", why: "passive ideation recorded", critical: true },
      { id: "no-plan", kind: "has", section: SSRS, pattern: "no plan|does not have a plan|denies (having )?(a )?plan|without a plan", why: "no plan", critical: true },
      { id: "no-denial-of-si", kind: "lacks", section: `${SSRS}|${PROG}`, pattern: "denies (any )?(suicid|thoughts)", why: "ideation recorded as denied", critical: true },
      { id: "protective-dog", kind: "has", section: SSRS, pattern: "dog", why: "protective factor" },
      { id: "no-overdose", kind: "lacks", section: `${SSRS}|${PROG}`, pattern: "(took|taken|ingested)[^.]{0,30}extra(?![^.]*(no|not|denies))", why: "extra medication invented", critical: true },
      { id: "988", kind: "has", section: `${SSRS}|${DISPO}|${PROG}`, pattern: "988|nine eight eight|crisis", why: "safety resource" },
      { id: "iop-monday", kind: "has", section: `${DISPO}|${PROG}`, pattern: "intensive outpatient|IOP", why: "level of care", critical: true },
      { id: "monday", kind: "has", section: `${DISPO}|${PROG}`, pattern: "monday", why: "start" },
      { id: "bupropion-150", kind: "has", section: `${MED}|${PROG}`, pattern: "bupropion[^.]*(150|one hundred fifty)|(150|one hundred fifty)[^.]*bupropion", why: "dose", critical: true },
      { id: "prior-not-restated", kind: "lacks", section: PROG, pattern: "roommate", why: "old history presented as today's report" },
    ],
  },
  {
    id: "D1",
    title: "Discharge after partial hospitalization, improved",
    kind: "DISCHARGE",
    priorNote:
      "Patient: Dummy, Echo. Admitted to partial hospitalization on 2026-09-28 for post-traumatic stress disorder with nightmares and passive suicidal thoughts. Prior suicide attempt 2018 by overdose, one hospitalization. Medical history: asthma. Family: father with alcohol use disorder. Alcohol six beers most nights at admission. Started prazosin 1 milligram at bedtime and sertraline 50 milligrams.",
    transcript:
      "Doctor, this is your last day in the program. How are you doing? Patient, much better. The nightmares are down to once a week and I am sleeping about six hours. Doctor, any thoughts of hurting yourself? Patient, no, not for two weeks. Doctor, how about alcohol? Patient, I have not had a drink since I started the program, twenty one days. Doctor, we increased the prazosin to two milligrams at bedtime and the sertraline to one hundred milligrams. Patient, I am taking both. Doctor, you will see Dr. Rivera for medication management in one week and a therapist, Ms. Patel, every Tuesday. You have the crisis line number nine eight eight. Patient, yes. Doctor, you are stable for discharge to outpatient care and your risk is low in my assessment.",
    checks: [
      { id: "nightmares-weekly", kind: "has", section: DC, pattern: "nightmare[^.]*(once a week|weekly|1 time|once per week)|once a week[^.]*nightmare", why: "course" },
      { id: "sleep-6", kind: "has", section: DC, pattern: "six hours|6 hours", why: "sleep" },
      { id: "no-si-2w", kind: "has", section: DC, pattern: "(no|denies|without)[^.]{0,40}(suicid|thoughts|harm)", why: "risk statement", critical: true },
      { id: "sober-21", kind: "has", section: DC, pattern: "(21|twenty one|twenty-one)[^.]*(days|sober|abstin|alcohol)|abstin[^.]*(21|twenty)", why: "abstinence", critical: true },
      { id: "prazosin-2", kind: "has", section: DC, pattern: "prazosin[^.]*(2 mg|2 milligrams|two milligrams)", why: "current dose", critical: true },
      { id: "sertraline-100", kind: "has", section: DC, pattern: "sertraline[^.]*(100|one hundred)", why: "current dose", critical: true },
      { id: "old-doses-as-current", kind: "lacks", section: "Discharge Summary Carry|Medication", pattern: "(discharge|current|continu)[^.]{0,40}(prazosin[^.]{0,20}(1 mg|1 milligram|one milligram)|sertraline[^.]{0,20}(50|fifty))", why: "admission dose presented as discharge dose", critical: true },
      { id: "rivera", kind: "has", section: DC, pattern: "rivera", why: "follow-up provider" },
      { id: "rivera-week", kind: "has", section: DC, pattern: "(one|1) week", why: "interval" },
      { id: "patel-tuesday", kind: "has", section: DC, pattern: "patel[^.]*tuesday|tuesday[^.]*patel", why: "therapy schedule" },
      { id: "risk-low-by-doctor", kind: "has", section: DC, pattern: "low", why: "doctor's risk statement", critical: true },
      { id: "history-from-prior", kind: "has", section: DC, pattern: "2018|overdose|attempt", why: "carried-forward history" },
      { id: "family-from-prior", kind: "has", section: DC, pattern: "father", why: "carried-forward family history" },
      { id: "no-discharge-to-wrong-place", kind: "lacks", section: DC, pattern: "(inpatient|residential|hospital)[^.]{0,30}(transfer|discharged to|referred to)", why: "wrong disposition" },
    ],
  },
  {
    id: "D2",
    title: "Discharge after mania, lithium discontinued, olanzapine continued",
    kind: "DISCHARGE",
    priorNote:
      "Patient: Zzsample, Foxtrot. Admitted 2026-09-20 for a manic episode with decreased need for sleep and impulsive spending. Bipolar I disorder. Prior hospitalization 2019 for nine days. Father with bipolar disorder. Daily marijuana use. Allergy: penicillin. Started olanzapine 5 milligrams at bedtime and lithium 600 milligrams at bedtime.",
    transcript:
      "Doctor, how are you feeling before you go home? Patient, steady. I am sleeping seven hours and I have not spent anything extra. Doctor, we stopped the lithium last week because of the tremor and your kidney numbers. You are staying on olanzapine ten milligrams at bedtime. Patient, I understand. Doctor, any thoughts of harming yourself or others? Patient, no. Doctor, are you using marijuana? Patient, I have not used since I came in. Doctor, your follow up is with Dr. Nguyen at the clinic in ten days, and a blood test on that day. Patient, okay. Doctor, you are stable for discharge home with your wife.",
    checks: [
      { id: "sleep-7", kind: "has", section: DC, pattern: "seven hours|7 hours", why: "sleep" },
      { id: "no-spending", kind: "has", section: DC, pattern: "(no|not|any)[^.]{0,30}(spend|spent)|spent anything|spending", why: "behavior" },
      { id: "lithium-stopped", kind: "has", section: DC, pattern: "lithium[^.]*(stopp|discontinu|held|off)|(stopp|discontinu)[^.]*lithium", why: "medication stopped", critical: true },
      { id: "lithium-not-continued", kind: "lacks", section: `${DC}|${MED}`, pattern: "(^|\\.)\\s*(?![^.]*\\b(stopp\\w*|discontinu\\w*|no longer|not|held|off)\\b)[^.]*(?<!dis)(continu|remain|resum|current|taking)[^.]*lithium", why: "stopped drug listed as continued", critical: true },
      { id: "lithium-reason", kind: "has", section: DC, pattern: "tremor|kidney|renal", why: "reason" },
      { id: "olanzapine-10", kind: "has", section: DC, pattern: "olanzapine[^.]*(10|ten)", why: "discharge dose", critical: true },
      { id: "olanzapine-old-dose", kind: "lacks", section: `${DC}|${MED}`, pattern: "(discharge|current|continu)[^.]{0,30}olanzapine[^.]{0,20}(5 mg|5 milligrams|five milligrams)", why: "admission dose as discharge dose", critical: true },
      { id: "no-si-hi", kind: "has", section: DC, pattern: "(no|denies)[^.]{0,40}(harm|suicid|thoughts)", why: "risk", critical: true },
      { id: "marijuana-abstinent", kind: "has", section: DC, pattern: "marijuana[^.]*(not|no|since)|not used|abstin", why: "substance" },
      { id: "nguyen", kind: "has", section: DC, pattern: "nguyen", why: "follow-up" },
      { id: "ten-days", kind: "has", section: DC, pattern: "ten days|10 days", why: "interval" },
      { id: "blood-test", kind: "has", section: DC, pattern: "blood", why: "lab" },
      { id: "home-wife", kind: "has", section: DC, pattern: "home|wife", why: "disposition" },
      { id: "allergy-carry", kind: "has", section: DC, pattern: "penicillin", why: "carried-forward allergy" },
    ],
  },
  {
    id: "D3",
    title: "Discharge: patient declines continued medication",
    kind: "DISCHARGE",
    priorNote:
      "Patient: Testcase, Golf. Admitted 2026-10-01 for major depressive episode with anxiety. Started escitalopram 10 milligrams every morning. No prior hospitalizations. Mother with anxiety. Alcohol: two glasses of wine weekly. Allergy: sulfa, hives.",
    transcript:
      "Doctor, how are things today? Patient, my mood is a little better but I still feel anxious in the evenings. Doctor, any thoughts of suicide? Patient, no. Doctor, you have been on escitalopram ten milligrams for two weeks. I recommend continuing it. Patient, no, I do not want to continue it. It makes me feel numb. I would rather try therapy only. Doctor, I explained the risks of stopping, including that your symptoms may return. Patient, I understand and I still want to stop. Doctor, I will document that you declined medication. I will refer you to a therapist, Ms. Brooks, and you should call your primary care doctor within one week. Patient, okay. Doctor, you are stable for discharge and I consider your risk moderate because of the anxiety and stopping medication.",
    checks: [
      { id: "mood-better", kind: "has", section: DC, pattern: "better|improv", why: "course" },
      { id: "evening-anxiety", kind: "has", section: DC, pattern: "anxi[^.]*evening|evening[^.]*anxi", why: "residual symptom" },
      { id: "no-si", kind: "has", section: DC, pattern: "(no|denies)[^.]{0,40}(suicid|thoughts)", why: "risk", critical: true },
      { id: "declined-med", kind: "has", section: `${DC}|${MED}`, pattern: "(declin|refus|does not want|do not want|not want|stop)[^.]*(escitalopram|medication|continue)", why: "refusal recorded", critical: true },
      { id: "not-continued", kind: "lacks", section: `${DC}|${MED}`, pattern: "(^|\\.)\\s*(?![^.]*\\b(declin\\w*|refus\\w*|not|no longer|stop\\w*|discontinu\\w*|without|despite|rather)\\b)[^.]*(?<!dis)(continue|continued|discharged? on)[^.]*escitalopram", why: "declined drug listed as continued", critical: true },
      { id: "numb", kind: "has", section: `${DC}|${MED}`, pattern: "numb", why: "reason" },
      { id: "risks-explained", kind: "has", section: `${DC}|${MED}`, pattern: "risk|return|relapse", why: "counseling recorded", critical: true },
      { id: "therapy-brooks", kind: "has", section: DC, pattern: "brooks", why: "referral" },
      { id: "pcp-week", kind: "has", section: DC, pattern: "primary care|PCP", why: "follow-up" },
      { id: "risk-moderate", kind: "has", section: DC, pattern: "moderate", why: "doctor's risk statement", critical: true },
      { id: "risk-not-low", kind: "lacks", section: DC, pattern: "risk[^.]{0,20}\\blow\\b", why: "risk level changed", critical: true },
      { id: "history-carried", kind: "has", section: DC, pattern: "sulfa|wine|mother", why: "carried-forward history" },
    ],
  },
];
