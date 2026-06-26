import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from './lib/db.js';
import { authRouter } from './routes/auth.routes.js';
import { agencyRouter } from './routes/agency.routes.js';
import { preleadRouter } from './routes/prelead.routes.js';
import { adminRouter } from './routes/admin.routes.js';
import { whatsappRouter } from './routes/whatsapp.routes.js';
import { whatsappManager } from './services/whatsappBaileys.service.js';
import { publicRouter } from './routes/public.routes.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const frontendDir = path.join(rootDir, 'frontend');

const app = express();
const port = Number(process.env.PORT || 3000);

const corsOrigins = (process.env.CORS_ORIGIN || process.env.APP_URL || 'http://localhost:3000')
  .split(',')
  .map((v) => v.trim())
  .filter(Boolean);

app.use(helmet({
  contentSecurityPolicy: false
}));
app.use(cors({
  origin(origin, cb) {
    if (!origin || corsOrigins.includes(origin) || corsOrigins.includes('*')) return cb(null, true);
    return cb(null, false);
  },
  credentials: true
}));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

app.get('/health', (req, res) => {
  res.json({
    ok: true,
    service: 'truelead-api',
    time: new Date().toISOString()
  });
});

app.use('/api/public', publicRouter);
app.use('/api/auth', authRouter);
app.use('/api', preleadRouter);
app.use('/api/agency', agencyRouter);
app.use('/api/admin', adminRouter);
app.use('/api/whatsapp', whatsappRouter);

app.use('/sdk', express.static(path.join(frontendDir, 'sdk'), {
  maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0
}));
app.use(express.static(frontendDir));

app.get('*', (req, res) => {
  res.sendFile(path.join(frontendDir, 'index.html'));
});

await db.init();
await whatsappManager.init();
app.locals.whatsappManager = whatsappManager;

app.listen(port, () => {
  console.log(`TrueLead running on http://localhost:${port}`);
  console.log(`Data file: ${db.filePath}`);
});
