# Виправлення document pipeline — 2026-09-30

## Фактична причина, підтверджена логами Supabase

Після чистого тесту кандидата ПАВЛЕНКО Ростислав Сергійович кандидат створювався, але рекомендаційний лист не з'являвся в Storage та `documents`.

У `storage_logs` зафіксовано `storage.object.upload` з HTTP 400:
- `error.errorCode = InvalidKey`
- ресурс мав шлях `<candidate_id>/recommendation/..._РЕКОМЕНДАЦІИ_НИИ__ЛИСТ_Павленко.pdf`
- файл надходив із iPhone/Chrome.

Висновок: проблема була не в `documents` та не в RLS. Storage відхиляв ключ об'єкта через сформоване ім'я файла з кириличними символами.

## Додатково встановлено

`index.html` підключає `script.js`, `documents.js`, `name-cases.js`, `document-upload-fix.js`, але не підключав `document-type-field.js`.
Тому попередній V3 repair-guard фактично не виконувався у робочому сценарії.

## Внесене виправлення

Створено `recommendation-upload-fix.js`.

Він замінює `uploadRecommendation()` у робочому сценарії та:
1. бере фактичний файл із `#recommendationFile`;
2. формує ASCII-safe ім'я файла;
3. завантажує його в `candidate-documents/<candidate_id>/recommendation/`;
4. знаходить `requirement_id` для `Копія рекомендаційного листа`;
5. створює запис у `public.documents`;
6. виставляє `status = 'Завантажено'`;
7. виставляє `processing_status = 'Очікує AI'`;
8. виставляє `verification_status = 'Не перевірено'`;
9. при помилці INSERT видаляє вже завантажений файл, щоб не залишати сироту в Storage.

Підключення скрипта автоматизовано через `.github/workflows/connect-recommendation-upload-fix.yml`.

## Канонічний pipeline після виправлення

`рекомендаційний лист → ASCII-safe Storage key → Storage → documents → AI → перевірка рекрутером`

## Наступний тест

Після деплою потрібен один чистий тест:
- оновити CRM;
- створити нового кандидата;
- завантажити рекомендаційний лист;
- зберегти кандидата;
- перевірити Storage + `documents`.

Не видаляти тестового кандидата до перевірки результату.
