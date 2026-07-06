import express from 'express';
import { nanoid } from 'nanoid';
import { db } from '../lib/db.js';
import {
  cleanString,
  normalizePhone,
  normalizeWhatsAppNumber,
  omitSensitiveProject,
  nowIso,
  parseDateRange,
  isBetweenDates,
  normalizeAuthorizedDomains
} from '../lib/utils.js';
import { requireAuth } from '../middleware/auth.js';
import { getPlanById } from '../lib/pricing.js';
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

function enrichLead(lead, clients, projects) {
  return {
    ...lead,
    client: findClient(clients, lead.clientId),
    project: findProject(projects, lead.projectId),
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

agencyRouter.get('/dashboard', ensureAgencyActive, (req, res) => {
  const aid = agencyId(req);
  const range = parseDateRange(req.query);
  const clients = db.data.clients.filter((c) => c.agencyId === aid);
  const projects = db.data.projects.filter((p) => p.agencyId === aid);
  const preleadsAll = db.data.preleads.filter((l) => l.agencyId === aid);
  const metrics = metricsFor({ aid, from: range.from, to: range.to });

  const recent = [...preleadsAll]
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .slice(0, 20)
    .map((lead) => enrichLead(lead, clients, projects));

  return res.json({
    agency: req.agency,
    plan: getPlanById(req.agency.plan),
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
  const project = db.data.projects.find((p) => p.id === req.params.id && p.agencyId === agencyId(req));
  if (!project) return res.status(404).json({ error: 'Proyecto no encontrado.' });
  await db.remove('projects', project.id);
  res.json({ ok: true });
});

agencyRouter.get('/preleads', ensureAgencyActive, (req, res) => {
  const aid = agencyId(req);
  const range = parseDateRange(req.query);
  const projects = db.data.projects.filter((p) => p.agencyId === aid);
  const clients = db.data.clients.filter((c) => c.agencyId === aid);
  const leads = db.data.preleads
    .filter((l) => l.agencyId === aid)
    .filter((l) => inRange(l, range.from, range.to, ['createdAt', 'confirmedAt', 'updatedAt']))
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .map((lead) => enrichLead(lead, clients, projects));
  res.json({ range, leads, metrics: metricsFor({ aid, from: range.from, to: range.to }) });
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
      client: findClient(clients, purchase.clientId)
    }));

  res.json({ range, purchases });
});

agencyRouter.patch('/purchases/:id/status', ensureAgencyActive, async (req, res) => {
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
