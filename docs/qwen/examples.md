# Verified CRM examples — version 4

These examples describe existing tested rules. They are not instructions to update production records. References name executable repository tests.

## 1. An assertion must inspect the real property

Input: `result.selections=[{key:'military_registry_number'}]`.
Wrong: `!result.selections.some(s=>s.field==='military_registry_number')` returns true and hides a forbidden proposal.
Correct: `!result.selections.some(s=>s.key==='military_registry_number')` returns false.
Reference: tests/crm-document-ai-sync.cjs, “draft-registration preserves manual registry number”.

## 2. A conflict must belong to the intended field

Input: rows have `{key:'phone',action:'conflict'}` and `{key:'military_registry_number',action:'leave'}`.
Wrong: `rows.some(r=>r.action==='conflict')` proves nothing about the registry number.
Correct: `rows.find(r=>r.key==='military_registry_number').action==='conflict'` is false.
Reference: the same field-specific regression.

## 3. Failed OCR cannot fall back to the legacy writer

Input: an old ai_extracted remains saved, processing_status is “AI помилка”, planner says supported:false.
Correct: stop before routing or reading the candidate. Preserve old extraction; do not invoke another mapper or retry AI automatically.
Reference: tests/crm-legacy-review-guard.cjs.

## 4. Source names are not document mentions

Input: a full PFU extract title, or a recommendation letter containing that title as quoted text.
Correct: the narrow full-title alias accepts the former and rejects the latter. Existing work-document matches remain intact. Use anchored matching and normalize known spelling/spacing differences.
Reference: tests/crm-work-document-types.cjs.

## 5. Manual service type has priority

Input: profile.service_type is “За мобілізацією”; a recommendation proposes “За контрактом”.
Correct: preserve the saved value and expose the discrepancy. Never resolve it by choosing the newest OCR.
Reference: tests/crm-document-ai-sync.cjs, “Flat and nested RL yield identical validated selections and preserve mobilization”.

## 6. A repeated period is not a new period

Input: an already transferred PFU work period is processed again from the same source.
Correct: no duplicate work period; preserve document ID and source pages.
Reference: tests/crm-work-document-types.cjs.

## 7. A module owner must not be invoked twice

Input: CRMDashboard.load exists and loads the current dashboard; old updateDashboard is called concurrently.
Correct: old counters return without querying or calling CRMDashboard.load again. If the modern module is absent, keep the legacy path.
Reference: tests/crm-dashboard-document-status.cjs.

## 8. Partial dates remain partial

Input: a source reports only “2020-02”.
Correct: retain month precision or request review. Do not manufacture “2020-02-01” as an observed date; an internal comparison range is not the source fact.
Reference: tests/crm-period-links.cjs.

## 9. Execute simple matching before claiming it fails

`/паспорт/iu.test('Копія паспорта/ID Картки')` is true.
`/шлюб/iu.test('Копія свідоцтва про шлюб')` is true.
A document failing to match an unrelated module is not automatically a routing bug. Check the complete routing path.

## 10. Work periods and service periods answer different questions

Wrong: any nonempty work_records suppresses both employment and service questions.
Correct: usable employment records satisfy employment; military_service or police_service records satisfy service. requires_review or crossed_out records do not satisfy either. Keep legacy narrative behavior; reuse CRMBiographyFacts.profile for accepted biography work facts without writing or duplicating them.
Synthetic case: worked_before=true, served_before=true, one usable police_service record, no narratives. Ask about employment, not service. A crossed_out employment record cannot satisfy employment.
Reference: tests/crm-case-assistant.cjs, “work and service questions require a usable record of the corresponding kind” and “accepted biography work facts satisfy work questions without mutating the card”. CRM PR #170.

## 11. Scope sources before choosing versions or fallback values

Wrong: choose latest() across mixed candidates, then filter the current candidate. A higher foreign version can hide an owned source.
Correct: reject explicitly foreign candidate_id first, then call latest(), count and plan. Foreign-only files cannot satisfy an owned requirement.
Reference: tests/crm-case-assistant.cjs, “case report scopes candidate sources before latest versions, counts and planning” (CRM PR #178).

A personal_files fallback with a different explicit candidate_id cannot supply birthplace. Blank or whitespace-only candidate birthplace may use the matching personal-file value for output; an existing nonblank candidate value retains priority. Read-only fallback does not write to the candidate. Preserve existing compatibility for legacy inputs without candidate_id.
Reference: tests/crm-case-assistant.cjs, “birthplace fallback belongs to candidate and agrees across report readiness and model”.
