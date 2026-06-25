import { sha256 } from '../lib/utils.js';

function stripMasked(value) {
  if (!value || String(value).includes('•')) return '';
  return String(value).trim();
}

export async function sendMetaLeadEvent({ project, prelead, phone, testEventCode }) {
  const pixelId = stripMasked(project?.metaPixelId) || process.env.META_PIXEL_ID;
  const accessToken = stripMasked(project?.metaCapiToken) || process.env.META_CAPI_ACCESS_TOKEN;
  const apiVersion = process.env.META_API_VERSION || 'v20.0';

  if (!pixelId || !accessToken) {
    return {
      skipped: true,
      reason: 'Falta META_PIXEL_ID o META_CAPI_ACCESS_TOKEN en el proyecto/entorno.'
    };
  }

  const userData = {
    client_ip_address: prelead.ip || undefined,
    client_user_agent: prelead.userAgent || undefined,
    fbp: prelead.fbp || undefined,
    fbc: prelead.fbc || undefined,
    ph: phone ? sha256(phone) : undefined,
    external_id: sha256(prelead.code)
  };

  Object.keys(userData).forEach((key) => userData[key] === undefined && delete userData[key]);

  const payload = {
    data: [
      {
        event_name: 'Lead',
        event_time: Math.floor(Date.now() / 1000),
        event_id: `truelead_${prelead.code}`,
        action_source: 'website',
        event_source_url: prelead.landingUrl || project?.domain || process.env.APP_URL,
        user_data: userData,
        custom_data: {
          content_name: 'TrueLead WhatsApp Lead Real',
          content_category: 'whatsapp_message_confirmed',
          lead_code: prelead.code,
          project_id: project?.id,
          project_name: project?.name,
          value: 0,
          currency: 'ARS'
        }
      }
    ]
  };

  const finalTestCode = testEventCode || project?.metaTestEventCode || process.env.META_TEST_EVENT_CODE;
  if (finalTestCode) {
    payload.test_event_code = finalTestCode;
  }

  const url = `https://graph.facebook.com/${apiVersion}/${pixelId}/events?access_token=${encodeURIComponent(accessToken)}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  const result = await response.json().catch(() => ({}));

  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      result,
      payload: {
        event_name: 'Lead',
        event_id: `truelead_${prelead.code}`
      }
    };
  }

  return {
    ok: true,
    status: response.status,
    result,
    eventId: `truelead_${prelead.code}`
  };
}
