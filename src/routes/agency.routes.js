import express from 'express';
import * as XLSX from 'xlsx';
import { nanoid } from 'nanoid';
import { db } from '../lib/db.js';
import {
  cleanString,
  normalizeLeadPhone,
  normalizePhone,
  normalizeWhatsAppNumber,
  omitSensitiveProject,
  nowIso,
  parseDateRange,
  isBetweenDates,
  normalizeAuthorizedDomains
} from '../lib/utils.js';
import { requireAuth } from '../middleware/auth.js';
import { getPlanById, getPlanCapabilities, isWithinPlanLimit } from '../lib/pricing.js';
import { updatePurchaseStatus } from '../services/leadEvents.service.js';

export const agencyRouter = express.Router();

agencyRouter.use(requireAuth);

function agencyId(req) {
  return req.auth.agencyId;
}

function ensureAgencyActive(req, res, next) {
  const agency = db.data.agencies.find((a) => a.id === agencyId(req));
  if (!agency) return res.status(404).json({ error: 'Agencia no encontrada.' });
  if (req.auth.role !== 'admin' && agency.status !== 'active') {
    return res.status(402).json({
      error: agency.status === 'pending_email'
        ? 'Cuenta pendiente de activación. Revisá el email y tocá el botón de activación.'
        : 'Cuenta pendiente de validación.',
      agency
    });
  }
  req.agency = agency;
  return next();
}

function inRange(record, from, to, fields = ['createdAt']) {
  return fields.some((field) => isBetweenDates(record[field], from, to));
}

function findClient(clients, id) {
  return clients.find((c) => c.id === id)?.name || 'Sin cliente';
}

function findProject(projects, id) {
  return projects.find((p) => p.id === id)?.name || 'Sin proyecto';
}

function findWhatsappSession(agencyId, sessionId) {
  return db.data.whatsappSessions.find((session) =>
    session.id === sessionId && session.agencyId === agencyId
  ) || null;
}

function latestLeadPhone(lead) {
  // WhatsApp puede entregar LID en vez de teléfono real. Por eso priorizamos
  // el número cargado manualmente por la agencia/cliente y nunca usamos LID
  // como teléfono exportable.
  const manual = normalizeLeadPhone(lead.manualPhone || '');
  if (manual) return manual;

  const direct = normalizeLeadPhone(lead.whatsappFromPhone || lead.phone || '');
  if (direct) return direct;

  const messages = db.data.whatsappMessages
    .filter((m) => m.preleadId === lead.id || (lead.code && m.code === lead.code))
    .sort((a, b) => String(b.receivedAt || b.createdAt).localeCompare(String(a.receivedAt || a.createdAt)));
  const fromMessage = normalizeLeadPhone(messages.find((m) => m.fromPhone)?.fromPhone || '');
  if (fromMessage) return fromMessage;

  const purchases = db.data.purchases
    .filter((purchase) => purchase.preleadId === lead.id || (lead.code && purchase.code === lead.code))
    .sort((a, b) => String(b.receivedAt || b.createdAt).localeCompare(String(a.receivedAt || a.createdAt)));
  const fromPurchase = normalizeLeadPhone(purchases.find((purchase) => purchase.whatsappFromPhone)?.whatsappFromPhone || '');
  return fromPurchase || '';
}

function maskPhone(phone, last4 = '') {
  const normalized = normalizeLeadPhone(phone);
  const suffix = normalized ? normalized.slice(-4) : String(last4 || '').slice(-4);
  return suffix ? `••••${suffix}` : '';
}

function formatPhoneForPanel(phone, last4 = '', capabilities = { canViewFullPhones: true }) {
  const normalized = normalizeLeadPhone(phone);
  if (normalized) return normalized;
  return maskPhone(normalized, last4);
}

function agencyCapabilities(req) {
  if (req.auth?.role === 'admin') return getPlanCapabilities('enterprise');
  return getPlanCapabilities(req.agency?.plan || 'free');
}

function requirePlanCapability(req, res, capability, actionLabel = 'usar esta función') {
  const capabilities = agencyCapabilities(req);
  if (capabilities[capability]) return true;

  res.status(402).json({
    error: `Tu cuenta está en plan ${req.agency?.plan || 'Free'}. Para ${actionLabel}, necesitás Starter o superior.`,
    requiredPlan: 'starter',
    currentPlan: req.agency?.plan || 'free'
  });
  return false;
}

function usageForAgency(aid) {
  return {
    clients: db.data.clients.filter((c) => c.agencyId === aid).length,
    projects: db.data.projects.filter((p) => p.agencyId === aid).length,
    whatsappSessions: db.data.whatsappSessions.filter((s) => s.agencyId === aid).length
  };
}

function enforceLimit(res, { current, limit, label, planName }) {
  if (isWithinPlanLimit(current, limit)) return true;
  res.status(403).json({
    error: Number(limit) === 0
      ? `Tu plan ${planName} es solo vista previa. Actualizá a Starter o superior para crear ${label}.`
      : `Tu plan ${planName} permite hasta ${limit} ${label}. Actualizá el plan para agregar más.`
  });
  return false;
}

function enrichProjectWhatsapp(project) {
  const session = findWhatsappSession(project.agencyId, project.whatsappSessionId);
  const client = db.data.clients.find((c) => c.id === session?.clientId && c.agencyId === project.agencyId);
  return {
    ...project,
    whatsappLinkedNumber: session?.number || project.whatsappNumber || '',
    whatsappLinkedStatus: session?.status || 'disconnected',
    whatsappLinkedLabel: session?.label || '',
    whatsappLinkedClient: client?.name || '',
    whatsappSession: session ? {
      id: session.id,
      clientId: session.clientId,
      label: session.label,
      number: session.number,
      status: session.status,
      client: client?.name || ''
    } : null
  };
}

function leadStats(lead) {
  const messages = db.data.whatsappMessages.filter((m) =>
    m.preleadId === lead.id || (lead.code && m.code === lead.code)
  );
  const purchases = db.data.purchases.filter((p) =>
    p.preleadId === lead.id || (lead.code && p.code === lead.code)
  );
  const purchasesConfirmed = purchases.filter((p) => p.status === 'purchase_confirmed').length;
  return {
    incomingMessages: messages.length,
    paymentProofs: purchases.length,
    purchasesConfirmed,
    purchaseRate: lead.status === 'confirmed' || lead.status === 'sent_to_meta'
      ? (purchasesConfirmed > 0 ? 100 : 0)
      : 0
  };
}

function enrichLead(lead, clients, projects, { capabilities = { canViewFullPhones: true } } = {}) {
  const phone = latestLeadPhone(lead);
  const phoneDisplay = formatPhoneForPanel(phone, lead.whatsappFromLast4, capabilities);
  const hasManualPhone = Boolean(normalizeLeadPhone(lead.manualPhone || ''));
  return {
    ...lead,
    client: findClient(clients, lead.clientId),
    project: findProject(projects, lead.projectId),
    whatsappFromPhone: phone,
    whatsappFrom: phone,
    phone,
    manualPhone: normalizeLeadPhone(lead.manualPhone || ''),
    hasManualPhone,
    phoneDisplay,
    phoneMasked: maskPhone(phone, lead.whatsappFromLast4),
    phoneVisibility: 'manual',
    canEditPhone: true,
    ...leadStats(lead)
  };
}

function metricsFor({ aid, from, to }) {
  const preleadsAll = db.data.preleads.filter((l) => l.agencyId === aid);
  const preleads = preleadsAll.filter((l) => inRange(l, from, to, ['createdAt']));
  const confirmedLeads = preleadsAll.filter((l) =>
    ['confirmed', 'sent_to_meta'].includes(l.status) &&
    inRange(l, from, to, ['confirmedAt', 'updatedAt'])
  );
  const messages = db.data.whatsappMessages.filter((m) =>
    m.agencyId === aid && inRange(m, from, to, ['receivedAt', 'createdAt'])
  );
  const purchases = db.data.purchases.filter((p) =>
    p.agencyId === aid && inRange(p, from, to, ['receivedAt', 'createdAt'])
  );
  const purchasesConfirmed = db.data.purchases.filter((p) =>
    p.agencyId === aid && p.status === 'purchase_confirmed' && inRange(p, from, to, ['validatedAt', 'updatedAt', 'createdAt'])
  );
  const sentToMeta = confirmedLeads.filter((l) => l.metaStatus === 'sent').length;

  const clicks = preleads.length;
  const confirmed = confirmedLeads.length;
  const totalIncomingMessages = messages.length;
  const totalPurchasesConfirmed = purchasesConfirmed.length;
  const leadConversionRate = clicks ? Math.round((confirmed / clicks) * 1000) / 10 : 0;
  const salesConversionRate = confirmed ? Math.round((totalPurchasesConfirmed / confirmed) * 1000) / 10 : 0;
  const messageToSaleRate = totalIncomingMessages ? Math.round((totalPurchasesConfirmed / totalIncomingMessages) * 1000) / 10 : 0;

  return {
    clicks,
    confirmed,
    sentToMeta,
    totalIncomingMessages,
    paymentProofs: purchases.length,
    purchasesConfirmed: totalPurchasesConfirmed,
    purchasesPending: purchases.filter((p) => p.status === 'proof_received').length,
    leadConversionRate,
    conversionRate: leadConversionRate,
    salesConversionRate,
    messageToSaleRate
  };
}


function exportDate(value) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

function csvEscape(value) {
  const str = String(value ?? '');
  if (/[",\n\r;]/.test(str)) return `"${str.replaceAll('"', '""')}"`;
  return str;
}

function buildLeadExportRows({ aid, from, to, mode = 'full' }) {
  const clients = db.data.clients.filter((c) => c.agencyId === aid);
  const projects = db.data.projects.filter((p) => p.agencyId === aid);
  let leads = db.data.preleads
    .filter((lead) => lead.agencyId === aid)
    .filter((lead) => inRange(lead, from, to, ['createdAt', 'confirmedAt', 'updatedAt']))
    .map((lead) => enrichLead(lead, clients, projects, { capabilities: { canViewFullPhones: true, phoneVisibility: 'full' } }));

  if (mode === 'confirmed' || mode === 'numbers') {
    leads = leads.filter((lead) => ['confirmed', 'sent_to_meta', 'payment_proof_received'].includes(lead.status));
  }
  if (mode === 'buyers') {
    leads = leads.filter((lead) => Number(lead.purchasesConfirmed || 0) > 0);
  }

  leads = leads.sort((a, b) => String(b.confirmedAt || b.createdAt).localeCompare(String(a.confirmedAt || a.createdAt)));

  if (mode === 'numbers') {
    return leads
      .filter((lead) => lead.phone)
      .map((lead) => ({
        numero: lead.phone,
        codigo: lead.code,
        cliente: lead.client || '',
        proyecto: lead.project || '',
        estado: lead.status || '',
        fecha: exportDate(lead.confirmedAt || lead.createdAt)
      }));
  }

  return leads.map((lead) => ({
    codigo: lead.code,
    telefono: lead.phone || '',
    cliente: lead.client || '',
    proyecto: lead.project || '',
    estado: lead.status || '',
    meta: lead.metaStatus || '',
    mensajes_entrantes: lead.incomingMessages ?? lead.incomingMessageCount ?? 0,
    comprobantes: lead.paymentProofs ?? 0,
    ventas_validadas: lead.purchasesConfirmed ?? 0,
    porcentaje_compra: `${lead.purchaseRate ?? 0}%`,
    origen_boton: lead.buttonSource || '',
    landing: lead.landingUrl || '',
    fecha_click: exportDate(lead.createdAt),
    fecha_confirmacion: exportDate(lead.confirmedAt),
    ultima_actividad: exportDate(lead.updatedAt)
  }));
}

function sendRowsAsCsv(res, rows, filename) {
  const headers = Object.keys(rows[0] || { numero: '', codigo: '', cliente: '', proyecto: '', fecha: '' });
  const csv = [
    headers.join(','),
    ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(','))
  ].join('\n');

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);
  return res.send(`\uFEFF${csv}`);
}

function sendRowsAsXlsx(res, rows, filename) {
  const worksheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Leads');
  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}.xlsx"`);
  return res.send(buffer);
}

agencyRouter.get('/dashboard', ensureAgencyActive, (req, res) => {
  const aid = agencyId(req);
  const range = parseDateRange(req.query);
  const clients = db.data.clients.filter((c) => c.agencyId === aid);
  const projects = db.data.projects.filter((p) => p.agencyId === aid);
  const preleadsAll = db.data.preleads.filter((l) => l.agencyId === aid);
  const metrics = metricsFor({ aid, from: range.from, to: range.to });
  const capabilities = agencyCapabilities(req);
  const usage = usageForAgency(aid);

  const recent = [...preleadsAll]
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .slice(0, 20)
    .map((lead) => enrichLead(lead, clients, projects, { capabilities }));

  return res.json({
    agency: req.agency,
    plan: { ...getPlanById(req.agency.plan), capabilities },
    capabilities,
    usage,
    range,
    metrics: {
      clients: clients.length,
      projects: projects.length,
      ...metrics
    },
    recent
  });
});

agencyRouter.get('/clients', ensureAgencyActive, (req, res) => {
  const clients = db.data.clients.filter((c) => c.agencyId === agencyId(req));
  res.json({ clients });
});

agencyRouter.post('/clients', ensureAgencyActive, async (req, res) => {
  if (!requirePlanCapability(req, res, 'canCreateClients', 'crear clientes')) return;
  const plan = getPlanById(req.agency.plan);
  const current = db.data.clients.filter((c) => c.agencyId === agencyId(req)).length;
  if (!enforceLimit(res, { current, limit: plan.clientsLimit, label: 'clientes', planName: plan.name })) return;

  const client = await db.insert('clients', {
    agencyId: agencyId(req),
    name: cleanString(req.body.name, 160),
    email: cleanString(req.body.email, 180),
    phone: normalizePhone(req.body.phone),
    status: 'active',
    notes: cleanString(req.body.notes, 1000)
  });
  res.status(201).json({ client });
});

agencyRouter.put('/clients/:id', ensureAgencyActive, async (req, res) => {
  if (!requirePlanCapability(req, res, 'canCreateClients', 'editar clientes')) return;
  const client = db.data.clients.find((c) => c.id === req.params.id && c.agencyId === agencyId(req));
  if (!client) return res.status(404).json({ error: 'Cliente no encontrado.' });

  const updated = await db.update('clients', client.id, {
    name: cleanString(req.body.name ?? client.name, 160),
    email: cleanString(req.body.email ?? client.email, 180),
    phone: normalizePhone(req.body.phone ?? client.phone),
    status: cleanString(req.body.status ?? client.status, 50),
    notes: cleanString(req.body.notes ?? client.notes, 1000)
  });
  res.json({ client: updated });
});

agencyRouter.delete('/clients/:id', ensureAgencyActive, async (req, res) => {
  if (!requirePlanCapability(req, res, 'canCreateClients', 'eliminar clientes')) return;
  const aid = agencyId(req);
  const client = db.data.clients.find((c) => c.id === req.params.id && c.agencyId === aid);
  if (!client) return res.status(404).json({ error: 'Cliente no encontrado.' });

  const projectIds = db.data.projects
    .filter((project) => project.agencyId === aid && project.clientId === client.id)
    .map((project) => project.id);
  const sessionIds = db.data.whatsappSessions
    .filter((session) => session.agencyId === aid && session.clientId === client.id)
    .map((session) => session.id);

  db.data.clients = db.data.clients.filter((item) => item.id !== client.id);
  db.data.projects = db.data.projects.filter((item) => !(item.agencyId === aid && item.clientId === client.id));
  db.data.whatsappSessions = db.data.whatsappSessions.filter((item) => !(item.agencyId === aid && item.clientId === client.id));

  // Conservamos leads, mensajes y comprobantes como historial, pero quedan desasociados del cliente/proyecto eliminado.
  for (const lead of db.data.preleads || []) {
    if (lead.agencyId === aid && lead.clientId === client.id) {
      lead.clientId = '';
      if (projectIds.includes(lead.projectId)) lead.projectId = '';
      if (sessionIds.includes(lead.whatsappSessionId)) lead.whatsappSessionId = '';
      lead.updatedAt = nowIso();
    }
  }
  for (const message of db.data.whatsappMessages || []) {
    if (message.agencyId === aid && message.clientId === client.id) {
      message.clientId = '';
      if (projectIds.includes(message.projectId)) message.projectId = '';
      if (sessionIds.includes(message.whatsappSessionId)) message.whatsappSessionId = '';
      message.updatedAt = nowIso();
    }
  }
  for (const purchase of db.data.purchases || []) {
    if (purchase.agencyId === aid && purchase.clientId === client.id) {
      purchase.clientId = '';
      if (projectIds.includes(purchase.projectId)) purchase.projectId = '';
      if (sessionIds.includes(purchase.whatsappSessionId)) purchase.whatsappSessionId = '';
      purchase.updatedAt = nowIso();
    }
  }

  await db.save();
  res.json({ ok: true, removedProjects: projectIds.length, removedWhatsappSessions: sessionIds.length });
});

agencyRouter.get('/projects', ensureAgencyActive, (req, res) => {
  const projects = db.data.projects
    .filter((p) => p.agencyId === agencyId(req))
    .map((project) => omitSensitiveProject(enrichProjectWhatsapp(project)));
  res.json({ projects });
});

agencyRouter.post('/projects', ensureAgencyActive, async (req, res) => {
  if (!requirePlanCapability(req, res, 'canCreateProjects', 'crear proyectos')) return;
  const plan = getPlanById(req.agency.plan);
  const current = db.data.projects.filter((p) => p.agencyId === agencyId(req)).length;
  if (!enforceLimit(res, { current, limit: plan.projectsLimit, label: 'proyectos', planName: plan.name })) return;

  const client = db.data.clients.find((c) => c.id === req.body.clientId && c.agencyId === agencyId(req));
  if (!client) return res.status(400).json({ error: 'Seleccioná un cliente válido.' });

  const session = findWhatsappSession(agencyId(req), cleanString(req.body.whatsappSessionId, 80));
  if (!session) return res.status(400).json({ error: 'Seleccioná un WhatsApp vinculado para este proyecto.' });

  if (session.clientId && session.clientId !== client.id) {
    return res.status(400).json({ error: 'El WhatsApp seleccionado pertenece a otro cliente.' });
  }

  const project = await db.insert('projects', {
    agencyId: agencyId(req),
    clientId: client.id,
    publicId: 'tl_' + nanoid(10),
    name: cleanString(req.body.name, 160),
    domain: normalizeAuthorizedDomains(req.body.domain),
    whatsappSessionId: session.id,
    whatsappNumber: normalizeWhatsAppNumber(session.number || ''),
    metaPixelId: cleanString(req.body.metaPixelId, 120),
    metaCapiToken: cleanString(req.body.metaCapiToken, 500),
    metaTestEventCode: cleanString(req.body.metaTestEventCode, 120),
    status: 'active',
    createdAt: nowIso()
  });

  res.status(201).json({ project: omitSensitiveProject(enrichProjectWhatsapp(project)) });
});

agencyRouter.put('/projects/:id', ensureAgencyActive, async (req, res) => {
  if (!requirePlanCapability(req, res, 'canCreateProjects', 'editar proyectos')) return;
  const project = db.data.projects.find((p) => p.id === req.params.id && p.agencyId === agencyId(req));
  if (!project) return res.status(404).json({ error: 'Proyecto no encontrado.' });

  const nextClientId = cleanString(req.body.clientId ?? project.clientId, 80);
  const client = db.data.clients.find((c) => c.id === nextClientId && c.agencyId === agencyId(req));
  if (!client) return res.status(400).json({ error: 'Seleccioná un cliente válido.' });

  const sessionId = cleanString(req.body.whatsappSessionId ?? project.whatsappSessionId, 80);
  const session = findWhatsappSession(agencyId(req), sessionId);
  if (!session) return res.status(400).json({ error: 'Seleccioná un WhatsApp vinculado válido.' });

  if (session.clientId && session.clientId !== nextClientId) {
    return res.status(400).json({ error: 'El WhatsApp seleccionado pertenece a otro cliente.' });
  }

  const patch = {
    clientId: nextClientId,
    name: cleanString(req.body.name ?? project.name, 160),
    domain: normalizeAuthorizedDomains(req.body.domain ?? project.domain),
    whatsappSessionId: session.id,
    whatsappNumber: normalizeWhatsAppNumber(session.number || project.whatsappNumber),
    metaPixelId: cleanString(req.body.metaPixelId ?? project.metaPixelId, 120),
    metaTestEventCode: cleanString(req.body.metaTestEventCode ?? project.metaTestEventCode, 120),
    status: cleanString(req.body.status ?? project.status, 50)
  };
  if (req.body.metaCapiToken && !String(req.body.metaCapiToken).includes('•')) {
    patch.metaCapiToken = cleanString(req.body.metaCapiToken, 500);
  }

  const updated = await db.update('projects', project.id, patch);
  res.json({ project: omitSensitiveProject(enrichProjectWhatsapp(updated)) });
});

agencyRouter.delete('/projects/:id', ensureAgencyActive, async (req, res) => {
  if (!requirePlanCapability(req, res, 'canCreateProjects', 'eliminar proyectos')) return;
  const project = db.data.projects.find((p) => p.id === req.params.id && p.agencyId === agencyId(req));
  if (!project) return res.status(404).json({ error: 'Proyecto no encontrado.' });
  await db.remove('projects', project.id);
  res.json({ ok: true });
});


agencyRouter.get('/exports/leads', ensureAgencyActive, (req, res) => {
  if (!requirePlanCapability(req, res, 'canExportLeads', 'exportar bases')) return;
  const aid = agencyId(req);
  const range = parseDateRange(req.query);
  const mode = cleanString(req.query.mode || 'full', 40);
  const format = cleanString(req.query.format || 'csv', 20).toLowerCase();
  const safeMode = ['full', 'numbers', 'confirmed', 'buyers'].includes(mode) ? mode : 'full';
  const safeFormat = ['csv', 'xlsx'].includes(format) ? format : 'csv';
  const rows = buildLeadExportRows({ aid, from: range.from, to: range.to, mode: safeMode });
  const stamp = new Date().toISOString().slice(0, 10);
  const filename = `truelead_${safeMode}_${range.range}_${stamp}`;

  if (safeFormat === 'xlsx') return sendRowsAsXlsx(res, rows, filename);
  return sendRowsAsCsv(res, rows, filename);
});



agencyRouter.patch('/preleads/:id/phone', ensureAgencyActive, async (req, res) => {
  if (!requirePlanCapability(req, res, 'canEditLeadPhones', 'editar teléfonos de leads')) return;
  const aid = agencyId(req);
  const lead = db.data.preleads.find((item) => item.id === req.params.id && item.agencyId === aid);
  if (!lead) return res.status(404).json({ error: 'Lead no encontrado.' });

  const rawPhone = cleanString(req.body.phone, 80);
  const normalizedPhone = normalizeLeadPhone(rawPhone);

  if (rawPhone && !normalizedPhone) {
    return res.status(400).json({ error: 'Ingresá un teléfono válido con código de país. Ejemplo: 5491123456789.' });
  }

  const patch = {
    manualPhone: normalizedPhone,
    manualPhoneRaw: rawPhone,
    manualPhoneUpdatedAt: nowIso(),
    manualPhoneUpdatedBy: req.auth.sub,
    updatedAt: nowIso()
  };

  // El teléfono manual es la fuente confiable para panel/exportación.
  // Si se borra manualmente, no forzamos un LID ni un dato automático dudoso.
  patch.phone = normalizedPhone;
  patch.whatsappFromPhone = normalizedPhone;
  patch.whatsappFrom = normalizedPhone;
  patch.whatsappFromLast4 = normalizedPhone ? normalizedPhone.slice(-4) : '';

  const updated = await db.update('preleads', lead.id, patch);
  const clients = db.data.clients.filter((c) => c.agencyId === aid);
  const projects = db.data.projects.filter((p) => p.agencyId === aid);
  res.json({ lead: enrichLead(updated, clients, projects, { capabilities: agencyCapabilities(req) }) });
});

agencyRouter.get('/preleads', ensureAgencyActive, (req, res) => {
  const aid = agencyId(req);
  const range = parseDateRange(req.query);
  const projects = db.data.projects.filter((p) => p.agencyId === aid);
  const clients = db.data.clients.filter((c) => c.agencyId === aid);
  const capabilities = agencyCapabilities(req);
  const leads = db.data.preleads
    .filter((l) => l.agencyId === aid)
    .filter((l) => inRange(l, range.from, range.to, ['createdAt', 'confirmedAt', 'updatedAt']))
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .map((lead) => enrichLead(lead, clients, projects, { capabilities }));
  res.json({ range, leads, metrics: metricsFor({ aid, from: range.from, to: range.to }), capabilities });
});

agencyRouter.get('/purchases', ensureAgencyActive, (req, res) => {
  const aid = agencyId(req);
  const range = parseDateRange(req.query);
  const projects = db.data.projects.filter((p) => p.agencyId === aid);
  const clients = db.data.clients.filter((c) => c.agencyId === aid);

  const purchases = db.data.purchases
    .filter((purchase) => purchase.agencyId === aid)
    .filter((purchase) => inRange(purchase, range.from, range.to, ['receivedAt', 'validatedAt', 'createdAt', 'updatedAt']))
    .sort((a, b) => String(b.receivedAt || b.createdAt).localeCompare(String(a.receivedAt || a.createdAt)))
    .map((purchase) => ({
      ...purchase,
      project: findProject(projects, purchase.projectId),
      client: findClient(clients, purchase.clientId),
      phoneDisplay: formatPhoneForPanel(purchase.whatsappFromPhone, purchase.whatsappFromLast4, agencyCapabilities(req)),
      whatsappFromPhone: agencyCapabilities(req).canViewFullPhones ? normalizeLeadPhone(purchase.whatsappFromPhone || '') : ''
    }));

  res.json({ range, purchases });
});

agencyRouter.patch('/purchases/:id/status', ensureAgencyActive, async (req, res) => {
  if (!requirePlanCapability(req, res, 'canUsePurchases', 'validar comprobantes')) return;
  const result = await updatePurchaseStatus({
    purchaseId: req.params.id,
    agencyId: agencyId(req),
    status: cleanString(req.body.status, 80),
    notes: cleanString(req.body.notes, 1000),
    userId: req.auth.sub
  });

  if (!result.ok) {
    return res.status(result.status || 400).json({ error: result.error });
  }

  res.json({ purchase: result.purchase, prelead: result.prelead });
});
