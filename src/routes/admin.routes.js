import express from 'express';
import { nanoid } from 'nanoid';
import { db } from '../lib/db.js';
import { cleanString, nowIso, addDays } from '../lib/utils.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { getPricingForRequest, getPlanById } from '../lib/pricing.js';

export const adminRouter = express.Router();

adminRouter.use(requireAuth, requireAdmin);

function publicUser(user) {
  const { passwordHash, ...safe } = user;
  return safe;
}

adminRouter.get('/pricing', (req, res) => {
  res.json(getPricingForRequest(req));
});


adminRouter.get('/overview', (req, res) => {
  const agencies = db.data.agencies;
  const users = db.data.users;
  const leads = db.data.preleads;
  const payments = db.data.payments;
  const purchases = db.data.purchases;
  res.json({
    metrics: {
      agencies: agencies.length,
      activeAgencies: agencies.filter((a) => a.status === 'active').length,
      pendingAgencies: agencies.filter((a) => a.status === 'pending').length,
      users: users.length,
      leads: leads.length,
      confirmedLeads: leads.filter((l) => l.status === 'confirmed' || l.status === 'sent_to_meta').length,
      paymentsPending: payments.filter((p) => p.status === 'pending').length,
      paymentProofs: purchases.length,
      purchasesPending: purchases.filter((p) => p.status === 'proof_received').length,
      purchasesConfirmed: purchases.filter((p) => p.status === 'purchase_confirmed').length
    },
    recentEvents: [...db.data.events].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, 30)
  });
});

adminRouter.get('/agencies', (req, res) => {
  const agencies = db.data.agencies.map((agency) => {
    const users = db.data.users.filter((u) => u.agencyId === agency.id).map(publicUser);
    const payments = db.data.payments.filter((p) => p.agencyId === agency.id);
    const projects = db.data.projects.filter((p) => p.agencyId === agency.id);
    const leads = db.data.preleads.filter((l) => l.agencyId === agency.id);
    return {
      ...agency,
      users,
      payments,
      projectsCount: projects.length,
      leadsCount: leads.length
    };
  });
  res.json({ agencies });
});

adminRouter.patch('/agencies/:id/status', async (req, res) => {
  const agency = db.data.agencies.find((a) => a.id === req.params.id);
  if (!agency) return res.status(404).json({ error: 'Agencia no encontrada.' });

  const status = cleanString(req.body.status, 40);
  if (!['active', 'pending', 'suspended'].includes(status)) {
    return res.status(400).json({ error: 'Estado inválido.' });
  }

  const patch = {
    status,
    planStatus: status === 'active' ? 'active' : agency.planStatus,
    activatedAt: status === 'active' ? (agency.activatedAt || nowIso()) : agency.activatedAt
  };

  const updated = await db.update('agencies', agency.id, patch);

  for (const user of db.data.users.filter((u) => u.agencyId === agency.id && u.role !== 'admin')) {
    user.status = status === 'active' ? 'active' : status;
  }
  await db.save();

  res.json({ agency: updated });
});

adminRouter.post('/agencies/:id/payments', async (req, res) => {
  const agency = db.data.agencies.find((a) => a.id === req.params.id);
  if (!agency) return res.status(404).json({ error: 'Agencia no encontrada.' });

  const payment = await db.insert('payments', {
    id: nanoid(12),
    agencyId: agency.id,
    amount: Number(req.body.amount || 0),
    currency: cleanString(req.body.currency || 'ARS', 10),
    plan: cleanString(req.body.plan || agency.plan || 'pro', 50),
    status: cleanString(req.body.status || 'pending', 30),
    method: cleanString(req.body.method || 'manual', 60),
    notes: cleanString(req.body.notes, 1000),
    periodStart: req.body.periodStart || nowIso(),
    periodEnd: req.body.periodEnd || addDays(new Date(), 30),
    createdAt: nowIso()
  });

  res.status(201).json({ payment });
});

adminRouter.patch('/payments/:id/validate', async (req, res) => {
  const payment = db.data.payments.find((p) => p.id === req.params.id);
  if (!payment) return res.status(404).json({ error: 'Pago no encontrado.' });

  const status = cleanString(req.body.status || 'approved', 30);
  if (!['approved', 'rejected', 'pending'].includes(status)) {
    return res.status(400).json({ error: 'Estado inválido.' });
  }

  const updatedPayment = await db.update('payments', payment.id, {
    status,
    approvedAt: status === 'approved' ? nowIso() : null,
    adminNotes: cleanString(req.body.adminNotes, 1000)
  });

  if (status === 'approved') {
    const agency = db.data.agencies.find((a) => a.id === payment.agencyId);
    if (agency) {
      agency.status = 'active';
      agency.planStatus = 'active';
      agency.plan = payment.plan || agency.plan;
      agency.activatedAt = agency.activatedAt || nowIso();
      agency.expiresAt = payment.periodEnd || agency.expiresAt || addDays(new Date(), 30);

      for (const user of db.data.users.filter((u) => u.agencyId === agency.id && u.role !== 'admin')) {
        user.status = 'active';
      }
    }
    await db.save();
  }

  res.json({ payment: updatedPayment });
});


adminRouter.patch('/agencies/:id/plan', async (req, res) => {
  const agency = db.data.agencies.find((a) => a.id === req.params.id);
  if (!agency) return res.status(404).json({ error: 'Agencia no encontrada.' });

  const planId = cleanString(req.body.plan || agency.plan || 'starter', 40);
  const plan = getPlanById(planId);
  const expiresAt = cleanString(req.body.expiresAt || agency.expiresAt || addDays(new Date(), 30), 80);
  const planStatus = cleanString(req.body.planStatus || agency.planStatus || 'active', 60);

  const updated = await db.update('agencies', agency.id, {
    plan: plan.id,
    planStatus,
    expiresAt,
    status: req.body.activate === false ? agency.status : 'active',
    activatedAt: agency.activatedAt || nowIso()
  });

  for (const user of db.data.users.filter((u) => u.agencyId === agency.id && u.role !== 'admin')) {
    if (updated.status === 'active') user.status = 'active';
  }

  db.data.events.push({
    id: `ev_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    agencyId: agency.id,
    type: 'plan_updated',
    message: `Plan actualizado a ${plan.name} para ${agency.name}.`,
    createdAt: nowIso()
  });

  await db.save();
  res.json({ agency: updated, plan });
});

adminRouter.get('/users', (req, res) => {
  res.json({ users: db.data.users.map(publicUser) });
});
