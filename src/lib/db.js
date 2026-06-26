import fs from 'node:fs/promises';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import { nanoid } from 'nanoid';
import { nowIso, addDays } from './utils.js';

const DEFAULT_DATA = {
  users: [],
  agencies: [],
  clients: [],
  projects: [],
  preleads: [],
  payments: [],
  whatsappSessions: [],
  whatsappMessages: [],
  purchases: [],
  events: [],
  settings: {
    createdAt: nowIso(),
    schemaVersion: 1
  }
};

function getDataFilePath() {
  const configured = process.env.DATA_FILE || './data/truelead-db.json';
  return path.isAbsolute(configured)
    ? configured
    : path.resolve(process.cwd(), configured);
}

export class JsonDB {
  constructor() {
    this.filePath = getDataFilePath();
    this.data = null;
    this.writeQueue = Promise.resolve();
  }

  async init() {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    try {
      const raw = await fs.readFile(this.filePath, 'utf8');
      this.data = { ...DEFAULT_DATA, ...JSON.parse(raw) };
    } catch {
      this.data = structuredClone(DEFAULT_DATA);
      await this.save();
    }
    await this.ensureAdmin();
    return this;
  }

  async ensureAdmin() {
    const email = (process.env.ADMIN_EMAIL || 'admin@truelead.local').toLowerCase();
    const existing = this.data.users.find((u) => u.email === email);
    if (existing) return existing;

    const adminAgencyId = nanoid(12);
    const adminUserId = nanoid(12);
    const password = process.env.ADMIN_PASSWORD || 'TrueLeadAdmin123!';
    const passwordHash = await bcrypt.hash(password, 10);

    this.data.agencies.push({
      id: adminAgencyId,
      name: 'TrueLead Admin',
      status: 'active',
      plan: 'agency',
      planStatus: 'active',
      createdAt: nowIso(),
      activatedAt: nowIso(),
      expiresAt: addDays(new Date(), 3650),
      notes: 'Cuenta administradora inicial.'
    });

    this.data.users.push({
      id: adminUserId,
      agencyId: adminAgencyId,
      name: process.env.ADMIN_NAME || 'Admin',
      email,
      passwordHash,
      role: 'admin',
      status: 'active',
      createdAt: nowIso(),
      lastLoginAt: null
    });

    await this.save();
    return this.data.users.find((u) => u.id === adminUserId);
  }

  async save() {
    const payload = JSON.stringify(this.data, null, 2);
    this.writeQueue = this.writeQueue.then(async () => {
      await fs.writeFile(this.filePath, payload, 'utf8');
    });
    return this.writeQueue;
  }

  collection(name) {
    if (!this.data[name]) this.data[name] = [];
    return this.data[name];
  }

  async insert(name, record) {
    const item = {
      id: record.id || nanoid(12),
      createdAt: record.createdAt || nowIso(),
      updatedAt: nowIso(),
      ...record
    };
    this.collection(name).push(item);
    await this.save();
    return item;
  }

  async update(name, id, patch) {
    const list = this.collection(name);
    const index = list.findIndex((item) => item.id === id);
    if (index === -1) return null;
    list[index] = {
      ...list[index],
      ...patch,
      updatedAt: nowIso()
    };
    await this.save();
    return list[index];
  }

  async remove(name, id) {
    const list = this.collection(name);
    const index = list.findIndex((item) => item.id === id);
    if (index === -1) return false;
    list.splice(index, 1);
    await this.save();
    return true;
  }
}

export const db = new JsonDB();
