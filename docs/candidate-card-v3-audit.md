# Candidate Card V3 — аудит і сумісність

## Рішення

V3 — окремий модуль представлення над чинною формою V2. V2 залишається типовою.
Кнопка «Спробувати V3» запам’ятовує вибір лише в цьому браузері; «Повернути V2» відновлює її.
Форма, імена полів, делеговані обробники й optimistic concurrency залишаються спільними.
Точка розширення V2: опційний getter education_records для редактора записів V3;
він додає записи в існуючий profile_data під час того самого збереження. У V2 getter відсутній.
Стан форми також надає вже завантажені candidate/documents для V3: повторних запитів цих таблиць немає.
Схема, RLS, Edge Functions і AI merge не змінюються.

## Залежності

candidate-conditions: діти, служба, робота, режим ВЧ, мобілізація.
candidate-name / candidate-phone: нормалізація. CRMResponsibility: рекрутер, історія, версії документів.
CRMWorkspace: захист незбережених даних, фото, навігація. CRMWorkflow: етап і пауза, планування.
documents.js: завантаження, AI, підтвердження й перенесення даних. V3 відкриває його без нового pipeline.
ai-recommendation-bridge впізнає candidateCardV2 і ccRelatives; ідентифікатори збережено.

## Дублювання і щільність

ПІБ у відмінках не дублює основне поле: родовий перенесено в «Додатково».
passport_data — legacy повний запис поряд зі структурованими полями; у «Додатково».
education / work_history — legacy текст, education_records / work_records — структуровані записи.
Збережено обидва, щоб друк і попередні документи залишалися сумісними.
recruiter_name — хто прийняв кандидата, а responsible_recruiter_id — поточний відповідальний;
це різні дані. Перше в додаткових, друге в шапці зі штатними правами.
military_unit — поле служби; recommender_unit використовується як fallback у шапці.
Реквізити наказів, код роботодавця, серії/номери освітніх документів, Оберіг/відстрочка — ADVANCED.
source_document_id, джерельні сторінки, AI JSON — SYSTEM, у details/документах.
Родичі й періоди роботи згорнуті; збереження індексів і прихованих значень перевіряється.
✦ в основних полях тільки за останньою реальною зміною з source_document_id, зі звіркою значення.
Ручна зміна знімає позначку. Співпадіння з AI JSON саме по собі не доводить походження.

## Повний інвентар полів V2

PRIMARY — звичайні відомості; CONDITIONAL — видимість за чинними умовами V2;
ADVANCED — за кнопкою «Додатково». Жодного поля не вилучено зі збереження.

| Поле | Назва V2 | Категорія V3 |
|---|---|---|
| `relationship` | Ступінь споріднення | PRIMARY |
| `full_name` | ПІБ | PRIMARY |
| `birth_date` | Дата народження | PRIMARY |
| `deceased` | Стан родича | PRIMARY |
| `death_date` | Дата смерті: рік, рік-місяць або повна дата | CONDITIONAL |
| `birth_place` | Місце народження | PRIMARY |
| `citizenship` | Громадянство | PRIMARY |
| `address` | Місце проживання | PRIMARY |
| `phone` | Телефон | PRIMARY |
| `workplace` | Місце роботи | PRIMARY |
| `position` | Посада | PRIMARY |
| `notes` | Примітки | PRIMARY |
| `name_nominative` | ПІБ у називному відмінку | PRIMARY |
| `name_genitive` | ПІБ у родовому відмінку | ADVANCED |
| `sex` | Стать | PRIMARY |
| `rnokpp` | РНОКПП | PRIMARY |
| `unzr` | УНЗР | ADVANCED |
| `birth_certificate` | Серія та № свідоцтва про народження | ADVANCED |
| `marital_status` | Сімейний стан | PRIMARY |
| `has_children` | Діти | PRIMARY |
| `children_count` | Кількість дітей | CONDITIONAL |
| `children_info` | Інформація про дітей | CONDITIONAL |
| `identity_document_type` | Тип документа | PRIMARY |
| `passport_series` | Серія | CONDITIONAL |
| `passport_number` | Номер | PRIMARY |
| `passport_issuer` | Ким виданий | PRIMARY |
| `passport_issue_date` | Дата видачі | PRIMARY |
| `passport_expiry_date` | Строк дії | CONDITIONAL |
| `passport_data` | Паспортні дані (повний запис) | ADVANCED |
| `phone_secondary` | Додатковий телефон | ADVANCED |
| `email` | Email | ADVANCED |
| `messenger` | Telegram / Viber | ADVANCED |
| `registered_address` | Зареєстроване місце проживання | PRIMARY |
| `education_level` | Рівень освіти | PRIMARY |
| `education_institution` | Заклад освіти | PRIMARY |
| `education_specialty` | Спеціальність | CONDITIONAL |
| `education_qualification` | Кваліфікація | CONDITIONAL |
| `education_year` | Рік закінчення | PRIMARY |
| `education_specialty_code` | Код спеціальності | ADVANCED |
| `education_start_date` | Початок навчання | ADVANCED |
| `education_end_date` | Завершення навчання | ADVANCED |
| `education_diploma_series` | Серія диплома | ADVANCED |
| `education_diploma_number` | Номер диплома | ADVANCED |
| `education_diploma_issue_date` | Дата видачі диплома | ADVANCED |
| `education_supplement_number` | Номер додатка | ADVANCED |
| `education_supplement_issue_date` | Дата видачі додатка | ADVANCED |
| `education` | Деталі освіти | ADVANCED |
| `worked_before` | Працював / Працювала | PRIMARY |
| `civilian_profession` | Цивільна професія | PRIMARY |
| `work_history` | Трудова діяльність | CONDITIONAL |
| `served_before` | Служив / Служила | PRIMARY |
| `military_unit` | Військова частина | CONDITIONAL |
| `military_position` | Посада | CONDITIONAL |
| `service_start_date` | Дата початку служби | CONDITIONAL |
| `service_end_date` | Дата закінчення служби | CONDITIONAL |
| `combat_days` | Кількість днів бойових | CONDITIONAL |
| `military_service_history` | Військова служба | CONDITIONAL |
| `military_rank` | Військове звання | PRIMARY |
| `military_specialty` | ВОС | PRIMARY |
| `tcc` | ТЦК та СП | PRIMARY |
| `military_document_number` | Номер військово-облікового документа | PRIMARY |
| `military_registry_number` | Номер у реєстрі Оберіг | ADVANCED |
| `military_document_expiry_date` | Витяг Резерв+ дійсний до | ADVANCED |
| `military_data_updated_at` | Дата уточнення даних | ADVANCED |
| `military_deferment_type` | Тип відстрочки | ADVANCED |
| `military_deferment_until` | Відстрочка до | ADVANCED |
| `military_registration_removal_reason` | Підстава зняття / виключення | ADVANCED |
| `military_training_status` | Військова підготовка | ADVANCED |
| `military_registration_date` | Дата взяття на облік | ADVANCED |
| `military_registration_category` | Категорія обліку | ADVANCED |
| `military_registration_status` | Стан обліку | ADVANCED |
| `military_document_type` | Військовий документ | PRIMARY |
| `blood_data_in_passport` | Група крові та резус зазначені в паспорті | PRIMARY |
| `vlk_certificate_number` | Номер довідки ВЛК | PRIMARY |
| `vlk_date` | Дата проходження ВЛК | PRIMARY |
| `vlk_commission` | Комісія / установа ВЛК | PRIMARY |
| `vlk_conclusion` | Висновок | PRIMARY |
| `vlk_category` | Категорія придатності | PRIMARY |
| `vlk_next_date` | Дата наступного огляду | PRIMARY |
| `vlk_status` | Статус ВЛК | PRIMARY |
| `vlk_notes` | Примітки ВЛК | PRIMARY |
| `candidate_source` | Джерело кандидата | ADVANCED |
| `recruiter_name` | Хто прийняв кандидата | ADVANCED |
| `desired_unit` | Напрям | PRIMARY |
| `desired_position` | Бажана посада | PRIMARY |
| `motivation` | Мотивація кандидата | PRIMARY |
| `recruitment_notes` | Додаткова інформація | ADVANCED |
| `criminal_record_info` | Відомості про судимість | PRIMARY |
| `psychiatric_record_info` | Відомості про психіатричний облік | ADVANCED |
| `has_management_experience` | Займав / займала керівну посаду | PRIMARY |
| `organizational_skills` | Організаторські здібності | CONDITIONAL |
| `contract_type` | Вид контракту | CONDITIONAL |
| `contract_date` | Дата підписання | CONDITIONAL |
| `contract_term_months` | Строк, місяців | CONDITIONAL |
| `contract_status` | Статус оформлення | CONDITIONAL |
| `contract_notes` | Примітки щодо контракту | CONDITIONAL |
| `work_kind` | Тип періоду | PRIMARY |
| `work_employer` | Роботодавець / організація | PRIMARY |
| `work_employer_code` | Код роботодавця | ADVANCED |
| `work_position` | Посада на початку періоду | PRIMARY |
| `work_start_date` | Початок | PRIMARY |
| `work_end_date` | Завершення | PRIMARY |
| `work_termination_reason` | Причина завершення | ADVANCED |
| `work_order_number` | Наказ про початок: номер | ADVANCED |
| `work_order_date` | Дата наказу про початок | ADVANCED |
| `work_end_order_number` | Наказ про завершення: номер | ADVANCED |
| `work_end_order_date` | Дата наказу про завершення | ADVANCED |
| `service_type` | Вид оформлення | PRIMARY |
| `case_mode` | Хто збирає документи | PRIMARY |
| `responsible_recruiter_id` | Відповідальний рекрутер | PRIMARY, штатне окреме збереження |

## Перевірки

`tests/crm-card-v3.cjs` — остання зміна поля, ручне редагування, вкладки, load order, спільне збереження.
`tests/candidate-card-v3-fixture.html` — ізольована картка з mock Supabase; реальні модулі V2,
умов, імені, телефону, історії, роботи, автобіографії та AI bridge.
Перевіряє відкриття, редагування, save/reopen, V2 fallback, родичів, дітей,
серію ID/паспорта, контракт/мобілізацію, середню освіту, AI source, документи,
режим ВЧ, цілісність прихованих полів, конфлікт concurrent update, JS errors.
Visual QA: desktop 1366×900, mobile 390×844; горизонтального виходу форми немає.
Живі справи не редагувалися тестами. Фактичний формат crm_activity прочитано через Supabase.
Журнал V3 завантажує останні 250 подій, показує 25; повний доступ — «Історія справи».
Старі поля без достовірного запису джерела не отримують вигаданої позначки AI.
