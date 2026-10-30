-- Migration: candidate_portal
ALTER TABLE public.candidates ADD COLUMN IF NOT EXISTS portal_token UUID DEFAULT gen_random_uuid() UNIQUE;
CREATE INDEX IF NOT EXISTS idx_candidates_portal_token ON public.candidates(portal_token);

UPDATE public.candidates SET portal_token = gen_random_uuid() WHERE portal_token IS NULL;

CREATE OR REPLACE FUNCTION public.crm_portal_get_case(p_token UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, crm_private
AS $$
DECLARE
    v_cand RECORD;
    v_reqs JSONB;
    v_docs JSONB;
    v_total INT := 0;
    v_uploaded INT := 0;
    v_verified INT := 0;
    v_service_type TEXT;
    v_is_mob BOOLEAN;
    v_is_unit BOOLEAN;
    v_marital TEXT;
BEGIN
    IF p_token IS NULL THEN
        RETURN jsonb_build_object('error', 'Token is required');
    END IF;

    SELECT id, full_name, name_nominative, phone, desired_position,
           recruitment_status, sex, marital_status, has_children, children_count,
           worked_before, served_before, profile_data, created_at, updated_at
    INTO v_cand
    FROM public.candidates
    WHERE portal_token = p_token;

    IF v_cand.id IS NULL THEN
        RETURN jsonb_build_object('error', 'Справу за цим посиланням не знайдено');
    END IF;

    v_service_type := COALESCE(v_cand.profile_data->>'service_type', 'За контрактом');
    v_is_mob := (v_service_type ILIKE '%мобілізац%');
    v_is_unit := (COALESCE(v_cand.profile_data->>'case_mode', '') = 'unit');
    v_marital := LOWER(COALESCE(v_cand.marital_status, ''));

    SELECT 
        jsonb_agg(to_jsonb(r_item)), 
        COUNT(*), 
        COUNT(CASE WHEN r_item.has_document = true THEN 1 END), 
        COUNT(CASE WHEN r_item.status IN ('Підтверджено', 'verified') THEN 1 END)
    INTO v_reqs, v_total, v_uploaded, v_verified
    FROM (
        SELECT 
            dr.id AS requirement_id,
            dr.document_type,
            COALESCE(dr.is_required, true) AS is_required,
            dr.condition_note,
            dr.sort_order,
            CASE WHEN d.id IS NOT NULL THEN true ELSE false END AS has_document,
            d.id AS document_id,
            d.file_name,
            d.mime_type,
            COALESCE(d.verification_status, 'unverified') AS status,
            d.created_at AS uploaded_at
        FROM public.document_requirements dr
        LEFT JOIN LATERAL (
            SELECT id, file_name, mime_type, verification_status, created_at
            FROM public.documents doc
            WHERE doc.candidate_id = v_cand.id
              AND doc.deleted_at IS NULL
              AND (doc.requirement_id = dr.id OR doc.document_type = dr.document_type)
            ORDER BY doc.created_at DESC
            LIMIT 1
        ) d ON true
        WHERE dr.active = true
          AND dr.document_type NOT IN (
              'Припис про направлення',
              'Реєстр кандидата',
              'Послужний список',
              'Перелік документів',
              'Титульний аркуш',
              'Наказ про зарахування до ВЧ',
              'Характеристика'
          )
          AND (
              -- Case mode unit: only recommendation letter
              (v_is_unit AND dr.document_type ILIKE '%рекомендаційн%')
              OR
              -- Full case mode:
              (NOT v_is_unit AND (
                  -- MOBILIZATION:
                  (v_is_mob AND (
                      dr.document_type ~* 'паспорт|ідентифікаційн|Фото |довідка ВЛК|додаток 13|групи крові|місце проживання|довідка з МВС|сертифікат психологічного|диплом|рекомендаційн|довідка з банку'
                      OR (dr.document_type ~* 'гінеколог' AND v_cand.sex = 'female')
                      OR (dr.document_type ~* 'трудов' AND COALESCE(v_cand.worked_before, true) = true)
                      OR (dr.document_type ~* 'військов.*квит' AND v_cand.served_before = true)
                      OR (dr.document_type ~* 'резерв\+|приписн|військовий облік' AND COALESCE(v_cand.served_before, false) = false)
                      OR (dr.document_type ~* 'УБД' AND v_cand.served_before = true)
                  ))
                  OR
                  -- CONTRACT:
                  (NOT v_is_mob AND (
                      dr.document_type NOT ILIKE '%гінеколог%'
                      AND (
                          (dr.condition_field IS NULL AND COALESCE(dr.is_required, true) = true)
                          OR (dr.condition_field = 'worked_before' AND COALESCE(v_cand.worked_before, true) = (dr.condition_value = 'true'))
                          OR (dr.condition_field = 'served_before' AND (
                              (v_cand.served_before IS NULL AND dr.condition_value = 'false')
                              OR (v_cand.served_before = true AND dr.condition_value = 'true')
                              OR (v_cand.served_before = false AND dr.condition_value = 'false')
                          ))
                          OR (dr.condition_field = 'has_children' AND (
                              (v_cand.has_children = true AND dr.condition_value = 'true')
                          ))
                          OR (dr.condition_field = 'marital_status' AND (
                              (dr.condition_value = 'married' AND (v_marital LIKE '%одруж%' OR v_marital = 'married'))
                              OR (dr.condition_value = 'divorced' AND (v_marital LIKE '%розлуч%' OR v_marital = 'divorced'))
                          ))
                      )
                  ))
              ))
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
            'recruiter_name', COALESCE(v_cand.profile_data->>'recruiter_name', 'Черговий рекрутер'),
            'recruiter_phone', v_cand.profile_data->>'recruiter_phone',
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

CREATE OR REPLACE FUNCTION public.crm_portal_submit_document(
    p_token UUID,
    p_document_type TEXT,
    p_file_name TEXT,
    p_file_size BIGINT,
    p_mime_type TEXT,
    p_storage_path TEXT,
    p_requirement_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, crm_private
AS $$
DECLARE
    v_cand_id UUID;
    v_doc_id UUID;
BEGIN
    IF p_token IS NULL THEN
        RETURN jsonb_build_object('error', 'Token is required');
    END IF;

    SELECT id INTO v_cand_id
    FROM public.candidates
    WHERE portal_token = p_token;

    IF v_cand_id IS NULL THEN
        RETURN jsonb_build_object('error', 'Недійсне або застаріле посилання на кабінет');
    END IF;

    INSERT INTO public.documents (
        candidate_id,
        requirement_id,
        document_type,
        document_name,
        file_name,
        file_size,
        mime_type,
        storage_path,
        status,
        verification_status,
        notes
    ) VALUES (
        v_cand_id,
        p_requirement_id,
        COALESCE(p_document_type, 'Документ кандидата'),
        COALESCE(p_file_name, 'Документ з кабінету кандидата'),
        p_file_name,
        p_file_size,
        COALESCE(p_mime_type, 'application/pdf'),
        p_storage_path,
        'active',
        'unverified',
        'Завантажено кандидатом через особистий кабінет'
    )
    RETURNING id INTO v_doc_id;

    BEGIN
        INSERT INTO public.crm_activity (
            candidate_id,
            action,
            entity_type,
            entity_id,
            details
        ) VALUES (
            v_cand_id,
            'portal_upload',
            'document',
            v_doc_id,
            jsonb_build_object('file_name', p_file_name, 'document_type', p_document_type, 'source', 'candidate_portal')
        );
    EXCEPTION WHEN OTHERS THEN
        NULL;
    END;

    RETURN jsonb_build_object(
        'success', true,
        'document_id', v_doc_id
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.crm_portal_get_case(UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_portal_submit_document(UUID, TEXT, TEXT, BIGINT, TEXT, TEXT, UUID) TO anon, authenticated;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'Portal candidate can upload own files'
    ) THEN
        CREATE POLICY "Portal candidate can upload own files"
            ON storage.objects FOR INSERT
            TO anon, authenticated
            WITH CHECK (bucket_id = 'candidate-documents');
    END IF;
END $$;
