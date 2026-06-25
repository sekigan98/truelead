
const messageBox = document.querySelector('[data-message]');
const statusEl = document.querySelector('[data-connect-status]');

async function loadConnectStatus() {
  try {
    const data = await TrueLeadAPI.get('/api/whatsapp/status');
    renderStatus(data.session);
  } catch (error) {
    TLUtils.showMessage(messageBox, 'Para generar QR necesitás iniciar sesión.', 'error');
  }
}

function renderStatus(session = {}) {
  const cls = session.status === 'connected' ? 'active' : 'pending';
  statusEl.className = `status ${cls}`;
  statusEl.textContent = session.status || 'disconnected';
}

document.querySelector('[data-connect-request]')?.addEventListener('click', async () => {
  try {
    const data = await TrueLeadAPI.post('/api/whatsapp/request-qr', {});
    renderStatus(data.session);
    TLUtils.showMessage(messageBox, data.message || 'QR generado.', 'success');
  } catch (error) {
    TLUtils.showMessage(messageBox, error.message, 'error');
  }
});

document.querySelector('[data-connect-demo]')?.addEventListener('click', async () => {
  try {
    const number = prompt('Número conectado para demo:', '+54 11 0000 0000') || '+54 11 0000 0000';
    const data = await TrueLeadAPI.post('/api/whatsapp/mark-connected', { number, device: 'Demo browser' });
    renderStatus(data.session);
    TLUtils.showMessage(messageBox, 'WhatsApp marcado como conectado para demo.', 'success');
  } catch (error) {
    TLUtils.showMessage(messageBox, error.message, 'error');
  }
});

loadConnectStatus();
