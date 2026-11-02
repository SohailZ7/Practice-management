# Model comparison

Cases: 12. Runs per case: 1.

| Model | Facts found | No wrong statements | No inventions | Critical checks | Unsupported words | Avg time per note |
|---|---|---|---|---|---|---|
| gemma3:12b | 90% (116/129) | 89% (33/37) | 83% (10/12) | 84% (57/68) | 30.5% | 153 s |
| gpt-oss:20b | 93% (42/45) | 87% (13/15) | 100% (4/4) | 95% (21/22) | 26.3% | 1081 s |
| medgemma:27b | 97% (125/129) | 92% (34/37) | 92% (11/12) | 91% (62/68) | 26.7% | 332 s |
| phi4 | 94% (121/129) | 86% (32/37) | 92% (11/12) | 85% (58/68) | 36.0% | 183 s |
| qwen2.5:14b-instruct | 92% (119/129) | 97% (36/37) | 100% (12/12) | 96% (65/68) | 38.2% | 571 s |
| qwen3:14b | 94% (121/129) | 97% (36/37) | 92% (11/12) | 93% (63/68) | 35.5% | 196 s |

## By note type (critical checks passed)

| Model | Evaluation | Follow-up | Discharge |
|---|---|---|---|
| gemma3:12b | 85% (29/34) | 94% (16/17) | 71% (12/17) |
| gpt-oss:20b | 95% (21/22) | n/a | n/a |
| medgemma:27b | 88% (30/34) | 94% (16/17) | 94% (16/17) |
| phi4 | 85% (29/34) | 82% (14/17) | 88% (15/17) |
| qwen2.5:14b-instruct | 97% (33/34) | 94% (16/17) | 94% (16/17) |
| qwen3:14b | 91% (31/34) | 100% (17/17) | 88% (15/17) |

## Failed checks (count of runs failed / runs)

### gemma3:12b
- **CRITICAL** D1/no-si-2w: 1/1  (risk statement)
- **CRITICAL** D1/prazosin-2: 1/1  (current dose)
- **CRITICAL** D1/sertraline-100: 1/1  (current dose)
- D1/history-from-prior: 1/1  (carried-forward history)
- D2/marijuana-abstinent: 1/1  (substance)
- D2/allergy-carry: 1/1  (carried-forward allergy)
- **CRITICAL** D3/no-si: 1/1  (risk)
- **CRITICAL** D3/not-continued: 1/1  (declined drug listed as continued)
- **CRITICAL** E1/no-attempts: 1/1  (no prior attempts)
- E1/family-not-patient: 1/1  (family history placed in the patient's own history)
- E1/no-depression-medhx: 1/1  (psychiatric or family item invented under medical history)
- E2/collateral-truck: 1/1  (spouse's report captured)
- **CRITICAL** E3/sister-not-patient-attempt: 1/1  (sister's attempt filed under the patient's own history or suicide behavior (family goes under Family History))
- **CRITICAL** E4/no-intent-today: 1/1  (intent statement kept as said)
- E4/hosp-3-days: 1/1  (hospital stay)
- **CRITICAL** E5/nd-si-wish: 1/1  (never asked)
- **CRITICAL** E5/nd-si-thoughts: 1/1  (never asked)
- **CRITICAL** F3/level-0.8: 1/1  (lab value)
- F3/thyroid-normal: 1/1  (lab result)

### gpt-oss:20b
- **CRITICAL** E1/no-attempts: 1/1  (no prior attempts)
- E1/family-not-patient: 1/1  (family history placed in the patient's own history)
- E2/collateral-truck: 1/1  (spouse's report captured)
- E2/family-not-patient: 1/1  (family history in patient's own history)
- E3/panic-freq: 1/1  (frequency)

### medgemma:27b
- D2/allergy-carry: 1/1  (carried-forward allergy)
- **CRITICAL** D3/no-si: 1/1  (risk)
- **CRITICAL** E1/no-attempts: 1/1  (no prior attempts)
- E2/truck-attrib: 1/1  (spouse's collateral attributed to the patient)
- **CRITICAL** E3/sister-not-patient-attempt: 1/1  (sister's attempt filed under the patient's own history or suicide behavior (family goes under Family History))
- **CRITICAL** E4/no-intent-today: 1/1  (intent statement kept as said)
- **CRITICAL** E5/nd-si-wish: 1/1  (never asked)
- **CRITICAL** F1/doctor-proposes: 1/1  (doctor's proposal attributed to the patient)

### phi4
- D1/history-from-prior: 1/1  (carried-forward history)
- **CRITICAL** D2/no-si-hi: 1/1  (risk)
- **CRITICAL** D3/no-si: 1/1  (risk)
- **CRITICAL** E1/no-attempts: 1/1  (no prior attempts)
- E1/family-not-patient: 1/1  (family history placed in the patient's own history)
- **CRITICAL** E1/lisinopril: 1/1  (dose kept)
- **CRITICAL** E1/no-sleeping-pill: 1/1  (declined drug recorded as started)
- E2/family-not-patient: 1/1  (family history in patient's own history)
- **CRITICAL** E3/sister-not-patient-attempt: 1/1  (sister's attempt filed under the patient's own history or suicide behavior (family goes under Family History))
- **CRITICAL** E5/nd-si-wish: 1/1  (never asked)
- **CRITICAL** F1/doctor-proposes: 1/1  (doctor's proposal attributed to the patient)
- **CRITICAL** F3/level-0.8: 1/1  (lab value)
- F3/thyroid-normal: 1/1  (lab result)
- **CRITICAL** F4/no-plan: 1/1  (no plan)

### qwen2.5:14b-instruct
- **CRITICAL** D2/no-si-hi: 1/1  (risk)
- D2/allergy-carry: 1/1  (carried-forward allergy)
- D3/numb: 1/1  (reason)
- **CRITICAL** E1/no-attempts: 1/1  (no prior attempts)
- E1/no-hosp: 1/1  (denial recorded, not left blank)
- E1/no-depression-medhx: 1/1  (psychiatric or family item invented under medical history)
- E2/sleep: 1/1  (sleep amount)
- E3/no-hosp: 1/1  (denial recorded)
- F1/current-50: 1/1  (current dose)
- **CRITICAL** F3/level-0.8: 1/1  (lab value)
- F3/thyroid-normal: 1/1  (lab result)

### qwen3:14b
- D2/sleep-7: 1/1  (sleep)
- **CRITICAL** D2/no-si-hi: 1/1  (risk)
- **CRITICAL** D3/no-si: 1/1  (risk)
- **CRITICAL** E1/no-plan: 1/1  (denies plan)
- **CRITICAL** E1/no-attempts: 1/1  (no prior attempts)
- E2/family-not-patient: 1/1  (family history in patient's own history)
- E3/no-hosp: 1/1  (denial recorded)
- **CRITICAL** E5/nd-si-wish: 1/1  (never asked)
- F2/four-weeks: 1/1  (interval)
- F3/thyroid-normal: 1/1  (lab result)
