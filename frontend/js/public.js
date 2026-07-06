document.querySelectorAll('[data-year]').forEach(el => el.textContent = new Date().getFullYear());

(function hydrateSessionLinks() {
  const localUser = TrueLeadAPI.user();
  const hint = TrueLeadAPI.sessionHint?.() || {};
  const isLogged = Boolean((localUser && TrueLeadAPI.token()) || hint.loggedIn);
  if (!isLogged) return;

  const role = localUser?.role || hint.role || 'agency';
  const name = localUser?.name || hint.name || 'Sesión activa';
  const agencyPlan = localUser?.agency?.plan || '';
  const appOrigin = ['truelead.com.ar', 'www.truelead.com.ar'].includes(location.hostname) ? 'https://app.truelead.com.ar' : '';
  const panelHref = `${appOrigin}/${role === 'admin' ? 'admin.html' : 'app.html'}`.replace(/^\//, '');

  document.querySelectorAll('a[href="login.html"], a[href="app.html"]').forEach((link) => {
    link.href = panelHref;
    link.textContent = role === 'admin' ? 'Ir al admin' : 'Ir al panel';
  });

  const actions = document.querySelector('.header .actions');
  if (actions && !actions.querySelector('[data-session-chip]')) {
    const chip = document.createElement('span');
    chip.className = 'session-chip';
    chip.dataset.sessionChip = 'true';
    chip.textContent = agencyPlan ? `${name} · ${agencyPlan}` : name;
    actions.prepend(chip);
  }
})();

const demoButtons = document.querySelectorAll('[data-demo-register]');
demoButtons.forEach(btn => btn.addEventListener('click', () => {
  location.href = 'register.html';
}));
