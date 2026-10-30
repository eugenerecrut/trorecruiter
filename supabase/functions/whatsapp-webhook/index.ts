import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8';

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Content-Type': 'application/json'
};

const respond = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers });

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers });
  }

  const url = new URL(req.url);

  // Meta WhatsApp Cloud API verification challenge
  if (req.method === 'GET') {
    const mode = url.searchParams.get('hub.mode');
    const token = url.searchParams.get('hub.verify_token');
    const challenge = url.searchParams.get('hub.challenge');

    if (mode === 'subscribe' && challenge) {
      // Default verify token or custom secret
      const expectedToken = Deno.env.get('WHATSAPP_VERIFY_TOKEN') || 'psk_recruiter_wa_token';
      if (!token || token === expectedToken) {
        return new Response(challenge, { status: 200, headers: { 'Content-Type': 'text/plain' } });
      }
      return new Response('Forbidden', { status: 403 });
    }

    return respond({ status: 'ok', service: 'psk_recruiter_whatsapp_webhook' });
  }

  if (req.method !== 'POST') {
    return respond({ error: 'Method not allowed' }, 405);
  }

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } }
  );

  try {
    const body = await req.json();

    let phone = '';
    let content = '';
    let messageType = 'text';
    let mediaUrl = '';
    let fileName = '';
    let senderName = '';
    let externalId = '';

    // 1. Green API / QR Webhook format
    if (body.typeWebhook === 'incomingMessageReceived' || body.senderData) {
      const sender = body.senderData || {};
      phone = String(sender.chatId || sender.sender || '').replace(/@.*$/, '');
      senderName = sender.senderName || sender.senderContactName || '';
      externalId = body.idMessage || '';

      const msgData = body.messageData || {};
      const typeMsg = msgData.typeMessage || '';

      if (typeMsg === 'textMessage' || typeMsg === 'extendedTextMessage') {
        content = msgData.textMessageData?.textMessage || msgData.extendedTextMessageData?.text || '';
        messageType = 'text';
      } else if (typeMsg === 'imageMessage') {
        messageType = 'image';
        mediaUrl = msgData.fileMessageData?.downloadUrl || '';
        fileName = msgData.fileMessageData?.fileName || 'image.jpg';
        content = msgData.fileMessageData?.caption || '';
      } else if (typeMsg === 'documentMessage') {
        messageType = 'document';
        mediaUrl = msgData.fileMessageData?.downloadUrl || '';
        fileName = msgData.fileMessageData?.fileName || 'document.pdf';
        content = msgData.fileMessageData?.caption || '';
      }
    }
    // 2. Meta WhatsApp Cloud API format
    else if (body.entry && Array.isArray(body.entry)) {
      for (const entry of body.entry) {
        for (const change of entry.changes || []) {
          const value = change.value || {};
          const messages = value.messages || [];
          for (const msg of messages) {
            phone = msg.from || '';
            externalId = msg.id || '';
            senderName = value.contacts?.[0]?.profile?.name || '';
            const type = msg.type;

            if (type === 'text') {
              content = msg.text?.body || '';
              messageType = 'text';
            } else if (type === 'image') {
              messageType = 'image';
              content = msg.image?.caption || '';
              // For Meta Cloud API media id needs download, store id or caption
              fileName = 'whatsapp_photo.jpg';
            } else if (type === 'document') {
              messageType = 'document';
              fileName = msg.document?.filename || 'whatsapp_doc.pdf';
              content = msg.document?.caption || '';
            }
          }
        }
      }
    }
    // 3. Generic / Internal CRM format
    else {
      phone = body.phone || '';
      content = body.content || body.text || '';
      messageType = body.message_type || (body.media_url ? 'image' : 'text');
      mediaUrl = body.media_url || '';
      fileName = body.file_name || '';
      senderName = body.sender_name || '';
      externalId = body.external_id || '';
    }

    if (!phone) {
      return respond({ success: true, note: 'No inbound message processed (status update or event)' });
    }

    const { data, error } = await admin.rpc('crm_receive_whatsapp_message', {
      p_phone: phone,
      p_content: content,
      p_message_type: messageType,
      p_media_url: mediaUrl || null,
      p_file_name: fileName || null,
      p_external_id: externalId || null,
      p_sender_name: senderName || null,
      p_raw: body
    });

    if (error) throw error;

    return respond({ success: true, result: data });
  } catch (e) {
    const message = (e as { message?: string })?.message || String(e);
    console.error('WHATSAPP_WEBHOOK_ERROR', message);
    return respond({ error: message }, 400);
  }
});
