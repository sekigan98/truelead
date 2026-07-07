function resolveTrueLeadApiBase() {
  const explicit = window.TRUELEAD_API_BASE || localStorage.getItem('TRUELEAD_API_BASE') || '';
  if (explicit) return explicit.replace(/\/$/, '');

  const host = window.location.hostname;
  const publicHosts = new Set([
    'truelead.com.ar',
    'www.truelead.com.ar'
  ]);

  if (publicHosts.has(host)) {
    return 'https://app.truelead.com.ar';
  }

  return '';
}

const API_BASE = resolveTrueLeadApiBase();


function trueLeadCookieDomain() {
  const host = window.location.hostname || '';
  return host === 'truelead.com.ar' || host.endsWith('.truelead.com.ar')
    ? '; domain=.truelead.com.ar'
    : '';
}

function setTrueLeadCookie(name, value, days = 30) {
  const maxAge = days * 24 * 60 * 60;
  document.cookie = `${name}=${encodeURIComponent(value || '')}; path=/; max-age=${maxAge}; SameSite=Lax${trueLeadCookieDomain()}`;
}

function clearTrueLeadCookie(name) {
  document.cookie = `${name}=; path=/; max-age=0; SameSite=Lax`;
  document.cookie = `${name}=; path=/; max-age=0; SameSite=Lax${trueLeadCookieDomain()}`;
}


function trueLeadIsMarketingHost() {
  return ['truelead.com.ar', 'www.truelead.com.ar'].includes(window.location.hostname);
}

function trueLeadAppOrigin() {
  return trueLeadIsMarketingHost() ? 'https://app.truelead.com.ar' : '';
}

function trueLeadPageUrl(page) {
  const cleanPage = String(page || '').replace(/^\/+/, '');
  const origin = trueLeadAppOrigin();
  return origin ? `${origin}/${cleanPage}` : cleanPage;
}

function trueLeadPanelUrl(role = 'agency') {
  return trueLeadPageUrl(role === 'admin' ? 'admin' : 'panel');
}

function trueLeadLogoutUrl(redirectTo) {
  const defaultRedirect = trueLeadIsMarketingHost()
    ? `${window.location.origin}/`
    : '/';
  const redirect = redirectTo || defaultRedirect;
  return `${trueLeadPageUrl('logout')}?redirect=${encodeURIComponent(redirect)}`;
}

function getTrueLeadCookie(name) {
  const prefix = `${name}=`;
  return document.cookie.split(';').map(item => item.trim()).find(item => item.startsWith(prefix))?.slice(prefix.length) || '';
}

const TrueLeadAPI = {
  apiBase: API_BASE,
  token() {
    return localStorage.getItem('tl_token') || '';
  },
  user() {
    try { return JSON.parse(localStorage.getItem('tl_user') || 'null'); } catch { return null; }
  },
  setSession(token, user) {
    localStorage.setItem('tl_token', token);
    localStorage.setItem('tl_user', JSON.stringify(user));
    setTrueLeadCookie('tl_logged_in', '1');
    setTrueLeadCookie('tl_role', user?.role || 'agency');
    setTrueLeadCookie('tl_name', user?.name || user?.agency?.name || 'TrueLead');
    setTrueLeadCookie('tl_plan', user?.agency?.plan || user?.plan || '');
  },
  clearSession() {
    localStorage.removeItem('tl_token');
    localStorage.removeItem('tl_user');
    clearTrueLeadCookie('tl_logged_in');
    clearTrueLeadCookie('tl_role');
    clearTrueLeadCookie('tl_name');
    clearTrueLeadCookie('tl_plan');
  },
  sessionHint() {
    return {
      loggedIn: getTrueLeadCookie('tl_logged_in') === '1',
      role: decodeURIComponent(getTrueLeadCookie('tl_role') || 'agency'),
      name: decodeURIComponent(getTrueLeadCookie('tl_name') || ''),
      plan: decodeURIComponent(getTrueLeadCookie('tl_plan') || '')
    };
  },
  isMarketingHost: trueLeadIsMarketingHost,
  appOrigin: trueLeadAppOrigin,
  pageUrl: trueLeadPageUrl,
  panelUrl: trueLeadPanelUrl,
  logoutUrl: trueLeadLogoutUrl,
  buildUrl(path) {
    const normalizedPath = String(path || '').startsWith('/') ? path : `/${path}`;
    return `${API_BASE}${normalizedPath}`;
  },
  async request(path, options = {}) {
    const headers = {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    };
    const token = this.token();
    if (token) headers.Authorization = `Bearer ${token}`;

    const response = await fetch(this.buildUrl(path), {
      ...options,
      headers,
      body: options.body && typeof options.body !== 'string'
        ? JSON.stringify(options.body)
        : options.body
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || `Error ${response.status}`);
    }
    return data;
  },
  get(path) { return this.request(path); },
  post(path, body) { return this.request(path, { method: 'POST', body }); },
  put(path, body) { return this.request(path, { method: 'PUT', body }); },
  patch(path, body) { return this.request(path, { method: 'PATCH', body }); },
  delete(path) { return this.request(path, { method: 'DELETE' }); }
};

window.TrueLeadAPI = TrueLeadAPI;

function showMessage(target, text, type = 'notice') {
  if (!target) return;
  target.className = `notice ${type}`;
  target.textContent = text;
  target.classList.remove('hidden');
}

function formatDate(value) {
  if (!value) return '-';
  try {
    return new Intl.DateTimeFormat('es-AR', {
      dateStyle: 'short',
      timeStyle: 'short'
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function statusClass(status) {
  if (['active', 'approved', 'sent', 'confirmed', 'sent_to_meta', 'purchase_confirmed'].includes(status)) return 'green';
  if (['pending', 'pending_email', 'pending_validation', 'trial_pending_email', 'trial', 'skipped', 'intent', 'proof_received'].includes(status)) return 'yellow';
  if (['suspended', 'rejected', 'error', 'duplicate'].includes(status)) return 'red';
  return 'gray';
}

window.TLUtils = { showMessage, formatDate, statusClass };
