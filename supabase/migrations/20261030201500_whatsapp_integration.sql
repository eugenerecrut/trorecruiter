-- Migration: whatsapp_integration
CREATE TABLE IF NOT EXISTS public.whatsapp_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    candidate_id UUID REFERENCES public.candidates(id) ON DELETE SET NULL,
    phone TEXT NOT NULL,
    direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
    message_type TEXT NOT NULL DEFAULT 'text' CHECK (message_type IN ('text', 'image', 'document', 'audio', 'video', 'other')),
    content TEXT,
    media_url TEXT,
    media_storage_path TEXT,
    file_name TEXT,
    file_size BIGINT,
    mime_type TEXT,
    document_id UUID REFERENCES public.documents(id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'delivered' CHECK (status IN ('pending', 'sent', 'delivered', 'read', 'failed')),
    external_id TEXT,
    sender_name TEXT,
    raw_payload JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_candidate_id ON public.whatsapp_messages(candidate_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_phone ON public.whatsapp_messages(phone);
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_created_at ON public.whatsapp_messages(created_at DESC);

ALTER TABLE public.whatsapp_messages ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'whatsapp_messages' AND policyname = 'CRM staff can read whatsapp messages') THEN
        CREATE POLICY "CRM staff can read whatsapp messages"
            ON public.whatsapp_messages FOR SELECT
            TO authenticated
            USING (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'whatsapp_messages' AND policyname = 'CRM staff can insert whatsapp messages') THEN
        CREATE POLICY "CRM staff can insert whatsapp messages"
            ON public.whatsapp_messages FOR INSERT
            TO authenticated
            WITH CHECK (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'whatsapp_messages' AND policyname = 'CRM staff can update whatsapp messages') THEN
        CREATE POLICY "CRM staff can update whatsapp messages"
            ON public.whatsapp_messages FOR UPDATE
            TO authenticated
            USING (true)
            WITH CHECK (true);
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.whatsapp_settings (
    id TEXT PRIMARY KEY DEFAULT 'default',
    provider TEXT NOT NULL DEFAULT 'green_api',
    instance_id TEXT,
    api_token TEXT,
    webhook_secret TEXT,
    is_active BOOLEAN NOT NULL DEFAULT false,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.whatsapp_settings ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'whatsapp_settings' AND policyname = 'CRM staff can read whatsapp settings') THEN
        CREATE POLICY "CRM staff can read whatsapp settings"
            ON public.whatsapp_settings FOR SELECT
            TO authenticated
            USING (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'whatsapp_settings' AND policyname = 'CRM staff can manage whatsapp settings') THEN
        CREATE POLICY "CRM staff can manage whatsapp settings"
            ON public.whatsapp_settings FOR ALL
            TO authenticated
            USING (true)
            WITH CHECK (true);
    END IF;
END $$;

INSERT INTO public.whatsapp_settings (id, provider, is_active)
VALUES ('default', 'green_api', false)
ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.crm_receive_whatsapp_message(
    p_phone TEXT,
    p_content TEXT,
    p_message_type TEXT DEFAULT 'text',
    p_media_url TEXT DEFAULT NULL,
    p_file_name TEXT DEFAULT NULL,
    p_file_size BIGINT DEFAULT NULL,
    p_mime_type TEXT DEFAULT NULL,
    p_external_id TEXT DEFAULT NULL,
    p_sender_name TEXT DEFAULT NULL,
    p_raw JSONB DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, crm_private
AS $$
DECLARE
    v_clean_phone TEXT;
    v_candidate_id UUID;
    v_message_id UUID;
    v_document_id UUID := NULL;
    v_doc_type TEXT := 'Інший документ';
BEGIN
    v_clean_phone := regexp_replace(p_phone, '\D', '', 'g');
    IF length(v_clean_phone) = 10 AND v_clean_phone LIKE '0%' THEN
        v_clean_phone := '38' || v_clean_phone;
    END IF;

    SELECT id INTO v_candidate_id
    FROM public.candidates
    WHERE regexp_replace(phone, '\D', '', 'g') = v_clean_phone
       OR regexp_replace(COALESCE(profile_data->>'phone_secondary', ''), '\D', '', 'g') = v_clean_phone
    ORDER BY updated_at DESC
    LIMIT 1;

    IF v_candidate_id IS NOT NULL AND p_media_url IS NOT NULL AND p_media_url <> '' THEN
        IF p_message_type = 'image' THEN
            v_doc_type := 'Фото / скан (WhatsApp)';
        ELSIF p_message_type = 'document' THEN
            v_doc_type := 'Документ (WhatsApp)';
        END IF;

        INSERT INTO public.documents (
            candidate_id,
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
            v_candidate_id,
            v_doc_type,
            COALESCE(p_file_name, 'Документ з WhatsApp від ' || to_char(now(), 'DD.MM.YYYY HH24:MI')),
            COALESCE(p_file_name, 'whatsapp_' || to_char(now(), 'YYYYMMDD_HH24MISS') || CASE WHEN p_message_type = 'image' THEN '.jpg' ELSE '.pdf' END),
            COALESCE(p_file_size, 0),
            COALESCE(p_mime_type, CASE WHEN p_message_type = 'image' THEN 'image/jpeg' ELSE 'application/pdf' END),
            p_media_url,
            'active',
            'unverified',
            'Отримано автоматично через WhatsApp від ' || COALESCE(p_sender_name, p_phone)
        )
        RETURNING id INTO v_document_id;
    END IF;

    INSERT INTO public.whatsapp_messages (
        candidate_id,
        phone,
        direction,
        message_type,
        content,
        media_url,
        file_name,
        file_size,
        mime_type,
        document_id,
        status,
        external_id,
        sender_name,
        raw_payload
    ) VALUES (
        v_candidate_id,
        p_phone,
        'inbound',
        COALESCE(p_message_type, 'text'),
        p_content,
        p_media_url,
        p_file_name,
        p_file_size,
        p_mime_type,
        v_document_id,
        'delivered',
        p_external_id,
        p_sender_name,
        p_raw
    )
    RETURNING id INTO v_message_id;

    RETURN jsonb_build_object(
        'success', true,
        'message_id', v_message_id,
        'candidate_id', v_candidate_id,
        'document_id', v_document_id
    );
END;
$$;
