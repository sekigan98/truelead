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

export function isWhatsAppLidJid(value) {
  return /@lid(?:$|[:?&\s])/i.test(String(value || '').trim());
}

export function jidToLid(value) {
  const raw = String(value ?? '').trim();
  if (!raw || !isWhatsAppLidJid(raw)) return '';
  return raw.split('@')[0].split(':')[0].replace(/[^0-9A-Za-z._-]/g, '');
}

export function isLikelyWhatsAppLidNumber(value) {
  const digits = normalizePhone(value);
  if (!digits) return false;

  // Los LID de WhatsApp son identificadores opacos, no teléfonos. En Baileys
  // pueden llegar como 162882893422688@lid y si se normalizan como teléfono
  // terminan contaminando leads/exportaciones. Para Argentina aceptamos móviles
  // reales 549 + 10 dígitos y rechazamos IDs opacos largos.
  if (/^549\d{10}$/.test(digits)) return false;
  if (/^54\d{8,12}$/.test(digits) && digits.length <= 13) return false;
  return digits.length >= 15;
}

export function normalizeLeadPhone(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  if (isWhatsAppLidJid(raw)) return '';
  const digits = normalizeWhatsAppNumber(raw);
  if (isLikelyWhatsAppLidNumber(digits)) return '';
  return digits;
}

export function normalizeWhatsAppNumber(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';

  // Baileys devuelve el JID propio con suffix de dispositivo, por ejemplo:
  // 5491124649559:2@s.whatsapp.net. Para abrir wa.me solo sirve el número
  // antes de ':'; si se normaliza todo junto queda mal: 54911246495592.
  const localPart = raw.split('@')[0] || raw;
  const withoutDeviceSuffix = localPart.split(':')[0];
  let digits = normalizePhone(withoutDeviceSuffix);

  // Reparación conservadora para sesiones ya guardadas con el bug anterior
  // en números móviles argentinos: 54 + 9 + 10 dígitos = 13 dígitos.
  // Si quedó 549 + 11 dígitos, normalmente el último es el device id de Baileys.
  if (/^549\d{11}$/.test(digits)) {
    digits = digits.slice(0, -1);
  }

  return digits;
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


export function normalizeOrigin(value) {
  const raw = cleanString(value, 500);
  if (!raw) return '';

  try {
    const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    const url = new URL(withProtocol);
    return url.origin.toLowerCase();
  } catch {
    return '';
  }
}

export function normalizeHostname(value) {
  const origin = normalizeOrigin(value);
  if (!origin) return '';
  try {
    return new URL(origin).hostname.toLowerCase();
  } catch {
    return '';
  }
}

export function parseAuthorizedDomains(value) {
  return String(value || '')
    .split(/[\s,;]+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .map((raw) => {
      const normalizedRaw = raw.replace(/\/+$/, '');
      const isWildcard = normalizedRaw.includes('*.');
      const origin = normalizeOrigin(normalizedRaw.replace('*.', ''));
      const hostname = normalizeHostname(normalizedRaw.replace('*.', ''));
      return {
        raw: normalizedRaw,
        origin,
        hostname,
        wildcard: isWildcard
      };
    })
    .filter((item) => item.origin && item.hostname);
}

export function normalizeAuthorizedDomains(value) {
  const domains = parseAuthorizedDomains(value);
  const seen = new Set();
  const out = [];

  for (const domain of domains) {
    const key = domain.wildcard ? `*.${domain.hostname}` : domain.origin;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(domain.wildcard ? `*.${domain.hostname}` : domain.origin);
  }

  return out.join('\n');
}

export function originMatchesAuthorizedDomains(originValue, allowedValue) {
  const origin = normalizeOrigin(originValue);
  if (!origin) return false;

  let url;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }

  const allowed = parseAuthorizedDomains(allowedValue);
  return allowed.some((item) => {
    if (item.wildcard) {
      return url.hostname === item.hostname || url.hostname.endsWith(`.${item.hostname}`);
    }
    return item.origin === origin;
  });
}


export function jidToPhone(jid) {
  return normalizeLeadPhone(jid);
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
