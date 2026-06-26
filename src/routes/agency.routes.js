import express from 'express';
import { nanoid } from 'nanoid';
import { db } from '../lib/db.js';
import { cleanString, normalizePhone, omitSensitiveProject, nowIso } from '../lib/utils.js';
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
      error: 'Cuenta pendiente de validación.',
      agency
    });
  }
  req.agency = agency;
  return next();
}

agencyRouter.get('/dashboard', ensureAgencyActive, (req, res) => {
  const aid = agencyId(req);
  const clients = db.data.clients.filter((c) => c.agencyId === aid);
  const projects = db.data.projects.filter((p) => p.agencyId === aid);
  const preleads = db.data.preleads.filter((l) => l.agencyId === aid);
  const purchases = db.data.purchases.filter((p) => p.agencyId === aid);

  const clicks = preleads.length;
  const confirmed = preleads.filter((l) => l.status === 'confirmed' || l.status === 'sent_to_meta').length;
  const sentToMeta = preleads.filter((l) => l.metaStatus === 'sent').length;
  const conversionRate = clicks ? Math.round((confirmed / clicks) * 1000) / 10 : 0;

  const recent = [...preleads]
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .slice(0, 20)
    .map((lead) => ({
      ...lead,
      project: projects.find((p) => p.id === lead.projectId)?.name || 'Sin proyecto',
      client: clients.find((c) => c.id === lead.clientId)?.name || 'Sin cliente'
    }));

  return res.json({
    agency: req.agency,
    plan: getPlanById(req.agency.plan),
    metrics: {
      clients: clients.length,
      projects: projects.length,
      clicks,
      confirmed,
      sentToMeta,
      paymentProofs: purchases.length,
      purchasesConfirmed: purchases.filter((p) => p.status === 'purchase_confirmed').length,
      purchasesPending: purchases.filter((p) => p.status === 'proof_received').length,
      conversionRate
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
  const client = db.data.clients.find((c) => c.id === req.params.id && c.agencyId === agencyId(req));
  if (!client) return res.status(404).json({ error: 'Cliente no encontrado.' });
  await db.remove('clients', client.id);
  res.json({ ok: true });
});

agencyRouter.get('/projects', ensureAgencyActive, (req, res) => {
  const projects = db.data.projects
    .filter((p) => p.agencyId === agencyId(req))
    .map(omitSensitiveProject);
  res.json({ projects });
});

agencyRouter.post('/projects', ensureAgencyActive, async (req, res) => {
  const client = db.data.clients.find((c) => c.id === req.body.clientId && c.agencyId === agencyId(req));
  if (!client) return res.status(400).json({ error: 'Seleccioná un cliente válido.' });

  const project = await db.insert('projects', {
    agencyId: agencyId(req),
    clientId: client.id,
    publicId: 'tl_' + nanoid(10),
    name: cleanString(req.body.name, 160),
    domain: cleanString(req.body.domain, 240),
    whatsappNumber: normalizePhone(req.body.whatsappNumber),
    metaPixelId: cleanString(req.body.metaPixelId, 120),
    metaCapiToken: cleanString(req.body.metaCapiToken, 500),
    metaTestEventCode: cleanString(req.body.metaTestEventCode, 120),
    status: 'active',
    createdAt: nowIso()
  });

  res.status(201).json({ project: omitSensitiveProject(project) });
});

agencyRouter.put('/projects/:id', ensureAgencyActive, async (req, res) => {
  const project = db.data.projects.find((p) => p.id === req.params.id && p.agencyId === agencyId(req));
  if (!project) return res.status(404).json({ error: 'Proyecto no encontrado.' });

  const patch = {
    name: cleanString(req.body.name ?? project.name, 160),
    domain: cleanString(req.body.domain ?? project.domain, 240),
    whatsappNumber: normalizePhone(req.body.whatsappNumber ?? project.whatsappNumber),
    metaPixelId: cleanString(req.body.metaPixelId ?? project.metaPixelId, 120),
    metaTestEventCode: cleanString(req.body.metaTestEventCode ?? project.metaTestEventCode, 120),
    status: cleanString(req.body.status ?? project.status, 50)
  };
  if (req.body.metaCapiToken && !String(req.body.metaCapiToken).includes('•')) {
    patch.metaCapiToken = cleanString(req.body.metaCapiToken, 500);
  }

  const updated = await db.update('projects', project.id, patch);
  res.json({ project: omitSensitiveProject(updated) });
});

agencyRouter.delete('/projects/:id', ensureAgencyActive, async (req, res) => {
  const project = db.data.projects.find((p) => p.id === req.params.id && p.agencyId === agencyId(req));
  if (!project) return res.status(404).json({ error: 'Proyecto no encontrado.' });
  await db.remove('projects', project.id);
  res.json({ ok: true });
});

agencyRouter.get('/preleads', ensureAgencyActive, (req, res) => {
  const aid = agencyId(req);
  const projects = db.data.projects.filter((p) => p.agencyId === aid);
  const clients = db.data.clients.filter((c) => c.agencyId === aid);
  const leads = db.data.preleads
    .filter((l) => l.agencyId === aid)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .map((lead) => ({
      ...lead,
      project: projects.find((p) => p.id === lead.projectId)?.name || 'Sin proyecto',
      client: clients.find((c) => c.id === lead.clientId)?.name || 'Sin cliente'
    }));
  res.json({ leads });
});


agencyRouter.get('/purchases', ensureAgencyActive, (req, res) => {
  const aid = agencyId(req);
  const projects = db.data.projects.filter((p) => p.agencyId === aid);
  const clients = db.data.clients.filter((c) => c.agencyId === aid);

  const purchases = db.data.purchases
    .filter((purchase) => purchase.agencyId === aid)
    .sort((a, b) => String(b.receivedAt || b.createdAt).localeCompare(String(a.receivedAt || a.createdAt)))
    .map((purchase) => ({
      ...purchase,
      project: projects.find((p) => p.id === purchase.projectId)?.name || 'Sin proyecto',
      client: clients.find((c) => c.id === purchase.clientId)?.name || 'Sin cliente'
    }));

  res.json({ purchases });
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
