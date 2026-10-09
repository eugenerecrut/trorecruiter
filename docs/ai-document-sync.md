# AI document synchronization repair

## Confirmed causes

1. `documents.js::processOneDocument` and `retryDocumentAI` persist the AI container but never transfer it to the candidate.
2. Recommendation flatteners expect `personal` and `service`; flat responses lose their fields.
3. `script.js::saveCandidateFromRecommendation` omits VOS and canonical service profile fields. Some values survive only in legacy notes/form data, which V2 does not display.
4. `crm_apply_document_fields` excludes SHPK, tariff, recruiter, unit and signatory from its profile whitelist.
5. `document-upload-fix.js` is not loaded by the current application; its timestamp search cannot safely identify an upload across concurrent users.
6. The old relative submit callback searches by full name and writes a whole profile after saving. It can pick another namesake and race with document synchronization.
7. A local variable called `document` hides the DOM document inside the PDF OCR loop; OCR exceptions are swallowed.

## Implementation

`document-ai-sync.js` normalizes flat/nested data, builds a preview and applies only validated additions. It does not call OCR or introduce a new extraction pipeline.

- Canonical candidate VOS plus profile SHPK, tariff, recruiter, unit, desired unit, recommending unit, signatory and service type.
- Existing nonempty values (including legacy form values) have priority. Mobilization is not changed to contract.
- Invalid ranks, VOS, dates, mixed-script names/positions and ownership conflicts are reported rather than guessed.
- Birth certificate number/place and relatives use the same planner. Relation aliases and normalized names prevent duplicate parents. Existing relative properties remain intact; conflicts are reported separately.
- Current upload and AI retry invoke synchronization using the exact document ID. New candidate creation saves edited form values and relatives in its initial insert.
- Historical synchronization is explicit: Documents → “Перевірити синхронізацію”. Preview is read-only. Applying it fills empty fields only.
- Conflicts append deduplicated `[CRM AI sync]` entries to existing document warnings; existing document audit records these updates. Raw AI results are retained.

## Server and deployment

`20261009155939_safe_document_ai_sync.sql` replaces the existing RPC with the same signature. No table/column changes. It preserves active-staff authorization, caller RLS, source-document audit and document version checks, adds the missing service whitelist, checks the exact AI snapshot and current values under row locks, and protects existing relative properties. A stale preview aborts the entire RPC transaction.

Apply this migration **before** publishing the updated frontend. The current workflows do not apply SQL migrations. The migration has not been applied to production in this task; production backfill has not run.

Other document-specific review flows (education, work, VLK, biography, passport/ID) remain in place. The new automatic planner handles recommendation letters and the candidate's birth certificate; it never interprets a child's certificate as candidate identity.

## Verification

- `node --test tests/crm-document-ai-sync.cjs`: normalization, invalid OCR, manual/legacy preservation, ownership, parents/dates/relations, repeated upload, reload, conflict logging, stale previews and active PDF upload.
- Existing suites: `crm-audit`, `crm-interface`, `crm-card-v3`, `crm-mobilization`, `crm-education-summary`, `crm-education-fields`, `crm-archive-path`.
- PostgreSQL SQL and PL/pgSQL parsed locally with `pglast` (no production DDL).
- GitHub Actions runs the new and existing tests without database credentials.

Database persistence tests use a transactional contract mock. They are not a claim that the migration has been integration-tested against production RLS. Real document control previews were read from Supabase and saved outside the repository; they have not been applied. No private AI payloads are checked in.

Browser fixture: `tests/document-ai-sync-fixture.html` uses synthetic in-memory data only. Automated browser access to the local server timed out in this environment, so the interactive dialog has not been visually verified here.
