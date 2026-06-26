import express from 'express';
import { requireAuth } from '../middleware/auth.js';

export const whatsappRouter = express.Router();

whatsappRouter.use(requireAuth);

function getManager(req) {
  return req.app.locals.whatsappManager;
}

whatsappRouter.get('/status', async (req, res) => {
  const session = getManager(req).getSession(req.auth.agencyId);
  res.json({ session });
});

whatsappRouter.post('/request-qr', async (req, res) => {
  try {
    const session = await getManager(req).start(req.auth.agencyId);
    res.json({
      session,
      message: session.status === 'connected'
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
    const session = await getManager(req).start(req.auth.agencyId);
    res.json({ session });
  } catch (err) {
    res.status(500).json({ error: err.message || 'No se pudo reconectar WhatsApp.' });
  }
});

whatsappRouter.post('/disconnect', async (req, res) => {
  try {
    const session = await getManager(req).disconnect(req.auth.agencyId);
    res.json({ session });
  } catch (err) {
    res.status(500).json({ error: err.message || 'No se pudo desconectar WhatsApp.' });
  }
});

whatsappRouter.post('/reset', async (req, res) => {
  try {
    const session = await getManager(req).resetSession(req.auth.agencyId);
    res.json({
      session,
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

  const session = await getManager(req).updateSession(req.auth.agencyId, {
    status: 'connected',
    number: req.body.number || '+54 11 0000 0000',
    device: req.body.device || 'Demo browser',
    lastError: '',
    qr: null,
    qrDataUrl: null
  });

  res.json({ session });
});
