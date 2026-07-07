
const loginForm = document.querySelector('[data-login-form]');
const registerForm = document.querySelector('[data-register-form]');
const messageBox = document.querySelector('[data-message]');

async function redirectIfSessionIsActive(destination = 'client') {
  const savedUser = TrueLeadAPI.user();
  const token = TrueLeadAPI.token();
  if (!savedUser || !token) {
    const hint = TrueLeadAPI.sessionHint?.() || {};
    if (hint.loggedIn) {
      location.href = TrueLeadAPI.panelUrl(hint.role || 'agency');
    }
    return;
  }

  try {
    const data = await TrueLeadAPI.get('/api/auth/me');
    const activeUser = data.user || savedUser;
    TrueLeadAPI.setSession(token, activeUser);

    if (destination === 'admin') {
      location.href = TrueLeadAPI.panelUrl(activeUser.role);
    } else {
      location.href = TrueLeadAPI.panelUrl(activeUser.role);
    }
  } catch (error) {
    TrueLeadAPI.clearSession();
  }
}


if (loginForm) {
  redirectIfSessionIsActive(loginForm.dataset.loginDestination || 'client');
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

      TrueLeadAPI.setSession(data.token, data.user);
      location.href = TrueLeadAPI.panelUrl(data.user.role);
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
      TLUtils.showMessage(messageBox, 'Cuenta creada. Te enviamos un email con el botón para activar el trial.', 'success');
      registerForm.reset();
    } catch (error) {
      TLUtils.showMessage(messageBox, error.message, 'error');
    }
  });
}
