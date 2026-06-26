import { nanoid } from 'nanoid';
import { db } from '../lib/db.js';
import {
  cleanString,
  extractLeadCode,
  normalizePhone,
  nowIso,
  sha256
} from '../lib/utils.js';
import { sendMetaLeadEvent } from './metaCapi.service.js';

function getPhoneHash(phone) {
  const normalized = normalizePhone(phone);
  return normalized ? sha256(normalized) : '';
}

function phoneLast4(phone) {
  const normalized = normalizePhone(phone);
  return normalized ? normalized.slice(-4) : '';
}

function pushEvent({ agencyId, projectId, type, message }) {
  db.data.events.push({
    id: `ev_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    agencyId,
    projectId,
    type,
    message,
    createdAt: nowIso()
  });
}

export async function confirmPreleadByCode({
  code,
  phone = '',
  source = 'manual',
  sendToMeta = true,
  messageText = '',
  testEventCode = ''
}) {
  const normalizedCode = cleanString(code, 40).toUpperCase();
  const prelead = db.data.preleads.find((l) => l.code === normalizedCode);

  if (!prelead) {
    return { ok: false, status: 404, error: 'Código no encontrado.' };
  }

  const project = db.data.projects.find((p) => p.id === prelead.projectId);
  const normalizedPhone = normalizePhone(phone);
  const phoneHash = getPhoneHash(normalizedPhone);

  prelead.status = prelead.status === 'sent_to_meta' ? prelead.status : 'confirmed';
  prelead.confirmedAt = prelead.confirmedAt || nowIso();
  prelead.whatsappFromLast4 = phoneLast4(normalizedPhone);
  prelead.whatsappFromHash = phoneHash || prelead.whatsappFromHash || '';
  prelead.whatsappFrom = normalizedPhone ? `hash:${phoneLast4(normalizedPhone)}` : prelead.whatsappFrom || '';
  prelead.confirmationSource = source;
  prelead.lastMessagePreview = cleanString(messageText, 180);
  prelead.updatedAt = nowIso();

  let metaResult = null;
  if (sendToMeta) {
    metaResult = await sendMetaLeadEvent({ project, prelead, phone: normalizedPhone, testEventCode });
    prelead.metaResponse = metaResult;
    prelead.metaStatus = metaResult?.ok ? 'sent' : (metaResult?.skipped ? 'skipped' : 'error');
    if (metaResult?.ok) prelead.status = 'sent_to_meta';
  }

  pushEvent({
    agencyId: prelead.agencyId,
    projectId: prelead.projectId,
    type: 'lead_confirmed',
    message: `Lead ${normalizedCode} confirmado${prelead.metaStatus === 'sent' ? ' y enviado a Meta' : ''}.`
  });

  await db.save();

  return { ok: true, lead: prelead, project, meta: metaResult };
}

function findRecentLeadByPhone({ agencyId, phoneHash }) {
  if (!phoneHash) return null;

  return [...db.data.preleads]
    .filter((lead) =>
      lead.agencyId === agencyId &&
      lead.whatsappFromHash === phoneHash &&
      ['confirmed', 'sent_to_meta', 'payment_proof_received'].includes(lead.status)
    )
    .sort((a, b) => String(b.confirmedAt || b.createdAt).localeCompare(String(a.confirmedAt || a.createdAt)))[0] || null;
}

export async function registerIncomingWhatsAppMessage({
  agencyId,
  messageId = '',
  from = '',
  text = '',
  messageType = 'text',
  mimeType = '',
  fileName = '',
  hasMedia = false,
  source = 'baileys'
}) {
  const normalizedPhone = normalizePhone(from);
  const phoneHash = getPhoneHash(normalizedPhone);
  const code = extractLeadCode(text);
  let prelead = code ? db.data.preleads.find((l) => l.code === code && l.agencyId === agencyId) : null;

  if (!prelead && phoneHash) {
    prelead = findRecentLeadByPhone({ agencyId, phoneHash });
  }

  const project = prelead ? db.data.projects.find((p) => p.id === prelead.projectId) : null;
  const client = prelead ? db.data.clients.find((c) => c.id === prelead.clientId) : null;

  /*
    Para no inflar la base, TrueLead no guarda conversaciones completas.
    Solo registra mensajes que:
    - contienen código TL-XXXXX, o
    - traen archivo/media, posible comprobante.
  */
  if (!code && !hasMedia) {
    return {
      ok: true,
      ignored: true,
      reason: 'Mensaje sin código ni archivo. No se guarda para evitar inflar la base.'
    };
  }

  const messageRecord = await db.insert('whatsappMessages', {
    agencyId,
    clientId: prelead?.clientId || null,
    projectId: prelead?.projectId || null,
    preleadId: prelead?.id || null,
    code: prelead?.code || code || '',
    externalMessageId: cleanString(messageId, 200),
    fromHash: phoneHash,
    fromLast4: phoneLast4(normalizedPhone),
    messageType,
    hasMedia,
    mimeType: cleanString(mimeType, 160),
    fileName: cleanString(fileName, 220),
    textPreview: cleanString(text, 180),
    detectedEvent: code ? 'lead_code_detected' : (hasMedia ? 'media_received' : 'message_received'),
    source,
    receivedAt: nowIso()
  });

  let leadResult = null;
  if (code && prelead) {
    leadResult = await confirmPreleadByCode({
      code,
      phone: normalizedPhone,
      source: `${source}_message`,
      sendToMeta: true,
      messageText: text
    });
    prelead = leadResult.lead || prelead;
  }

  let purchase = null;
  if (hasMedia) {
    purchase = await registerPaymentProof({
      agencyId,
      phone: normalizedPhone,
      text,
      messageType,
      mimeType,
      fileName,
      source,
      messageId,
      prelead,
      messageRecordId: messageRecord.id
    });
  }

  return {
    ok: true,
    message: messageRecord,
    lead: prelead || null,
    leadResult,
    purchase,
    project: project || null,
    client: client || null
  };
}

export async function registerPaymentProof({
  agencyId,
  phone = '',
  text = '',
  messageType = 'document',
  mimeType = '',
  fileName = '',
  source = 'manual',
  messageId = '',
  prelead = null,
  messageRecordId = null
}) {
  const normalizedPhone = normalizePhone(phone);
  const phoneHash = getPhoneHash(normalizedPhone);
  const code = extractLeadCode(text);

  if (!prelead && code) {
    prelead = db.data.preleads.find((l) => l.code === code && l.agencyId === agencyId);
  }

  if (!prelead && phoneHash) {
    prelead = findRecentLeadByPhone({ agencyId, phoneHash });
  }

  const project = prelead ? db.data.projects.find((p) => p.id === prelead.projectId) : null;

  const purchase = await db.insert('purchases', {
    agencyId,
    clientId: prelead?.clientId || null,
    projectId: prelead?.projectId || null,
    preleadId: prelead?.id || null,
    code: prelead?.code || code || '',
    whatsappFromHash: phoneHash,
    whatsappFromLast4: phoneLast4(normalizedPhone),
    messageRecordId,
    externalMessageId: cleanString(messageId, 200),
    proofType: messageType,
    mimeType: cleanString(mimeType, 160),
    fileName: cleanString(fileName, 220),
    captionPreview: cleanString(text, 180),
    status: 'proof_received',
    validationStatus: 'pending',
    source,
    receivedAt: nowIso(),
    validatedAt: null,
    validatedBy: null,
    notes: ''
  });

  if (prelead) {
    prelead.purchaseStatus = 'proof_received';
    prelead.paymentProofReceivedAt = prelead.paymentProofReceivedAt || nowIso();
    prelead.updatedAt = nowIso();
  }

  pushEvent({
    agencyId,
    projectId: prelead?.projectId || project?.id || null,
    type: 'payment_proof_received',
    message: `Comprobante recibido${prelead?.code ? ` para ${prelead.code}` : ''}.`
  });

  await db.save();

  return purchase;
}

export async function updatePurchaseStatus({
  purchaseId,
  agencyId,
  status,
  notes = '',
  userId = ''
}) {
  const purchase = db.data.purchases.find((p) => p.id === purchaseId && (!agencyId || p.agencyId === agencyId));
  if (!purchase) {
    return { ok: false, status: 404, error: 'Comprobante no encontrado.' };
  }

  const allowed = ['proof_received', 'purchase_confirmed', 'rejected', 'duplicate'];
  if (!allowed.includes(status)) {
    return { ok: false, status: 400, error: 'Estado de comprobante inválido.' };
  }

  purchase.status = status;
  purchase.validationStatus = status === 'purchase_confirmed' ? 'approved' : (status === 'proof_received' ? 'pending' : status);
  purchase.notes = cleanString(notes, 1000);
  purchase.validatedAt = status === 'proof_received' ? null : nowIso();
  purchase.validatedBy = status === 'proof_received' ? null : userId;
  purchase.updatedAt = nowIso();

  const prelead = purchase.preleadId ? db.data.preleads.find((l) => l.id === purchase.preleadId) : null;
  if (prelead) {
    prelead.purchaseStatus = status;
    prelead.purchaseValidatedAt = purchase.validatedAt;
    prelead.updatedAt = nowIso();
  }

  pushEvent({
    agencyId: purchase.agencyId,
    projectId: purchase.projectId,
    type: 'purchase_status_updated',
    message: `Comprobante ${purchase.code || purchase.id} actualizado a ${status}.`
  });

  await db.save();

  return { ok: true, purchase, prelead };
}
