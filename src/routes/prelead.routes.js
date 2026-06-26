import express from 'express';
import { db } from '../lib/db.js';
import { cleanString, getClientIp, normalizePhone, nowIso, publicCode } from '../lib/utils.js';
import { requireAuth } from '../middleware/auth.js';
import {
  confirmPreleadByCode,
  registerIncomingWhatsAppMessage
} from '../services/leadEvents.service.js';

export const preleadRouter = express.Router();

function buildWhatsAppMessage(project, code) {
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
    purchaseStatus: 'none',
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

  const result = await confirmPreleadByCode({
    code,
    phone: req.body.phone || req.body.whatsappFrom || '',
    source: req.body.source || 'manual',
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

  const agencyId = cleanString(req.body.agencyId, 80);
  if (!agencyId) {
    return res.status(400).json({ error: 'Falta agencyId para asociar el mensaje.' });
  }

  const result = await registerIncomingWhatsAppMessage({
    agencyId,
    messageId: req.body.messageId || '',
    from: req.body.from || req.body.phone || '',
    text: req.body.text || req.body.message || '',
    messageType: req.body.messageType || (req.body.hasMedia ? 'document' : 'text'),
    mimeType: req.body.mimeType || '',
    fileName: req.body.fileName || '',
    hasMedia: Boolean(req.body.hasMedia),
    source: 'webhook'
  });

  return res.json(result);
});
