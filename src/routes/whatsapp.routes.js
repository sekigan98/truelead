import express from 'express';
import { db } from '../lib/db.js';
import { cleanString, nowIso } from '../lib/utils.js';
import { requireAuth } from '../middleware/auth.js';

export const whatsappRouter = express.Router();

whatsappRouter.use(requireAuth);

function sessionFor(req) {
  let session = db.data.whatsappSessions.find((s) => s.agencyId === req.auth.agencyId);
  if (!session) {
    session = {
      id: `wa_${req.auth.agencyId}`,
      agencyId: req.auth.agencyId,
      status: 'disconnected',
      qr: null,
      number: '',
      device: '',
      lastActivityAt: null,
      createdAt: nowIso(),
      updatedAt: nowIso()
    };
    db.data.whatsappSessions.push(session);
  }
  return session;
}

whatsappRouter.get('/status', async (req, res) => {
  const session = sessionFor(req);
  await db.save();
  res.json({ session });
});

whatsappRouter.post('/request-qr', async (req, res) => {
  const session = sessionFor(req);
  session.status = 'waiting_qr';
  session.qr = `TRUELEAD-DEMO-QR-${Date.now()}`;
  session.updatedAt = nowIso();
  session.lastActivityAt = nowIso();
  await db.save();

  res.json({
    session,
    message: 'QR de demostración generado. La conexión real por WhatsApp se integra en el worker del siguiente paso.'
  });
});

whatsappRouter.post('/mark-connected', async (req, res) => {
  const session = sessionFor(req);
  session.status = 'connected';
  session.number = cleanString(req.body.number || '+54 11 0000 0000', 80);
  session.device = cleanString(req.body.device || 'Dispositivo vinculado', 120);
  session.lastActivityAt = nowIso();
  session.updatedAt = nowIso();
  await db.save();
  res.json({ session });
});

whatsappRouter.post('/disconnect', async (req, res) => {
  const session = sessionFor(req);
  session.status = 'disconnected';
  session.qr = null;
  session.updatedAt = nowIso();
  await db.save();
  res.json({ session });
});
