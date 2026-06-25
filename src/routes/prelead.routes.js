import express from 'express';
import { db } from '../lib/db.js';
import { cleanString, getClientIp, normalizePhone, nowIso, publicCode, extractLeadCode } from '../lib/utils.js';
import { requireAuth } from '../middleware/auth.js';
import { sendMetaLeadEvent } from '../services/metaCapi.service.js';

export const preleadRouter = express.Router();

function buildWhatsAppMessage(project, code) {
  const businessName = project?.name || 'TrueLead';
  return `Hola, quiero recibir información. Mi código es: ${code}`;
}

function buildWhatsAppHref(phone, message) {
  const normalized = normalizePhone(phone);
  if (!normalized) return '';
  return `https://wa.me/${normalized}?text=${encodeURIComponent(message)}`;
}

preleadRouter.post('/preleads', async (req, res) => {
  const publicId = cleanString(req.body.projectPublicId || req.body.project_id || req.body.projectId, 80);
  const project = db.data.projects.find((p) => p.publicId === publicId && p.status === 'active');

  if (!project) {
    return res.status(404).json({ error: 'Proyecto no encontrado o inactivo.' });
  }

  const code = publicCode('TL');
  const message = buildWhatsAppMessage(project, code);
  const whatsappHref = buildWhatsAppHref(project.whatsappNumber, message);

  const prelead = await db.insert('preleads', {
    agencyId: project.agencyId,
    clientId: project.clientId,
    projectId: project.id,
    projectPublicId: project.publicId,
    code,
    status: 'intent',
    metaStatus: 'pending',
    landingUrl: cleanString(req.body.landingUrl || req.headers.referer || '', 500),
    fbp: cleanString(req.body.fbp, 240),
    fbc: cleanString(req.body.fbc, 240),
    utm: req.body.utm || {},
    ip: getClientIp(req),
    userAgent: cleanString(req.headers['user-agent'], 500),
    whatsappTo: project.whatsappNumber,
    whatsappHref,
    message,
    confirmedAt: null,
    metaResponse: null
  });

  db.data.events.push({
    id: `ev_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    agencyId: project.agencyId,
    projectId: project.id,
    type: 'prelead_created',
    message: `Prelead ${code} creado.`,
    createdAt: nowIso()
  });

  await db.save();

  return res.status(201).json({
    ok: true,
    code,
    message,
    whatsappHref,
    project: {
      name: project.name,
      publicId: project.publicId
    }
  });
});

preleadRouter.post('/preleads/:code/confirm', requireAuth, async (req, res) => {
  const code = cleanString(req.params.code, 40).toUpperCase();
  const prelead = db.data.preleads.find((l) => l.code === code);

  if (!prelead) return res.status(404).json({ error: 'Código no encontrado.' });
  if (req.auth.role !== 'admin' && prelead.agencyId !== req.auth.agencyId) {
    return res.status(403).json({ error: 'No podés confirmar este lead.' });
  }

  const project = db.data.projects.find((p) => p.id === prelead.projectId);
  const phone = normalizePhone(req.body.phone || req.body.whatsappFrom || '');

  prelead.status = 'confirmed';
  prelead.confirmedAt = prelead.confirmedAt || nowIso();
  prelead.whatsappFrom = phone ? `hash:${phone.slice(-4)}` : prelead.whatsappFrom || '';
  prelead.confirmationSource = req.body.source || 'manual';
  prelead.updatedAt = nowIso();

  let metaResult = null;
  if (req.body.sendToMeta !== false) {
    metaResult = await sendMetaLeadEvent({ project, prelead, phone, testEventCode: req.body.testEventCode });
    prelead.metaResponse = metaResult;
    prelead.metaStatus = metaResult?.ok ? 'sent' : (metaResult?.skipped ? 'skipped' : 'error');
    if (metaResult?.ok) prelead.status = 'sent_to_meta';
  }

  db.data.events.push({
    id: `ev_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    agencyId: prelead.agencyId,
    projectId: prelead.projectId,
    type: 'lead_confirmed',
    message: `Lead ${code} confirmado${prelead.metaStatus === 'sent' ? ' y enviado a Meta' : ''}.`,
    createdAt: nowIso()
  });

  await db.save();

  return res.json({ ok: true, lead: prelead, meta: metaResult });
});

preleadRouter.post('/webhooks/whatsapp/message', async (req, res) => {
  const secret = req.headers['x-truelead-secret'];
  if (process.env.WHATSAPP_WEBHOOK_SECRET && secret !== process.env.WHATSAPP_WEBHOOK_SECRET) {
    return res.status(401).json({ error: 'Webhook no autorizado.' });
  }

  const text = cleanString(req.body.text || req.body.message, 2000);
  const code = extractLeadCode(text);
  if (!code) {
    return res.json({ ok: true, ignored: true, reason: 'No se detectó código TL-XXXXX.' });
  }

  const prelead = db.data.preleads.find((l) => l.code === code);
  if (!prelead) {
    return res.status(404).json({ error: 'Código recibido, pero no existe prelead asociado.', code });
  }

  const project = db.data.projects.find((p) => p.id === prelead.projectId);
  const phone = normalizePhone(req.body.from || req.body.phone || '');

  prelead.status = 'confirmed';
  prelead.confirmedAt = prelead.confirmedAt || nowIso();
  prelead.whatsappFrom = phone ? `hash:${phone.slice(-4)}` : '';
  prelead.confirmationSource = 'whatsapp_webhook';
  prelead.lastMessagePreview = text.slice(0, 180);
  prelead.updatedAt = nowIso();

  const metaResult = await sendMetaLeadEvent({ project, prelead, phone });
  prelead.metaResponse = metaResult;
  prelead.metaStatus = metaResult?.ok ? 'sent' : (metaResult?.skipped ? 'skipped' : 'error');
  if (metaResult?.ok) prelead.status = 'sent_to_meta';

  db.data.events.push({
    id: `ev_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    agencyId: prelead.agencyId,
    projectId: prelead.projectId,
    type: 'whatsapp_code_detected',
    message: `Código ${code} detectado en WhatsApp.`,
    createdAt: nowIso()
  });

  await db.save();

  return res.json({ ok: true, code, lead: prelead, meta: metaResult });
});
