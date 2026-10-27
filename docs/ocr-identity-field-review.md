# Review a misread identity field

An active CRM worker can choose to keep an existing candidate name, birth date or tax number after inspecting the original. The action explicitly asks for confirmation that the original belongs to the candidate and that OCR misread this field.

This is one exact `keep_card` decision, not a document-wide identity override. It uses the existing authenticated `crm_keep_document_value` RPC with candidate timestamp and complete extraction guards. No new API, migration, permission, OCR call or candidate update is introduced. The original extraction, verification status and file remain unchanged; the decision includes actor, time and exact source snapshot.

Other conflicts remain visible. The planner and cross-document guards remain unchanged and do not authorize transfer based on this decision. A changed source or value reopens the question. Owner conflicts on non-identity fields and empty candidate values do not offer this action. Existing ordinary structured keep decisions remain available.

Local Qwen supplied synthetic scenario suggestions only. Its suggestions included fields outside this narrow scope; those were rejected. No candidate data was sent to Qwen.
