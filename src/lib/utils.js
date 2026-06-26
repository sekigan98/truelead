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

export function publicCode(prefix = 'TL', length = 6) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < length; i++) {
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


export function startOfDay(date = new Date()) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function endOfDay(date = new Date()) {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

export function parseDateRange(query = {}) {
  const range = String(query.range || 'month');
  const now = new Date();
  let from;
  let to = endOfDay(now);

  if (range === 'today') {
    from = startOfDay(now);
  } else if (range === 'week') {
    from = startOfDay(now);
    from.setDate(from.getDate() - 6);
  } else if (range === 'custom') {
    from = query.from ? startOfDay(new Date(query.from)) : startOfDay(now);
    to = query.to ? endOfDay(new Date(query.to)) : endOfDay(now);
  } else if (range === 'all') {
    from = new Date('2020-01-01T00:00:00.000Z');
  } else {
    from = startOfDay(now);
    from.setDate(from.getDate() - 29);
  }

  if (Number.isNaN(from.getTime())) from = startOfDay(now);
  if (Number.isNaN(to.getTime())) to = endOfDay(now);

  return {
    range,
    from: from.toISOString(),
    to: to.toISOString()
  };
}

export function isBetweenDates(value, fromIso, toIso) {
  if (!value) return false;
  const time = new Date(value).getTime();
  const from = new Date(fromIso).getTime();
  const to = new Date(toIso).getTime();
  if (Number.isNaN(time) || Number.isNaN(from) || Number.isNaN(to)) return false;
  return time >= from && time <= to;
}
