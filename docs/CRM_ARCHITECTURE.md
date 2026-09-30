# TRORECRUITER — Архітектура CRM

## Джерело правди
- Код: GitHub repository `eugenerecrut/trorecruiter`, branch `main`.
- Дані та файли: Supabase project ref `vhfysipxorlhuiaatxqi`.
- Цей каталог описує підтверджений стан системи та рішення проекту.

## Поточна структура
- Frontend: статичний вебінтерфейс на `index.html` + JavaScript-модулі.
- Supabase JS v2 підключений у `index.html`.
- Основна логіка CRM знаходиться в `script.js`.
- Робота з документами — `documents.js`.
- Додаткові модулі: `document-upload-fix.js`, `document-guard.js`, `document-type-field.js`, `ocr-local-only.js`, `ai-retry.js`, `candidate-card-v2.js` тощо.
- Є локальний scanner agent та окрема сторінка `scanner-settings.html`.

## Документи
`documents.js` працює з bucket `candidate-documents`, таблицями `documents` і `document_requirements`, а також Edge Function `ai-classify-document`.

## Важливе правило
Не створювати паралельне сховище документів у `localStorage`. Для робочих документів використовувати існуючий Supabase Storage + БД.

## Поточна незавершена задача
Повністю зв'язати завантаження документа, OCR, запис у `documents`, статуси обробки/перевірки та прив'язку до кандидата в один стабільний цикл.
