
const loginForm = document.querySelector('[data-login-form]');
const registerForm = document.querySelector('[data-register-form]');
const messageBox = document.querySelector('[data-message]');

if (loginForm) {
  loginForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = new FormData(loginForm);
    try {
      const data = await TrueLeadAPI.post('/api/auth/login', {
        email: form.get('email'),
        password: form.get('password')
      });
      TrueLeadAPI.setSession(data.token, data.user);
      location.href = data.user.role === 'admin' ? 'admin.html' : 'app.html';
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
      TLUtils.showMessage(messageBox, 'Cuenta creada. Un administrador debe validarla para activar el panel.', 'success');
      registerForm.reset();
    } catch (error) {
      TLUtils.showMessage(messageBox, error.message, 'error');
    }
  });
}
