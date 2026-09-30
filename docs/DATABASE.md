# TRORECRUITER — База даних

## Підтверджені таблиці, які використовує код

### `candidates`
Основна картка кандидата. `documents.js` та AI extraction працюють з `candidate_id`.

### `personal_files`
Особова справа кандидата. AI extraction може доповнювати її через `candidate_id`.

### `documents`
Реєстр завантажених документів кандидата. `getCandidateDocuments(id)` читає записи за `candidate_id`.

Підтверджені поля, які використовуються кодом:
- `id`
- `candidate_id`
- `requirement_id`
- `document_type`
- `verification_status`
- `processing_status`
- `file_name`
- `file_size`
- `ai_document_type`
- `ai_confidence`
- `created_at`

### `document_requirements`
Довідник комплекту документів. Використовуються поля:
- `id`
- `document_type`
- `active`
- `sort_order`
- `is_required`
- `condition_note`

## Що ще треба підтвердити
- повний DDL таблиць;
- RLS policies;
- точні типи полів;
- foreign keys;
- точні Storage policies.

Ці речі не вигадуємо — їх треба зчитати безпосередньо з Supabase перед змінами схеми.
