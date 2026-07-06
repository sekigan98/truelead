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
  },
  clearSession() {
    localStorage.removeItem('tl_token');
    localStorage.removeItem('tl_user');
  },
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
