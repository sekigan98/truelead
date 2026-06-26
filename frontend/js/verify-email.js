(async function () {
  const params = new URLSearchParams(location.search);
  const token = params.get('token') || '';
  const message = document.querySelector('[data-message]');
  const title = document.querySelector('[data-verify-title]');
  const copy = document.querySelector('[data-verify-copy]');
  const link = document.querySelector('[data-login-link]');

  if (!token) {
    TLUtils.showMessage(message, 'Falta el token de activación.', 'error');
    title.textContent = 'No pudimos activar la cuenta';
    copy.textContent = 'El link de activación está incompleto.';
    return;
  }

  try {
    const data = await TrueLeadAPI.get(`/api/auth/verify-email?token=${encodeURIComponent(token)}`);
    TLUtils.showMessage(message, data.message || 'Cuenta activada correctamente.', 'success');
    title.textContent = 'Cuenta activada';
    copy.textContent = 'Ya podés entrar al panel y vincular WhatsApp por QR.';
    link.classList.remove('hidden');
  } catch (error) {
    TLUtils.showMessage(message, error.message, 'error');
    title.textContent = 'No pudimos activar la cuenta';
    copy.textContent = 'El link puede estar vencido o ya usado. Podés solicitar otro desde el registro/login.';
  }
})();
