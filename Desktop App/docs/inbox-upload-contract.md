# Desktop to SaaS transcript upload: the inbox contract (v1)

Goal: a recording can never be lost or duplicated, and uploading never depends on the visit existing.
Production only. All routes are under `/api/desktop/v1`, bearer token as today, Notes edit access.

## Ids and checksums
- `uuid`: a version 4 UUID the Desktop creates when a recording starts. It is the identity of the recording forever (retries, resumes, links).
- `sha256`: lowercase hex SHA-256 of the UTF-8 bytes of `text` exactly as sent.

## 1. Send (or update) a recording: `PUT /notes/inbox/:uuid`
Body: `{ "seq": 3, "final": false, "text": "<whole transcript so far>", "sha256": "<hex>", "durationSeconds": 612.4, "recordedAt": "2026-11-18T14:03:00Z", "visitId": "<optional>" }`
- Each request carries the WHOLE transcript so far (transcripts are a few KB), so any request can be lost or repeated safely. `seq` starts at 1 and grows by 1 per checkpoint. The final request (`final:true`) uses `seq` 1000000 (the Desktop's `FINAL_SEQ`), so "final seq equals its last" means the server echoes `final:true` and the same `sha256`; accept any seq at least the stored one for a final.
- Server: verify `sha256` of `text` (mismatch: `422 {"error":"checksum_mismatch"}`, the Desktop resends). Store if `seq` is higher than the stored one.
- Reply `200 {"ok":true,"uuid":"...","seq":3,"sha256":"<hex of the text the server now holds>","final":false,"visitId":null|"<id>"}`.
- Idempotent: same `uuid`+`seq`+`sha256` again returns the same 200. A lower `seq` than stored returns 200 with `"stale":true` and the stored `seq`/`sha256` (no change). Same `seq` with a different `sha256`: `409 {"error":"seq_conflict"}`.
- `final:true` closes the recording. After final, an identical resend returns 200; anything different returns `409 {"error":"already_final"}`.
- `visitId` is optional. If given and the visit exists, link it. If the visit does not exist, STILL ACCEPT (200, `visitId:null`); never 404/403 because of the visit. 403 only for missing Notes access, 401 for an expired token.
- Limits: `text` up to 2 MB (`413 too_large`), `uuid` must be a v4 UUID (`400 bad_uuid`).

The Desktop deletes its local copy only after a 200 whose `final:true` and `sha256` equal to its own. It then keeps the encrypted copy 24 hours more.

## 2. Link to a visit: `POST /notes/inbox/:uuid/link`
Body `{ "visitId": "..." }`. 200 `{"ok":true,"visitId":"..."}` (idempotent for the same visit). `404 visit_not_found` leaves it in the inbox. `409 already_linked` if linked to a different visit. Linking writes the transcript to the visit exactly as `POST /notes/visits/:id/transcript` does today.

## 3. List the inbox: `GET /notes/inbox?linked=false`
200 `{"items":[{"uuid","recordedAt","durationSeconds","final":true,"seq":3,"visitId":null}]}` (newest first). Used by the Needs link list in the web app and the Desktop. A bare `GET /notes/inbox` returning 200 also tells the Desktop the inbox exists (it falls back to the old visit upload on 404 until the route ships).

## Desktop behaviour (for reference)
- Local first: the transcript so far is written encrypted on the Mac every ~30 s of speech while recording; audio is never saved. Finish only closes the local file.
- Background: the Desktop PUTs checkpoints while recording and the final one at Finish, retrying with exponential backoff (5 s doubling to 5 min) without user action; the old per-visit upload remains as fallback only while the inbox route is not deployed.
- Status line per recording: Recording / Saved on this Mac / Uploading N% / Safe on server.
