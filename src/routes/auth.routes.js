import express from 'express';
import bcrypt from 'bcryptjs';
import { nanoid } from 'nanoid';
import { db } from '../lib/db.js';
import { cleanString, nowIso, addDays } from '../lib/utils.js';
import { signToken, requireAuth } from '../middleware/auth.js';
import { notifyRegistrationPending } from '../services/email.service.js';

export const authRouter = express.Router();

function publicUser(user) {
  if (!user) return null;
  const { passwordHash, ...safe } = user;
  const agency = db.data.agencies.find((a) => a.id === user.agencyId);
  return { ...safe, agency };
}

authRouter.post('/register', async (req, res) => {
  const name = cleanString(req.body.name, 120);
  const email = cleanString(req.body.email, 180).toLowerCase();
  const password = String(req.body.password || '');
  const agencyName = cleanString(req.body.agencyName || req.body.name, 160);

  if (!name || !email || password.length < 8 || !agencyName) {
    return res.status(400).json({ error: 'Completá nombre, agencia, email y contraseña de al menos 8 caracteres.' });
  }

  if (db.data.users.some((u) => u.email === email)) {
    return res.status(409).json({ error: 'Ese email ya está registrado.' });
  }

  const agencyId = nanoid(12);
  const userId = nanoid(12);
  const passwordHash = await bcrypt.hash(password, 10);

  db.data.agencies.push({
    id: agencyId,
    name: agencyName,
    status: 'pending',
    plan: 'starter',
    planStatus: 'pending_validation',
    createdAt: nowIso(),
    activatedAt: null,
    expiresAt: addDays(new Date(), 7),
    notes: 'Cuenta pendiente de validación administrativa.'
  });

  db.data.users.push({
    id: userId,
    agencyId,
    name,
    email,
    passwordHash,
    role: 'agency',
    status: 'pending',
    createdAt: nowIso(),
    lastLoginAt: null
  });

  db.data.payments.push({
    id: nanoid(12),
    agencyId,
    amount: 0,
    currency: 'ARS',
    plan: 'starter',
    status: 'pending',
    method: 'manual',
    notes: 'Alta inicial pendiente de validación.',
    createdAt: nowIso(),
    updatedAt: nowIso()
  });

  await db.save();

  const agency = db.data.agencies.find((a) => a.id === agencyId);
  const createdUser = db.data.users.find((u) => u.id === userId);
  notifyRegistrationPending({ agency, user: createdUser }).catch((error) => {
    console.warn('[email] registration notification failed:', error.message);
  });

  return res.status(201).json({
    ok: true,
    message: 'Cuenta creada. Queda pendiente de validación administrativa.',
    user: publicUser(db.data.users.find((u) => u.id === userId))
  });
});

authRouter.post('/login', async (req, res) => {
  const email = cleanString(req.body.email, 180).toLowerCase();
  const password = String(req.body.password || '');

  const user = db.data.users.find((u) => u.email === email);
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    return res.status(401).json({ error: 'Email o contraseña incorrectos.' });
  }

  if (user.status === 'suspended') {
    return res.status(403).json({ error: 'Tu cuenta está suspendida. Contactá soporte.' });
  }

  user.lastLoginAt = nowIso();
  await db.save();

  return res.json({
    ok: true,
    token: signToken(user),
    user: publicUser(user)
  });
});

authRouter.get('/me', requireAuth, (req, res) => {
  const user = db.data.users.find((u) => u.id === req.auth.sub);
  return res.json({ user: publicUser(user) });
});
