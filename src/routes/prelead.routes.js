import express from 'express';
import { db } from '../lib/db.js';
import { cleanString, getClientIp, normalizePhone, nowIso, publicCode, extractLeadCode } from '../lib/utils.js';
import { requireAuth } from '../middleware/auth.js';
import { confirmPreleadByCode, registerIncomingWhatsAppMessage } from '../services/leadEvents.service.js';

export const preleadRouter = express.Router();

function generateUniqueLeadCode() {
  for (let i = 0; i < 20; i++) {
    const code = publicCode('TL', 6);
    if (!db.data.preleads.some((lead) => lead.code === code)) return code;
  }
  return `TL-${Date.now().toString(36).toUpperCase()}`;
}

function getProjectWhatsapp(project) {
  let session = db.data.whatsappSessions.find((item) =>
    item.id === project.whatsappSessionId && item.agencyId === project.agencyId
  );

  // Fallback suave para proyectos viejos sin whatsappSessionId.
  if (!session && project.clientId) {
    session = db.data.whatsappSessions.find((item) =>
      item.agencyId === project.agencyId &&
      item.clientId === project.clientId &&
      item.status === 'connected'
    );
  }

  const sessionNumber = normalizePhone(session?.number || '');
  const fallbackNumber = normalizePhone(project.whatsappNumber || '');
  const finalNumber = sessionNumber || fallbackNumber;

  return {
    number: finalNumber,
    session,
    status: session?.status || (fallbackNumber ? 'manual_fallback' : 'missing')
  };
}

function buildWhatsAppMessage(project, code, template = '') {
  const rawTemplate = cleanString(template, 700);
  if (rawTemplate) {
    if (rawTemplate.includes('{{code}}')) {
      return rawTemplate.replaceAll('{{code}}', code);
    }
    return `${rawTemplate} ${code}`.trim();
  }

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

  const whatsapp = getProjectWhatsapp(project);
  if (!whatsapp.number) {
    return res.status(400).json({ error: 'Este proyecto todavía no tiene WhatsApp vinculado por QR.' });
  }

  const code = generateUniqueLeadCode();
  const message = buildWhatsAppMessage(project, code, req.body.messageTemplate || req.body.message);
  const whatsappHref = buildWhatsAppHref(whatsapp.number, message);

  const prelead = await db.insert('preleads', {
    agencyId: project.agencyId,
    clientId: project.clientId,
    projectId: project.id,
    projectPublicId: project.publicId,
    code,
    status: 'intent',
    metaStatus: 'pending',
    landingUrl: cleanString(req.body.landingUrl || req.headers.referer || '', 500),
    visitorId: cleanString(req.body.visitorId, 120),
    buttonSource: cleanString(req.body.buttonSource || req.body.source, 120),
    messageTemplate: cleanString(req.body.messageTemplate || req.body.message, 700),
    fbp: cleanString(req.body.fbp, 240),
    fbc: cleanString(req.body.fbc, 240),
    utm: req.body.utm || {},
    ip: getClientIp(req),
    userAgent: cleanString(req.headers['user-agent'], 500),
    whatsappSessionId: whatsapp.session?.id || project.whatsappSessionId || '',
    whatsappTo: whatsapp.number,
    whatsappHref,
    message,
    incomingMessageCount: 0,
    confirmedAt: null,
    metaResponse: null,
    purchaseStatus: 'none'
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
  const normalizedCode = cleanString(req.params.code, 40).toUpperCase();
  const existingLead = db.data.preleads.find((lead) => lead.code === normalizedCode);
  if (!existingLead) return res.status(404).json({ error: 'Código no encontrado.' });
  if (req.auth.role !== 'admin' && existingLead.agencyId !== req.auth.agencyId) {
    return res.status(403).json({ error: 'No podés confirmar este lead.' });
  }

  const result = await confirmPreleadByCode({
    code: normalizedCode,
    phone: req.body.phone || req.body.whatsappFrom || '',
    source: req.body.source || 'manual_panel',
    sendToMeta: req.body.sendToMeta !== false,
    messageText: req.body.messageText || '',
    testEventCode: req.body.testEventCode || ''
  });

  if (!result.ok) {
    return res.status(result.status || 400).json({ error: result.error });
  }

  return res.json({ ok: true, lead: result.lead, meta: result.meta });
});

preleadRouter.post('/webhooks/whatsapp/message', async (req, res) => {
  const secret = req.headers['x-truelead-secret'];
  if (process.env.WHATSAPP_WEBHOOK_SECRET && secret !== process.env.WHATSAPP_WEBHOOK_SECRET) {
    return res.status(401).json({ error: 'Webhook no autorizado.' });
  }

  const text = cleanString(req.body.text || req.body.message, 2000);
  const code = extractLeadCode(text);
  const prelead = code ? db.data.preleads.find((l) => l.code === code) : null;
  const agencyId = cleanString(req.body.agencyId || prelead?.agencyId, 80);

  if (!agencyId) {
    return res.status(400).json({ error: 'No se pudo asociar el mensaje a una agencia.' });
  }

  const result = await registerIncomingWhatsAppMessage({
    agencyId,
    messageId: req.body.messageId || '',
    from: req.body.from || req.body.phone || '',
    text,
    messageType: req.body.messageType || (req.body.hasMedia ? 'document' : 'text'),
    mimeType: req.body.mimeType || '',
    fileName: req.body.fileName || '',
    hasMedia: Boolean(req.body.hasMedia),
    source: 'webhook'
  });

  return res.json(result);
});
