import 'dotenv/config';
import { db } from '../lib/db.js';

await db.init();
console.log('TrueLead DB initialized at:', db.filePath);
console.log('Admin email:', process.env.ADMIN_EMAIL || 'admin@truelead.local');
