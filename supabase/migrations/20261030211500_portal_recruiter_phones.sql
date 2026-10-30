-- Update crm_portal_get_case to return unit_phone and center_recruiter_phone
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
    v_marital TEXT;
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
    v_has_children := COALESCE(v_cand.has_children, (v_cand.profile_data->>'has_children')::boolean, false);
    v_marital := LOWER(COALESCE(v_cand.marital_status, v_cand.profile_data->>'marital_status', ''));

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
          AND (d.requirement_id = dr.id OR d.document_type = dr.document_type)
        ORDER BY d.created_at DESC
        LIMIT 1
    ) doc ON true
    WHERE dr.active = true
      AND (dr.applies_to IS NULL OR dr.applies_to = 'both'
           OR (dr.applies_to = 'contract' AND v_service_type ILIKE '%контракт%')
           OR (dr.applies_to = 'mobilization' AND v_service_type ILIKE '%мобіліз%'))
      AND (
          dr.document_type NOT IN (
              'Додаток 13',
              'Додаток 13 (Картка обстеження та медичного огляду)',
              'Довідка ВЛК',
              'Сертифікат психологічного тестування',
              'Сертифікат психологічного тестування (перша сторінка)',
              'Картка соціально-психологічного вивчення'
          )
      )
      AND (
          dr.document_type NOT IN (
              'Заява на контракт',
              'Згода на обробку персональних даних',
              'Згода на збір та обробку даних',
              'Згода на обробку даних для психологічного тестування',
              'Розписка кандидата на військову службу за контрактом',
              'Розписка кандидата'
          )
          OR (
              v_cand.profile_data->'blanks_sent' IS NOT NULL
              AND (
                  (v_cand.profile_data->'blanks_sent'->>dr.document_type)::boolean = true
                  OR (dr.document_type = 'Заява на контракт' AND (v_cand.profile_data->'blanks_sent'->>'contract_application')::boolean = true)
                  OR (dr.document_type LIKE 'Згода на обробку даних%' AND (v_cand.profile_data->'blanks_sent'->>'data_consent')::boolean = true)
                  OR (dr.document_type LIKE 'Розписка%' AND (v_cand.profile_data->'blanks_sent'->>'receipt')::boolean = true)
              )
          )
      )
      AND (
          dr.condition_field IS NULL
          OR dr.condition_field = ''
          OR (
              (dr.condition_field = 'served_before' AND (
                  (v_cand.served_before = true AND dr.condition_value = 'true')
                  OR ((v_cand.served_before = false OR v_cand.served_before IS NULL) AND dr.condition_value = 'false')
              ))
              OR (dr.condition_field = 'worked_before' AND (
                  (v_cand.worked_before = true AND dr.condition_value = 'true')
                  OR ((v_cand.worked_before = false OR v_cand.worked_before IS NULL) AND dr.condition_value = 'false')
              ))
              OR (dr.condition_field = 'has_children' AND (
                  (v_cand.has_children = true AND dr.condition_value = 'true')
              ))
              OR (dr.condition_field = 'marital_status' AND (
                  (dr.condition_value = 'married' AND (v_marital LIKE '%одруж%' OR v_marital = 'married'))
                  OR (dr.condition_value = 'divorced' AND (v_marital LIKE '%розлуч%' OR v_marital = 'divorced'))
              ))
          )
      );

    SELECT jsonb_agg(to_jsonb(r_item))
    INTO v_reqs
    FROM (
        SELECT
            dr.id AS requirement_id,
            dr.document_type,
            dr.condition_note,
            dr.is_required,
            dr.applies_to AS category,
            dr.sort_order,
            (doc.id IS NOT NULL) AS is_uploaded,
            doc.id AS document_id,
            doc.file_name,
            doc.verification_status,
            (doc.verification_status = 'Підтверджено') AS is_verified,
            doc.created_at AS uploaded_at
        FROM public.document_requirements dr
        LEFT JOIN LATERAL (
            SELECT d.id, d.file_name, d.verification_status, d.created_at
            FROM public.documents d
            WHERE d.candidate_id = v_cand.id
              AND d.deleted_at IS NULL
              AND (d.requirement_id = dr.id OR d.document_type = dr.document_type)
            ORDER BY d.created_at DESC
            LIMIT 1
        ) doc ON true
        WHERE dr.active = true
          AND (dr.applies_to IS NULL OR dr.applies_to = 'both'
               OR (dr.applies_to = 'contract' AND v_service_type ILIKE '%контракт%')
               OR (dr.applies_to = 'mobilization' AND v_service_type ILIKE '%мобіліз%'))
          AND (
              dr.document_type NOT IN (
                  'Додаток 13',
                  'Додаток 13 (Картка обстеження та медичного огляду)',
                  'Довідка ВЛК',
                  'Сертифікат психологічного тестування',
                  'Сертифікат психологічного тестування (перша сторінка)',
                  'Картка соціально-психологічного вивчення'
              )
          )
          AND (
              dr.document_type NOT IN (
                  'Заява на контракт',
                  'Згода на обробку персональних даних',
                  'Згода на збір та обробку даних',
                  'Згода на обробку даних для психологічного тестування',
                  'Розписка кандидата на військову службу за контрактом',
                  'Розписка кандидата'
              )
              OR (
                  v_cand.profile_data->'blanks_sent' IS NOT NULL
                  AND (
                      (v_cand.profile_data->'blanks_sent'->>dr.document_type)::boolean = true
                      OR (dr.document_type = 'Заява на контракт' AND (v_cand.profile_data->'blanks_sent'->>'contract_application')::boolean = true)
                      OR (dr.document_type LIKE 'Згода на обробку даних%' AND (v_cand.profile_data->'blanks_sent'->>'data_consent')::boolean = true)
                      OR (dr.document_type LIKE 'Розписка%' AND (v_cand.profile_data->'blanks_sent'->>'receipt')::boolean = true)
                  )
              )
          )
          AND (
              dr.condition_field IS NULL
              OR dr.condition_field = ''
              OR (
                  (dr.condition_field = 'served_before' AND (
                      (v_cand.served_before = true AND dr.condition_value = 'true')
                      OR ((v_cand.served_before = false OR v_cand.served_before IS NULL) AND dr.condition_value = 'false')
                  ))
                  OR (dr.condition_field = 'worked_before' AND (
                      (v_cand.worked_before = true AND dr.condition_value = 'true')
                      OR ((v_cand.worked_before = false OR v_cand.worked_before IS NULL) AND dr.condition_value = 'false')
                  ))
                  OR (dr.condition_field = 'has_children' AND (
                      (v_cand.has_children = true AND dr.condition_value = 'true')
                  ))
                  OR (dr.condition_field = 'marital_status' AND (
                      (dr.condition_value = 'married' AND (v_marital LIKE '%одруж%' OR v_marital = 'married'))
                      OR (dr.condition_value = 'divorced' AND (v_marital LIKE '%розлуч%' OR v_marital = 'divorced'))
                  ))
              )
          )
        ORDER BY dr.sort_order ASC, dr.document_type ASC
    ) r_item;

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
