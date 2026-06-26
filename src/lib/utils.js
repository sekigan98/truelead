import crypto from 'node:crypto';

export function nowIso() {
  return new Date().toISOString();
}

export function cleanString(value, max = 500) {
  return String(value ?? '').trim().slice(0, max);
}

export function normalizePhone(value) {
  return String(value ?? '').replace(/\D/g, '');
}

export function sha256(value) {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (!normalized) return undefined;
  return crypto.createHash('sha256').update(normalized).digest('hex');
}

export function publicCode(prefix = 'TL') {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 5; i++) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return `${prefix}-${out}`;
}

export function safeJson(value) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return value;
  }
}

export function omitSensitiveProject(project = {}) {
  const copy = { ...project };
  if (copy.metaCapiToken) copy.metaCapiToken = '••••••••••••';
  return copy;
}

export function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded) {
    return forwarded.split(',')[0].trim();
  }
  return req.socket?.remoteAddress || '';
}

export function extractLeadCode(text) {
  const match = String(text || '').match(/\bTL-[A-Z0-9]{5,10}\b/i);
  return match ? match[0].toUpperCase() : null;
}

export function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d.toISOString();
}


export function jidToPhone(jid) {
  const raw = String(jid || '').split('@')[0];
  return normalizePhone(raw);
}

export function shortHashLabel(hashOrPhone) {
  const value = String(hashOrPhone || '');
  if (!value) return '';
  return value.slice(-8);
}
