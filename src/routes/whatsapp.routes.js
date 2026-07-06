import express from 'express';
import { db } from '../lib/db.js';
import { cleanString } from '../lib/utils.js';
import { requireAuth } from '../middleware/auth.js';

export const whatsappRouter = express.Router();

whatsappRouter.use(requireAuth);

function getManager(req) {
  return req.app.locals.whatsappManager;
}

function getClientName(agencyId, clientId) {
  return db.data.clients.find((client) => client.id === clientId && client.agencyId === agencyId)?.name || '';
}

function enrichSession(req, session) {
  if (!session) return null;
  return {
    ...session,
    client: getClientName(req.auth.agencyId, session.clientId)
  };
}

whatsappRouter.get('/sessions', async (req, res) => {
  const sessions = getManager(req)
    .listSessions(req.auth.agencyId)
    .map((session) => enrichSession(req, session));

  res.json({ sessions });
});

whatsappRouter.get('/status', async (req, res) => {
  const session = getManager(req).getSession(req.auth.agencyId, req.query.sessionId || '');
  res.json({ session: enrichSession(req, session) });
});

whatsappRouter.post('/request-qr', async (req, res) => {
  try {
    const clientId = cleanString(req.body.clientId, 80);
    const label = cleanString(req.body.label || 'WhatsApp principal', 120);
    const sessionId = cleanString(req.body.sessionId, 80);

    if (!sessionId) {
      const client = db.data.clients.find((c) => c.id === clientId && c.agencyId === req.auth.agencyId);
      if (!client) {
        return res.status(400).json({ error: 'Seleccioná un cliente válido para vincular este WhatsApp.' });
      }
    }

    const session = await getManager(req).start({
      agencyId: req.auth.agencyId,
      sessionId,
      clientId,
      label
    });

    res.json({
      session: enrichSession(req, session),
      message: session?.status === 'connected'
        ? 'WhatsApp ya está conectado.'
        : 'QR real generado. Escanealo desde WhatsApp > Dispositivos vinculados.'
    });
  } catch (err) {
    res.status(500).json({
      error: err.message || 'No se pudo iniciar la vinculación de WhatsApp.'
    });
  }
});

whatsappRouter.post('/reconnect', async (req, res) => {
  try {
    const sessionId = cleanString(req.body.sessionId || req.query.sessionId, 80);
    if (!sessionId) return res.status(400).json({ error: 'Falta sessionId.' });

    const existing = getManager(req).getSession(req.auth.agencyId, sessionId);
    if (!existing) return res.status(404).json({ error: 'WhatsApp vinculado no encontrado.' });

    const session = await getManager(req).start({
      agencyId: req.auth.agencyId,
      sessionId,
      clientId: existing.clientId,
      label: existing.label
    });

    res.json({ session: enrichSession(req, session) });
  } catch (err) {
    res.status(500).json({ error: err.message || 'No se pudo reconectar WhatsApp.' });
  }
});

whatsappRouter.post('/disconnect', async (req, res) => {
  try {
    const sessionId = cleanString(req.body.sessionId || req.query.sessionId, 80);
    if (!sessionId) return res.status(400).json({ error: 'Falta sessionId.' });

    const session = await getManager(req).disconnect(req.auth.agencyId, sessionId);
    if (!session) return res.status(404).json({ error: 'WhatsApp vinculado no encontrado.' });

    res.json({ session: enrichSession(req, session) });
  } catch (err) {
    res.status(500).json({ error: err.message || 'No se pudo desconectar WhatsApp.' });
  }
});

whatsappRouter.post('/reset', async (req, res) => {
  try {
    const sessionId = cleanString(req.body.sessionId || req.query.sessionId, 80);
    if (!sessionId) return res.status(400).json({ error: 'Falta sessionId.' });

    const session = await getManager(req).resetSession(req.auth.agencyId, sessionId);
    if (!session) return res.status(404).json({ error: 'WhatsApp vinculado no encontrado.' });

    res.json({
      session: enrichSession(req, session),
      message: 'Sesión eliminada. Podés generar un nuevo QR.'
    });
  } catch (err) {
    res.status(500).json({ error: err.message || 'No se pudo resetear la sesión.' });
  }
});

/*
  Solo para pruebas del panel, se puede desactivar con:
  WHATSAPP_ALLOW_DEMO_CONNECT=false
*/
whatsappRouter.post('/mark-connected', async (req, res) => {
  if (process.env.WHATSAPP_ALLOW_DEMO_CONNECT === 'false') {
    return res.status(403).json({ error: 'La conexión demo está desactivada.' });
  }

  const sessionId = cleanString(req.body.sessionId || req.query.sessionId, 80);
  if (!sessionId) return res.status(400).json({ error: 'Falta sessionId.' });

  const session = await getManager(req).updateSession(req.auth.agencyId, sessionId, {
    status: 'connected',
    number: req.body.number || '+54 11 0000 0000',
    device: req.body.device || 'Demo browser',
    lastError: '',
    qr: null,
    qrDataUrl: null
  });

  res.json({ session: enrichSession(req, session) });
});
