import nodemailer from 'nodemailer';
import { nanoid } from 'nanoid';
import { db } from '../lib/db.js';
import { cleanString, nowIso } from '../lib/utils.js';

const APP_NAME = process.env.APP_NAME || 'TrueLead';
const CONTACT_EMAIL = process.env.TRUELEAD_CONTACT_EMAIL || process.env.ADMIN_EMAIL || 'trueleadsite@gmail.com';
const FROM_EMAIL = process.env.MAIL_FROM || process.env.SMTP_USER || CONTACT_EMAIL;

let cachedTransporter = null;

function smtpReady() {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

function getTransporter() {
  if (cachedTransporter) return cachedTransporter;
  if (!smtpReady()) return null;

  cachedTransporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 465),
    secure: String(process.env.SMTP_SECURE ?? 'true') !== 'false',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  });

  return cachedTransporter;
}

async function logEmail({ to, subject, type, status, error }) {
  try {
    db.data.emailLogs = db.data.emailLogs || [];
    db.data.emailLogs.push({
      id: nanoid(12),
      to,
      subject,
      type,
      status,
      error: error ? cleanString(error, 500) : '',
      createdAt: nowIso()
    });
    await db.save();
  } catch (logError) {
    console.warn('[email] log failed:', logError.message);
  }
}

export async function sendTrueLeadEmail({ to, subject, text, html, type = 'generic' }) {
  const finalTo = cleanString(to, 240);
  const finalSubject = cleanString(subject, 180);
  if (!finalTo || !finalSubject) return { skipped: true, reason: 'missing_to_or_subject' };

  const transporter = getTransporter();
  if (!transporter) {
    console.log(`[email:skipped] ${type} -> ${finalTo}: ${finalSubject}`);
    await logEmail({ to: finalTo, subject: finalSubject, type, status: 'skipped_missing_smtp' });
    return { skipped: true, reason: 'missing_smtp_config' };
  }

  try {
    const info = await transporter.sendMail({
      from: `${APP_NAME} <${FROM_EMAIL}>`,
      to: finalTo,
      subject: finalSubject,
      text,
      html
    });
    await logEmail({ to: finalTo, subject: finalSubject, type, status: 'sent' });
    return { ok: true, messageId: info.messageId };
  } catch (error) {
    console.error('[email:error]', error.message);
    await logEmail({ to: finalTo, subject: finalSubject, type, status: 'error', error: error.message });
    return { ok: false, error: error.message };
  }
}

function agencyUsers(agencyId) {
  return db.data.users.filter((user) => user.agencyId === agencyId && user.role !== 'admin');
}

export async function notifyRegistrationPending({ agency, user }) {
  await sendTrueLeadEmail({
    to: user.email,
    type: 'registration_pending_user',
    subject: 'Recibimos tu registro en TrueLead',
    text: `Hola ${user.name}, recibimos el registro de ${agency.name}. La cuenta quedó pendiente de validación. Te vamos a avisar cuando esté activa.\n\nEquipo TrueLead`,
    html: `<p>Hola <strong>${user.name}</strong>,</p><p>Recibimos el registro de <strong>${agency.name}</strong>. La cuenta quedó pendiente de validación.</p><p>Te vamos a avisar cuando esté activa.</p><p>Equipo TrueLead</p>`
  });

  await sendTrueLeadEmail({
    to: CONTACT_EMAIL,
    type: 'registration_pending_admin',
    subject: `Nueva cuenta pendiente: ${agency.name}`,
    text: `Nueva cuenta pendiente de validación.\n\nAgencia: ${agency.name}\nUsuario: ${user.name}\nEmail: ${user.email}\n\nIngresá al backoffice para activarla o cargar pago.`,
    html: `<p>Nueva cuenta pendiente de validación.</p><ul><li><strong>Agencia:</strong> ${agency.name}</li><li><strong>Usuario:</strong> ${user.name}</li><li><strong>Email:</strong> ${user.email}</li></ul><p>Ingresá al backoffice para activarla o cargar pago.</p>`
  });
}

export async function notifyAgencyStatusChange({ agency, status }) {
  const recipients = agencyUsers(agency.id);
  const statusText = status === 'active' ? 'activa' : status === 'suspended' ? 'suspendida' : 'pendiente';
  await Promise.all(recipients.map((user) => sendTrueLeadEmail({
    to: user.email,
    type: 'agency_status_change',
    subject: `Tu cuenta TrueLead está ${statusText}`,
    text: `Hola ${user.name}, la cuenta ${agency.name} ahora está ${statusText}.\n\nEquipo TrueLead`,
    html: `<p>Hola <strong>${user.name}</strong>,</p><p>La cuenta <strong>${agency.name}</strong> ahora está <strong>${statusText}</strong>.</p><p>Equipo TrueLead</p>`
  })));
}

export async function notifyPaymentValidation({ agency, payment, status }) {
  const recipients = agencyUsers(agency.id);
  const statusText = status === 'approved' ? 'aprobado' : status === 'rejected' ? 'rechazado' : 'pendiente';
  await Promise.all(recipients.map((user) => sendTrueLeadEmail({
    to: user.email,
    type: 'payment_validation',
    subject: `Pago ${statusText} en TrueLead`,
    text: `Hola ${user.name}, el pago del plan ${payment.plan} por ${payment.currency} ${payment.amount} fue ${statusText}.\n\nEquipo TrueLead`,
    html: `<p>Hola <strong>${user.name}</strong>,</p><p>El pago del plan <strong>${payment.plan}</strong> por <strong>${payment.currency} ${payment.amount}</strong> fue <strong>${statusText}</strong>.</p><p>Equipo TrueLead</p>`
  })));
}

export async function notifyPlanUpdated({ agency, plan, expiresAt }) {
  const recipients = agencyUsers(agency.id);
  await Promise.all(recipients.map((user) => sendTrueLeadEmail({
    to: user.email,
    type: 'plan_updated',
    subject: `Tu plan TrueLead ahora es ${plan.name}`,
    text: `Hola ${user.name}, tu cuenta ${agency.name} ahora tiene el plan ${plan.name}. Vencimiento: ${expiresAt || 'sin definir'}.\n\nEquipo TrueLead`,
    html: `<p>Hola <strong>${user.name}</strong>,</p><p>Tu cuenta <strong>${agency.name}</strong> ahora tiene el plan <strong>${plan.name}</strong>.</p><p>Vencimiento: <strong>${expiresAt || 'sin definir'}</strong>.</p><p>Equipo TrueLead</p>`
  })));
}
