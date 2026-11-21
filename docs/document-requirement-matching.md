# Document requirement matching

The requirements view uses `CRMDocumentState.displayRows`: requirement rows first, followed only by current files whose exact document IDs are not already displayed. Semantic aliases no longer produce a second "additional document" row. Files with the same filename and different IDs remain separate; no storage or database deduplication occurs.

Birth records are matched by their scope before an explicit requirement binding or a title fallback. A candidate's own birth certificate, act record or extract can satisfy the candidate's birth requirement. It cannot satisfy a child's requirement. Explicit child qualifiers in any stored type hint prevent a candidate match even when another hint drops the qualifier. Untyped files with an explicit binding remain visible under their original requirement for review.

These are read-only presentation and completeness rules. They do not confirm files, change OCR, close review decisions, rewrite candidate fields, or enable additional processing. Real source discrepancies and unsupported transfer types remain reviewable.

Validation: `tests/crm-document-requirement-matching.cjs`, existing child-boundary and dashboard tests, and `tests/document-requirement-matching-fixture.html` with synthetic data only.
