
const loginForm = document.querySelector('[data-login-form]');
const registerForm = document.querySelector('[data-register-form]');
const messageBox = document.querySelector('[data-message]');

if (loginForm) {
  loginForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = new FormData(loginForm);
    const destination = loginForm.dataset.loginDestination || 'client';

    try {
      const data = await TrueLeadAPI.post('/api/auth/login', {
        email: form.get('email'),
        password: form.get('password')
      });

      if (destination === 'admin' && data.user.role !== 'admin') {
        TrueLeadAPI.clearSession();
        TLUtils.showMessage(messageBox, 'Este acceso es solo para administración interna de TrueLead.', 'error');
        return;
      }

      if (destination === 'client' && data.user.role === 'admin') {
        TrueLeadAPI.setSession(data.token, data.user);
        location.href = 'admin.html';
        return;
      }

      TrueLeadAPI.setSession(data.token, data.user);
      location.href = destination === 'admin' ? 'admin.html' : 'app.html';
    } catch (error) {
      TLUtils.showMessage(messageBox, error.message, 'error');
    }
  });
}

if (registerForm) {
  registerForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = new FormData(registerForm);
    try {
      await TrueLeadAPI.post('/api/auth/register', {
        agencyName: form.get('agencyName'),
        name: form.get('name'),
        email: form.get('email'),
        password: form.get('password')
      });
      TLUtils.showMessage(messageBox, 'Cuenta creada. Queda pendiente hasta que TrueLead valide el alta o el pago.', 'success');
      registerForm.reset();
    } catch (error) {
      TLUtils.showMessage(messageBox, error.message, 'error');
    }
  });
}
