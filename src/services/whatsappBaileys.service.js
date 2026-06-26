import path from 'node:path';
import fs from 'node:fs/promises';
import QRCode from 'qrcode';
import pino from 'pino';
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

function ensureSessionRecord(agencyId) {
  let session = db.data.whatsappSessions.find((s) => s.agencyId === agencyId);
  if (!session) {
    session = {
      id: `wa_${agencyId}`,
      agencyId,
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
  return session;
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

export class WhatsAppBaileysManager {
  constructor() {
    this.instances = new Map();
    this.qrWaiters = new Map();
    this.sessionRoot = getDataRoot();
  }

  async init() {
    await fs.mkdir(this.sessionRoot, { recursive: true });

    if (process.env.WHATSAPP_AUTO_RESTORE === 'true') {
      const sessions = db.data.whatsappSessions.filter((session) =>
        ['connected', 'connecting', 'qr'].includes(session.status)
      );

      for (const session of sessions) {
        this.start(session.agencyId).catch((err) => {
          console.error('[wa] restore error', session.agencyId, err);
        });
      }
    }
  }

  getSession(agencyId) {
    return ensureSessionRecord(agencyId);
  }

  async updateSession(agencyId, patch) {
    const session = ensureSessionRecord(agencyId);
    Object.assign(session, patch, {
      updatedAt: nowIso()
    });
    await db.save();
    return session;
  }

  async start(agencyId) {
    const existing = this.instances.get(agencyId);
    if (existing?.sock) {
      return this.getSession(agencyId);
    }

    await fs.mkdir(path.join(this.sessionRoot, agencyId), { recursive: true });
    await this.updateSession(agencyId, {
      status: 'connecting',
      lastError: '',
      qr: null,
      qrDataUrl: null
    });

    const { state, saveCreds } = await useMultiFileAuthState(path.join(this.sessionRoot, agencyId));
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

    this.instances.set(agencyId, { sock, saveCreds });

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

        const session = await this.updateSession(agencyId, {
          status: 'qr',
          qr,
          qrDataUrl,
          lastActivityAt: nowIso()
        });

        const waiter = this.qrWaiters.get(agencyId);
        if (waiter) {
          waiter(session);
          this.qrWaiters.delete(agencyId);
        }
      }

      if (connection === 'open') {
        const number = jidToPhone(sock.user?.id || '');
        await this.updateSession(agencyId, {
          status: 'connected',
          qr: null,
          qrDataUrl: null,
          number,
          device: cleanString(sock.user?.name || 'WhatsApp vinculado', 120),
          lastActivityAt: nowIso(),
          lastError: ''
        });

        const waiter = this.qrWaiters.get(agencyId);
        if (waiter) {
          waiter(this.getSession(agencyId));
          this.qrWaiters.delete(agencyId);
        }
      }

      if (connection === 'close') {
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

        await this.updateSession(agencyId, {
          status: shouldReconnect ? 'disconnected' : 'logged_out',
          qr: null,
          qrDataUrl: null,
          lastError: cleanString(lastDisconnect?.error?.message || 'Conexión cerrada.', 400),
          lastActivityAt: nowIso()
        });

        this.instances.delete(agencyId);

        if (shouldReconnect && process.env.WHATSAPP_DISABLE_RECONNECT !== 'true') {
          setTimeout(() => {
            this.start(agencyId).catch((err) => console.error('[wa] reconnect error', err));
          }, 5000);
        }
      }
    });

    sock.ev.on('messages.upsert', async ({ messages = [], type }) => {
      if (type !== 'notify') return;

      for (const message of messages) {
        await this.handleMessage(agencyId, message);
      }
    });

    const session = await new Promise((resolve) => {
      const timeout = setTimeout(() => {
        this.qrWaiters.delete(agencyId);
        resolve(this.getSession(agencyId));
      }, Number(process.env.WHATSAPP_QR_WAIT_MS || 25000));

      this.qrWaiters.set(agencyId, (session) => {
        clearTimeout(timeout);
        resolve(session);
      });
    });

    return session;
  }

  async handleMessage(agencyId, message) {
    try {
      if (!message?.message) return null;
      if (message.key?.fromMe) return null;
      if (message.key?.remoteJid?.endsWith('@g.us')) return null;

      const from = jidToPhone(message.key?.remoteJid || '');
      const content = getContentInfo(message);

      if (!content.text && !content.hasMedia) return null;

      const result = await registerIncomingWhatsAppMessage({
        agencyId,
        messageId: message.key?.id || '',
        from,
        text: content.text || '',
        messageType: content.type || 'unknown',
        mimeType: content.mimeType || '',
        fileName: content.fileName || '',
        hasMedia: Boolean(content.hasMedia),
        source: 'baileys'
      });

      await this.updateSession(agencyId, {
        lastActivityAt: nowIso()
      });

      return result;
    } catch (err) {
      console.error('[wa] message handler error', err);
      await this.updateSession(agencyId, {
        lastError: cleanString(err.message || String(err), 400)
      });
      return null;
    }
  }

  async disconnect(agencyId) {
    const instance = this.instances.get(agencyId);
    if (instance?.sock) {
      try {
        await instance.sock.logout();
      } catch {}
      try {
        instance.sock.end?.();
      } catch {}
    }

    this.instances.delete(agencyId);

    return this.updateSession(agencyId, {
      status: 'disconnected',
      qr: null,
      qrDataUrl: null,
      lastActivityAt: nowIso()
    });
  }

  async resetSession(agencyId) {
    await this.disconnect(agencyId);
    await fs.rm(path.join(this.sessionRoot, agencyId), { recursive: true, force: true });
    return this.updateSession(agencyId, {
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
