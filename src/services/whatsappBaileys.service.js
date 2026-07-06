import path from 'node:path';
import fs from 'node:fs/promises';
import QRCode from 'qrcode';
import pino from 'pino';
import { nanoid } from 'nanoid';
import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  useMultiFileAuthState
} from '@whiskeysockets/baileys';
import { db } from '../lib/db.js';
import { cleanString, jidToPhone, nowIso } from '../lib/utils.js';
import { registerIncomingWhatsAppMessage } from './leadEvents.service.js';

function getDataRoot() {
  if (process.env.WHATSAPP_SESSION_DIR) return process.env.WHATSAPP_SESSION_DIR;
  const dataFile = process.env.DATA_FILE || './data/truelead-db.json';
  const dir = path.dirname(path.isAbsolute(dataFile) ? dataFile : path.resolve(process.cwd(), dataFile));
  return path.join(dir, 'whatsapp-sessions');
}

function getContentInfo(message = {}) {
  const m = message.message || {};
  const ephemeral = m.ephemeralMessage?.message || m.viewOnceMessage?.message || m.documentWithCaptionMessage?.message;
  const content = ephemeral || m;

  if (content.conversation) {
    return { text: content.conversation, type: 'text', hasMedia: false };
  }

  if (content.extendedTextMessage) {
    return { text: content.extendedTextMessage.text || '', type: 'text', hasMedia: false };
  }

  if (content.imageMessage) {
    return {
      text: content.imageMessage.caption || '',
      type: 'image',
      hasMedia: true,
      mimeType: content.imageMessage.mimetype || 'image/jpeg',
      fileName: ''
    };
  }

  if (content.documentMessage) {
    return {
      text: content.documentMessage.caption || '',
      type: 'document',
      hasMedia: true,
      mimeType: content.documentMessage.mimetype || '',
      fileName: content.documentMessage.fileName || ''
    };
  }

  if (content.videoMessage) {
    return {
      text: content.videoMessage.caption || '',
      type: 'video',
      hasMedia: true,
      mimeType: content.videoMessage.mimetype || 'video/mp4',
      fileName: ''
    };
  }

  if (content.audioMessage) {
    return {
      text: '',
      type: 'audio',
      hasMedia: true,
      mimeType: content.audioMessage.mimetype || 'audio',
      fileName: ''
    };
  }

  if (content.stickerMessage) {
    return {
      text: '',
      type: 'sticker',
      hasMedia: true,
      mimeType: content.stickerMessage.mimetype || 'image/webp',
      fileName: ''
    };
  }

  return { text: '', type: 'unknown', hasMedia: false };
}

function sessionFolderName(sessionId) {
  return String(sessionId || '').replace(/[^a-zA-Z0-9_-]/g, '_');
}

export class WhatsAppBaileysManager {
  constructor() {
    this.instances = new Map();
    this.qrWaiters = new Map();
    this.sessionRoot = getDataRoot();
  }

  async init() {
    await fs.mkdir(this.sessionRoot, { recursive: true });

    // Migration suave: sesiones viejas sin label/clientId siguen funcionando.
    for (const session of db.data.whatsappSessions || []) {
      session.label = session.label || 'WhatsApp principal';
      session.clientId = session.clientId || '';
      session.updatedAt = session.updatedAt || nowIso();
    }
    await db.save();

    if (process.env.WHATSAPP_AUTO_RESTORE === 'true') {
      const sessions = db.data.whatsappSessions.filter((session) =>
        ['connected', 'connecting', 'qr'].includes(session.status)
      );

      for (const session of sessions) {
        this.start({
          agencyId: session.agencyId,
          sessionId: session.id,
          clientId: session.clientId,
          label: session.label
        }).catch((err) => {
          console.error('[wa] restore error', session.id, err);
        });
      }
    }
  }

  listSessions(agencyId) {
    return db.data.whatsappSessions
      .filter((session) => session.agencyId === agencyId)
      .sort((a, b) => String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt)));
  }

  getSession(agencyId, sessionId = '') {
    const sessions = this.listSessions(agencyId);
    if (sessionId) {
      return sessions.find((session) => session.id === sessionId) || null;
    }
    return sessions[0] || null;
  }

  ensureSessionRecord({ agencyId, sessionId = '', clientId = '', label = '' }) {
    let session = sessionId
      ? db.data.whatsappSessions.find((s) => s.id === sessionId && s.agencyId === agencyId)
      : null;

    if (!session) {
      session = {
        id: sessionId || `wa_${nanoid(10)}`,
        agencyId,
        clientId: cleanString(clientId, 80),
        label: cleanString(label || 'WhatsApp principal', 120),
        status: 'disconnected',
        qr: null,
        qrDataUrl: null,
        number: '',
        device: '',
        lastActivityAt: null,
        lastError: '',
        createdAt: nowIso(),
        updatedAt: nowIso()
      };
      db.data.whatsappSessions.push(session);
    }

    if (clientId !== undefined && clientId !== null && String(clientId).trim()) {
      session.clientId = cleanString(clientId, 80);
    }
    if (label !== undefined && label !== null && String(label).trim()) {
      session.label = cleanString(label, 120);
    }
    session.label = session.label || 'WhatsApp principal';
    session.clientId = session.clientId || '';

    return session;
  }

  async updateSession(agencyId, sessionId, patch) {
    const session = this.ensureSessionRecord({ agencyId, sessionId });
    Object.assign(session, patch, {
      updatedAt: nowIso()
    });
    await db.save();
    return session;
  }

  async start({ agencyId, sessionId = '', clientId = '', label = '' }) {
    const sessionRecord = this.ensureSessionRecord({ agencyId, sessionId, clientId, label });
    const sid = sessionRecord.id;

    const existing = this.instances.get(sid);
    if (existing?.sock) {
      return this.getSession(agencyId, sid);
    }

    const sessionDir = path.join(this.sessionRoot, sessionFolderName(sid));
    await fs.mkdir(sessionDir, { recursive: true });
    await this.updateSession(agencyId, sid, {
      status: 'connecting',
      lastError: '',
      qr: null,
      qrDataUrl: null
    });

    const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
      version,
      auth: state,
      logger: pino({ level: process.env.WHATSAPP_LOG_LEVEL || 'silent' }),
      browser: ['TrueLead', 'Chrome', '1.0.0'],
      markOnlineOnConnect: false,
      syncFullHistory: false,
      printQRInTerminal: false
    });

    this.instances.set(sid, { sock, saveCreds, agencyId });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        const qrDataUrl = await QRCode.toDataURL(qr, {
          margin: 1,
          width: 320,
          color: {
            dark: '#030711',
            light: '#ffffff'
          }
        });

        const session = await this.updateSession(agencyId, sid, {
          status: 'qr',
          qr,
          qrDataUrl,
          lastActivityAt: nowIso()
        });

        const waiter = this.qrWaiters.get(sid);
        if (waiter) {
          waiter(session);
          this.qrWaiters.delete(sid);
        }
      }

      if (connection === 'open') {
        const number = jidToPhone(sock.user?.id || '');
        await this.updateSession(agencyId, sid, {
          status: 'connected',
          qr: null,
          qrDataUrl: null,
          number,
          device: cleanString(sock.user?.name || 'WhatsApp vinculado', 120),
          lastActivityAt: nowIso(),
          lastError: ''
        });

        const waiter = this.qrWaiters.get(sid);
        if (waiter) {
          waiter(this.getSession(agencyId, sid));
          this.qrWaiters.delete(sid);
        }
      }

      if (connection === 'close') {
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

        await this.updateSession(agencyId, sid, {
          status: shouldReconnect ? 'disconnected' : 'logged_out',
          qr: null,
          qrDataUrl: null,
          lastError: cleanString(lastDisconnect?.error?.message || 'Conexión cerrada.', 400),
          lastActivityAt: nowIso()
        });

        this.instances.delete(sid);

        if (shouldReconnect && process.env.WHATSAPP_DISABLE_RECONNECT !== 'true') {
          setTimeout(() => {
            this.start({ agencyId, sessionId: sid }).catch((err) => console.error('[wa] reconnect error', err));
          }, 5000);
        }
      }
    });

    sock.ev.on('messages.upsert', async ({ messages = [], type }) => {
      if (type !== 'notify') return;

      for (const message of messages) {
        await this.handleMessage(sessionRecord, message);
      }
    });

    const session = await new Promise((resolve) => {
      const timeout = setTimeout(() => {
        this.qrWaiters.delete(sid);
        resolve(this.getSession(agencyId, sid));
      }, Number(process.env.WHATSAPP_QR_WAIT_MS || 25000));

      this.qrWaiters.set(sid, (currentSession) => {
        clearTimeout(timeout);
        resolve(currentSession);
      });
    });

    return session;
  }

  async handleMessage(session, message) {
    try {
      if (!message?.message) return null;
      if (message.key?.fromMe) return null;
      if (message.key?.remoteJid?.endsWith('@g.us')) return null;

      const from = jidToPhone(message.key?.remoteJid || '');
      const content = getContentInfo(message);

      if (!content.text && !content.hasMedia) return null;

      const result = await registerIncomingWhatsAppMessage({
        agencyId: session.agencyId,
        clientId: session.clientId || '',
        whatsappSessionId: session.id,
        messageId: message.key?.id || '',
        from,
        text: content.text || '',
        messageType: content.type || 'unknown',
        mimeType: content.mimeType || '',
        fileName: content.fileName || '',
        hasMedia: Boolean(content.hasMedia),
        source: 'baileys'
      });

      await this.updateSession(session.agencyId, session.id, {
        lastActivityAt: nowIso()
      });

      return result;
    } catch (err) {
      console.error('[wa] message handler error', err);
      await this.updateSession(session.agencyId, session.id, {
        lastError: cleanString(err.message || String(err), 400)
      });
      return null;
    }
  }

  async disconnect(agencyId, sessionId = '') {
    const session = this.getSession(agencyId, sessionId);
    if (!session) return null;

    const instance = this.instances.get(session.id);
    if (instance?.sock) {
      try {
        await instance.sock.logout();
      } catch {}
      try {
        instance.sock.end?.();
      } catch {}
    }

    this.instances.delete(session.id);

    return this.updateSession(agencyId, session.id, {
      status: 'disconnected',
      qr: null,
      qrDataUrl: null,
      lastActivityAt: nowIso()
    });
  }

  async resetSession(agencyId, sessionId = '') {
    const session = this.getSession(agencyId, sessionId);
    if (!session) return null;

    await this.disconnect(agencyId, session.id);
    await fs.rm(path.join(this.sessionRoot, sessionFolderName(session.id)), { recursive: true, force: true });
    return this.updateSession(agencyId, session.id, {
      status: 'disconnected',
      qr: null,
      qrDataUrl: null,
      number: '',
      device: '',
      lastError: 'Sesión reseteada.',
      lastActivityAt: nowIso()
    });
  }
}

export const whatsappManager = new WhatsAppBaileysManager();
