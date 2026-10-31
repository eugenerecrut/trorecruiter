-- Update crm_portal_get_case to return unit_phone, center_recruiter_phone, correct document requirements filter and document type aliases
ALTER TABLE public.crm_staff ADD COLUMN IF NOT EXISTS phone TEXT;

-- Seed default center recruiter phone if null
UPDATE public.crm_staff 
SET phone = '+380687661109' 
WHERE phone IS NULL AND active = true;

CREATE OR REPLACE FUNCTION public.crm_portal_get_case(
    p_token UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_cand RECORD;
    v_reqs JSONB;
    v_docs JSONB;
    v_total INT := 0;
    v_uploaded INT := 0;
    v_verified INT := 0;
    v_service_type TEXT;
    v_has_children BOOLEAN;
    v_served_before BOOLEAN;
    v_worked_before BOOLEAN;
    v_marital TEXT;
    v_sex TEXT;
    v_staff_name TEXT;
    v_staff_phone TEXT;
    v_unit_phone TEXT;
    v_center_phone TEXT;
BEGIN
    SELECT * INTO v_cand
    FROM public.candidates
    WHERE portal_token = p_token;

    IF v_cand.id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Кабінет не знайдено або посилання застаріло');
    END IF;

    v_service_type := COALESCE(
        v_cand.profile_data->>'service_type',
        v_cand.profile_data->'service'->>'service_type',
        'За контрактом'
    );
    
    v_has_children := COALESCE(
        v_cand.has_children,
        CASE WHEN v_cand.profile_data->>'has_children' IN ('true', 't', '1', 'yes') THEN true ELSE false END,
        false
    );

    v_served_before := COALESCE(
        v_cand.served_before,
        CASE WHEN v_cand.profile_data->>'served_before' IN ('true', 't', '1', 'yes') THEN true ELSE false END,
        false
    );

    v_worked_before := COALESCE(
        v_cand.worked_before,
        CASE WHEN v_cand.profile_data->>'worked_before' IN ('true', 't', '1', 'yes') THEN true ELSE false END,
        false
    );

    v_marital := LOWER(COALESCE(v_cand.marital_status, v_cand.profile_data->>'marital_status', ''));
    v_sex := LOWER(COALESCE(v_cand.sex, v_cand.profile_data->>'sex', ''));

    IF v_cand.responsible_recruiter_id IS NOT NULL THEN
        SELECT s.display_name, s.phone INTO v_staff_name, v_staff_phone
        FROM public.crm_staff s
        WHERE s.user_id = v_cand.responsible_recruiter_id;
    END IF;

    v_unit_phone := COALESCE(
        v_cand.profile_data->>'unit_phone',
        v_cand.profile_data->>'recommender_phone',
        v_cand.profile_data->>'contact_phone',
        v_cand.profile_data->>'recruiter_phone',
        ''
    );

    v_center_phone := COALESCE(
        v_staff_phone,
        v_cand.profile_data->>'center_recruiter_phone',
        '+380687661109'
    );

    -- Calculate stats
    SELECT
        COUNT(*),
        COUNT(*) FILTER (WHERE doc.id IS NOT NULL),
        COUNT(*) FILTER (WHERE doc.verification_status = 'Підтверджено')
    INTO v_total, v_uploaded, v_verified
    FROM public.document_requirements dr
    LEFT JOIN LATERAL (
        SELECT d.id, d.verification_status
        FROM public.documents d
        WHERE d.candidate_id = v_cand.id
          AND d.deleted_at IS NULL
          AND (
              d.requirement_id = dr.id 
              OR d.document_type = dr.document_type
              OR (dr.document_type = 'Копія паспорта/ID Картки' AND d.document_type IN ('Українська ID-картка', 'Паспорт', 'Копія паспорта/ID Картки'))
              OR (dr.document_type = 'Свідоцтво про народження' AND d.document_type IN ('Актовий запис про народження', 'Свідоцтво про народження'))
              OR (dr.document_type = 'Копія диплома та атестата з додатками' AND d.document_type IN ('Документи про освіту', 'Диплом', 'Атестат', 'Копія диплома та атестата з додатками'))
              OR (dr.document_type = 'Копія рекомендаційного листа' AND d.document_type IN ('Рекомендаційний лист', 'Копія рекомендаційного листа'))
              OR (dr.document_type = 'Копія ідентифікаційного коду' AND d.document_type IN ('ІПН', 'РНОКПП', 'Ідентифікаційний код', 'Копія ідентифікаційного коду'))
          )
        ORDER BY d.created_at DESC
        LIMIT 1
    ) doc ON true
    WHERE dr.active = true
      AND (dr.applies_to IS NULL OR dr.applies_to IN ('all', 'both')
           OR (dr.applies_to = 'contract' AND v_service_type ILIKE '%контракт%')
           OR (dr.applies_to = 'mobilization' AND v_service_type ILIKE '%мобіліз%'))
      AND (
          dr.document_type NOT IN (
              'Додаток 13',
              'Додаток 13 (Картка обстеження та медичного огляду)',
              'Довідка ВЛК',
              'Сертифікат психологічного тестування',
              'Сертифікат психологічного тестування (перша сторінка)',
              'Картка соціально-психологічного вивчення',
              'Титульний аркуш',
              'Послужний список',
              'Перелік документів',
              'Наказ про зарахування до ВЧ',
              'Припис про направлення',
              'Реєстр кандидата',
              'Характеристика'
          )
      )
      AND (
          dr.document_type NOT IN (
              'Заява на контракт',
              'Згода на обробку даних',
              'Згода на обробку персональних даних',
              'Згода на збір та обробку даних',
              'Згода на обробку даних для психологічного тестування',
              'Розписка кандидата на військову службу за контрактом',
              'Розписка кандидата'
          )
          OR doc.id IS NOT NULL
          OR (
              v_cand.profile_data->'blanks_sent' IS NOT NULL
              AND (
                  (v_cand.profile_data->'blanks_sent'->>dr.document_type) IN ('true', 't', '1')
                  OR (dr.document_type = 'Заява на контракт' AND (v_cand.profile_data->'blanks_sent'->>'contract_application') IN ('true', 't', '1'))
                  OR (dr.document_type LIKE 'Згода на обробку даних%' AND (v_cand.profile_data->'blanks_sent'->>'data_consent') IN ('true', 't', '1'))
                  OR (dr.document_type LIKE 'Розписка%' AND (v_cand.profile_data->'blanks_sent'->>'receipt') IN ('true', 't', '1'))
              )
          )
      )
      AND (
          dr.condition_field IS NULL
          OR dr.condition_field = ''
          OR (
              (dr.condition_field = 'served_before' AND (
                  (v_served_before = true AND dr.condition_value = 'true')
                  OR (v_served_before = false AND dr.condition_value = 'false')
              ))
              OR (dr.condition_field = 'worked_before' AND (
                  (v_worked_before = true AND dr.condition_value = 'true')
                  OR (v_worked_before = false AND dr.condition_value = 'false')
              ))
              OR (dr.condition_field = 'has_children' AND (
                  (v_has_children = true AND dr.condition_value = 'true')
              ))
              OR (dr.condition_field = 'marital_status' AND (
                  (dr.condition_value = 'married' AND (v_marital LIKE '%одруж%' OR v_marital = 'married'))
                  OR (dr.condition_value = 'divorced' AND (v_marital LIKE '%розлуч%' OR v_marital = 'divorced'))
              ))
              OR (dr.condition_field = 'sex' AND dr.condition_value = v_sex)
          )
      );

    -- Build checklist items
    SELECT jsonb_agg(item ORDER BY (item->>'sort_order')::int, item->>'document_type')
    INTO v_reqs
    FROM (
        SELECT jsonb_build_object(
            'requirement_id', dr.id,
            'document_type', dr.document_type,
            'is_required', dr.is_required,
            'condition_note', dr.condition_note,
            'sort_order', dr.sort_order,
            'has_document', doc.id IS NOT NULL,
            'document_id', doc.id,
            'file_name', doc.file_name,
            'status', doc.verification_status,
            'uploaded_at', doc.created_at,
            'is_template_blank', (dr.document_type IN (
                'Заява на контракт',
                'Згода на обробку даних',
                'Згода на обробку персональних даних',
                'Згода на збір та обробку даних',
                'Згода на обробку даних для психологічного тестування',
                'Розписка кандидата на військову службу за контрактом',
                'Розписка кандидата'
            )),
            'template_url', CASE 
                WHEN dr.document_type = 'Заява на контракт' THEN 'https://vhfysipxorlhuiaatxqi.supabase.co/storage/v1/object/public/templates/zayava_kontrakt.pdf'
                WHEN dr.document_type LIKE 'Згода на обробку даних%' THEN 'https://vhfysipxorlhuiaatxqi.supabase.co/storage/v1/object/public/templates/zgoda_dani.pdf'
                WHEN dr.document_type LIKE 'Розписка%' THEN 'https://vhfysipxorlhuiaatxqi.supabase.co/storage/v1/object/public/templates/rozpyska_kontrakt.pdf'
                ELSE NULL
            END
        ) AS item
        FROM public.document_requirements dr
        LEFT JOIN LATERAL (
            SELECT d.id, d.file_name, d.verification_status, d.created_at
            FROM public.documents d
            WHERE d.candidate_id = v_cand.id
              AND d.deleted_at IS NULL
              AND (
                  d.requirement_id = dr.id 
                  OR d.document_type = dr.document_type
                  OR (dr.document_type = 'Копія паспорта/ID Картки' AND d.document_type IN ('Українська ID-картка', 'Паспорт', 'Копія паспорта/ID Картки'))
                  OR (dr.document_type = 'Свідоцтво про народження' AND d.document_type IN ('Актовий запис про народження', 'Свідоцтво про народження'))
                  OR (dr.document_type = 'Копія диплома та атестата з додатками' AND d.document_type IN ('Документи про освіту', 'Диплом', 'Атестат', 'Копія диплома та атестата з додатками'))
                  OR (dr.document_type = 'Копія рекомендаційного листа' AND d.document_type IN ('Рекомендаційний лист', 'Копія рекомендаційного листа'))
                  OR (dr.document_type = 'Копія ідентифікаційного коду' AND d.document_type IN ('ІПН', 'РНОКПП', 'Ідентифікаційний код', 'Копія ідентифікаційного коду'))
              )
            ORDER BY d.created_at DESC
            LIMIT 1
        ) doc ON true
        WHERE dr.active = true
          AND (dr.applies_to IS NULL OR dr.applies_to IN ('all', 'both')
               OR (dr.applies_to = 'contract' AND v_service_type ILIKE '%контракт%')
               OR (dr.applies_to = 'mobilization' AND v_service_type ILIKE '%мобіліз%'))
          AND (
              dr.document_type NOT IN (
                  'Додаток 13',
                  'Додаток 13 (Картка обстеження та медичного огляду)',
                  'Довідка ВЛК',
                  'Сертифікат психологічного тестування',
                  'Сертифікат психологічного тестування (перша сторінка)',
                  'Картка соціально-психологічного вивчення',
                  'Титульний аркуш',
                  'Послужний список',
                  'Перелік документів',
                  'Наказ про зарахування до ВЧ',
                  'Припис про направлення',
                  'Реєстр кандидата',
                  'Характеристика'
              )
          )
          AND (
              dr.document_type NOT IN (
                  'Заява на контракт',
                  'Згода на обробку даних',
                  'Згода на обробку персональних даних',
                  'Згода на збір та обробку даних',
                  'Згода на обробку даних для психологічного тестування',
                  'Розписка кандидата на військову службу за контрактом',
                  'Розписка кандидата'
              )
              OR doc.id IS NOT NULL
              OR (
                  v_cand.profile_data->'blanks_sent' IS NOT NULL
                  AND (
                      (v_cand.profile_data->'blanks_sent'->>dr.document_type) IN ('true', 't', '1')
                      OR (dr.document_type = 'Заява на контракт' AND (v_cand.profile_data->'blanks_sent'->>'contract_application') IN ('true', 't', '1'))
                      OR (dr.document_type LIKE 'Згода на обробку даних%' AND (v_cand.profile_data->'blanks_sent'->>'data_consent') IN ('true', 't', '1'))
                      OR (dr.document_type LIKE 'Розписка%' AND (v_cand.profile_data->'blanks_sent'->>'receipt') IN ('true', 't', '1'))
                  )
              )
          )
          AND (
              dr.condition_field IS NULL
              OR dr.condition_field = ''
              OR (
                  (dr.condition_field = 'served_before' AND (
                      (v_served_before = true AND dr.condition_value = 'true')
                      OR (v_served_before = false AND dr.condition_value = 'false')
                  ))
                  OR (dr.condition_field = 'worked_before' AND (
                      (v_worked_before = true AND dr.condition_value = 'true')
                      OR (v_worked_before = false AND dr.condition_value = 'false')
                  ))
                  OR (dr.condition_field = 'has_children' AND (
                      (v_has_children = true AND dr.condition_value = 'true')
                  ))
                  OR (dr.condition_field = 'marital_status' AND (
                      (dr.condition_value = 'married' AND (v_marital LIKE '%одруж%' OR v_marital = 'married'))
                      OR (dr.condition_value = 'divorced' AND (v_marital LIKE '%розлуч%' OR v_marital = 'divorced'))
                  ))
                  OR (dr.condition_field = 'sex' AND dr.condition_value = v_sex)
              )
          )
    ) q;

    -- Build all documents list
    SELECT jsonb_agg(to_jsonb(doc_item))
    INTO v_docs
    FROM (
        SELECT id, document_type, file_name, mime_type, verification_status AS status, created_at
        FROM public.documents
        WHERE candidate_id = v_cand.id AND deleted_at IS NULL
        ORDER BY created_at DESC
    ) doc_item;

    RETURN jsonb_build_object(
        'success', true,
        'candidate', jsonb_build_object(
            'id', v_cand.id,
            'name', COALESCE(v_cand.name_nominative, v_cand.full_name),
            'full_name', v_cand.full_name,
            'phone', v_cand.phone,
            'desired_position', COALESCE(v_cand.desired_position, 'Узгоджується'),
            'military_unit', COALESCE(v_cand.profile_data->>'military_unit', v_cand.profile_data->>'desired_unit', 'Військова частина'),
            'unit_representative', COALESCE(v_cand.profile_data->>'recruiter_name', v_cand.profile_data->>'signatory', 'Представник частини за РЛ'),
            'unit_signatory', v_cand.profile_data->>'signatory',
            'unit_phone', v_unit_phone,
            'center_recruiter_name', COALESCE(v_staff_name, 'Рекрутер 4 Центру'),
            'center_recruiter_phone', v_center_phone,
            'recruiter_name', COALESCE(v_staff_name, v_cand.profile_data->>'recruiter_name', 'Рекрутер 4 Центру'),
            'recruiter_phone', v_center_phone,
            'stage', COALESCE(v_cand.recruitment_status, 'Збір документів'),
            'service_type', v_service_type,
            'case_mode', COALESCE(v_cand.profile_data->>'case_mode', 'full')
        ),
        'checklist', COALESCE(v_reqs, '[]'::jsonb),
        'all_documents', COALESCE(v_docs, '[]'::jsonb),
        'stats', jsonb_build_object(
            'total', v_total,
            'uploaded', v_uploaded,
            'verified', v_verified,
            'percent', CASE WHEN v_total > 0 THEN ROUND((v_uploaded::numeric / v_total::numeric) * 100) ELSE 0 END
        )
    );
END;
$$;
