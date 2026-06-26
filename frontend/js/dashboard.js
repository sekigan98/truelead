
const user = TrueLeadAPI.user();
const messageBox = document.querySelector('[data-message]');

if (!user) location.href = 'login.html';
if (user?.role === 'admin') document.querySelector('[data-admin-link]')?.classList.remove('hidden');

document.querySelector('[data-user-initials]').textContent = (user?.name || 'TL').split(' ').map(x => x[0]).slice(0,2).join('').toUpperCase();
document.querySelector('[data-logout]')?.addEventListener('click', () => {
  TrueLeadAPI.clearSession();
  location.href = 'login.html';
});

let state = {
  dashboard: null,
  clients: [],
  projects: [],
  leads: [],
  whatsapp: null
};

function setTab(tab) {
  document.querySelectorAll('[data-tab]').forEach(btn => btn.classList.toggle('active', btn.dataset.tab === tab));
  document.querySelectorAll('[data-panel]').forEach(panel => panel.classList.toggle('hidden', panel.dataset.panel !== tab));
  const title = {
    overview: 'Resumen',
    clients: 'Clientes',
    projects: 'Proyectos',
    leads: 'Leads reales',
    whatsapp: 'WhatsApp',
    billing: 'Mi plan'
  }[tab] || 'Resumen';
  document.querySelector('[data-title]').textContent = title;
}
document.querySelectorAll('[data-tab]').forEach(btn => btn.addEventListener('click', () => setTab(btn.dataset.tab)));
document.querySelectorAll('[data-tab-shortcut]').forEach(btn => btn.addEventListener('click', () => setTab(btn.dataset.tabShortcut)));

function renderMetrics() {
  const metrics = state.dashboard?.metrics || {};
  document.querySelector('[data-metric="clients"]').textContent = metrics.clients ?? 0;
  document.querySelector('[data-metric="projects"]').textContent = metrics.projects ?? 0;
  document.querySelector('[data-metric="clicks"]').textContent = metrics.clicks ?? 0;
  document.querySelector('[data-metric="confirmed"]').textContent = metrics.confirmed ?? 0;
  document.querySelector('[data-metric="conversionRate"]').textContent = `${metrics.conversionRate ?? 0}% confirmación`;
  const agency = state.dashboard?.agency || user.agency || {};
  document.querySelector('[data-agency-plan]').textContent = `${agency.plan || 'starter'} · ${agency.planStatus || agency.status || 'pendiente'}`;
  document.querySelector('[data-agency-status]').textContent = `Estado: ${agency.status || 'pendiente'}`;
}

function leadRow(lead) {
  const s = TLUtils.statusClass(lead.status);
  const m = TLUtils.statusClass(lead.metaStatus);
  return `
    <tr>
      <td><strong>${lead.code}</strong></td>
      <td>${lead.client || '-'}</td>
      <td>${lead.project || '-'}</td>
      <td><span class="tag ${s}">${lead.status || '-'}</span></td>
      <td><span class="tag ${m}">${lead.metaStatus || '-'}</span></td>
      <td>${lead.landingUrl ? 'Landing' : '-'}</td>
      <td>${TLUtils.formatDate(lead.createdAt)}</td>
    </tr>
  `;
}


function renderBilling() {
  const agency = state.dashboard?.agency || user.agency || {};
  const plan = state.dashboard?.plan || {};
  const metrics = state.dashboard?.metrics || {};

  const status = document.querySelector('[data-plan-status]');
  if (status) {
    status.className = `status ${agency.status === 'active' ? 'active' : 'pending'}`;
    status.textContent = agency.status || 'pendiente';
  }

  const set = (selector, value) => {
    const el = document.querySelector(selector);
    if (el) el.textContent = value;
  };

  set('[data-billing-plan]', plan.name || agency.plan || 'Starter');
  set('[data-billing-plan-title]', plan.title || agency.planStatus || 'Plan actual');
  set('[data-billing-expiry]', TLUtils.formatDate(agency.expiresAt));
  set('[data-billing-clients]', `${metrics.clients || 0} / ${plan.clientsLimit ?? '∞'}`);
  set('[data-billing-leads]', `${metrics.confirmed || 0} / ${plan.leadsMonthly ?? '∞'}`);

  const features = document.querySelector('[data-billing-features]');
  if (features) {
    features.innerHTML = (plan.features || []).map(feature => `
      <article class="soft client-card">
        <strong>${feature}</strong>
        <p>Incluido en tu plan actual.</p>
      </article>
    `).join('');
  }
}

function renderLeads() {
  const recent = state.dashboard?.recent || [];
  document.querySelector('[data-recent-leads]').innerHTML = recent.length
    ? recent.slice(0, 8).map((lead) => `
      <tr>
        <td><strong>${lead.code}</strong></td>
        <td>${lead.client || '-'}</td>
        <td>${lead.project || '-'}</td>
        <td><span class="tag ${TLUtils.statusClass(lead.status)}">${lead.status}</span></td>
        <td><span class="tag ${TLUtils.statusClass(lead.metaStatus)}">${lead.metaStatus}</span></td>
        <td>${TLUtils.formatDate(lead.createdAt)}</td>
      </tr>`).join('')
    : '<tr><td colspan="6">Todavía no hay leads.</td></tr>';

  document.querySelector('[data-leads-table]').innerHTML = state.leads.length
    ? state.leads.map(leadRow).join('')
    : '<tr><td colspan="7">Todavía no hay leads.</td></tr>';
}

function renderClients() {
  const wrap = document.querySelector('[data-clients-grid]');
  wrap.innerHTML = state.clients.length ? state.clients.map(c => `
    <article class="soft client-card">
      <h3>${c.name}</h3>
      <p>${c.email || 'Sin email'}</p>
      <p>${c.phone || 'Sin teléfono'}</p>
      <span class="status ${c.status === 'active' ? 'active' : 'pending'}">${c.status}</span>
    </article>
  `).join('') : '<p class="muted">No hay clientes todavía.</p>';

  const select = document.querySelector('[data-client-select]');
  select.innerHTML = state.clients.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
}

function sdkSnippet(project) {
  const api = location.origin;
  return `<script src="${api}/sdk/truelead.js" data-project="${project.publicId}" data-api="${api}"><\\/script>
<a href="#" data-truelead-whatsapp>Enviar WhatsApp</a>`;
}

function renderProjects() {
  const wrap = document.querySelector('[data-projects-grid]');
  wrap.innerHTML = state.projects.length ? state.projects.map(p => `
    <article class="soft client-card">
      <h3>${p.name}</h3>
      <p>Public ID: <strong>${p.publicId}</strong></p>
      <p>WhatsApp: ${p.whatsappNumber || '-'}</p>
      <p>Dominio: ${p.domain || '-'}</p>
      <span class="status ${p.status === 'active' ? 'active' : 'pending'}">${p.status}</span>
      <textarea rows="5" readonly style="margin-top:12px">${sdkSnippet(p)}</textarea>
    </article>
  `).join('') : '<p class="muted">No hay proyectos todavía. Primero creá un cliente.</p>';
}

function renderWhatsapp() {
  const s = state.whatsapp || {};
  const cls = s.status === 'connected' ? 'active' : 'pending';
  document.querySelectorAll('[data-wa-status], [data-wa-status-2]').forEach(el => {
    el.className = `status ${cls}`;
    el.textContent = s.status || 'disconnected';
  });
  document.querySelector('[data-wa-copy]').textContent = s.status === 'connected'
    ? `Conectado: ${s.number || 'número vinculado'}`
    : 'Todavía no hay WhatsApp conectado.';
  document.querySelector('[data-wa-copy-2]').textContent = s.qr
    ? `QR generado: ${s.qr}`
    : 'Generá un QR para vinculación.';
}

async function loadAll() {
  try {
    const [dashboard, clients, projects, leads, whatsapp] = await Promise.all([
      TrueLeadAPI.get('/api/agency/dashboard'),
      TrueLeadAPI.get('/api/agency/clients'),
      TrueLeadAPI.get('/api/agency/projects'),
      TrueLeadAPI.get('/api/agency/preleads'),
      TrueLeadAPI.get('/api/whatsapp/status')
    ]);
    state.dashboard = dashboard;
    state.clients = clients.clients || [];
    state.projects = projects.projects || [];
    state.leads = leads.leads || [];
    state.whatsapp = whatsapp.session || {};
    renderMetrics();
    renderBilling();
    renderLeads();
    renderClients();
    renderProjects();
    renderWhatsapp();
  } catch (error) {
    TLUtils.showMessage(messageBox, error.message, 'error');
    if (String(error.message).includes('No autenticado')) location.href = 'login.html';
  }
}

document.querySelectorAll('[data-open-modal]').forEach(btn => btn.addEventListener('click', () => {
  const modal = document.querySelector(`[data-modal="${btn.dataset.openModal}"]`);
  modal?.classList.add('open');
}));
document.querySelectorAll('[data-close-modal]').forEach(btn => btn.addEventListener('click', () => {
  btn.closest('.modal-backdrop')?.classList.remove('open');
}));

document.querySelector('[data-client-form]')?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = new FormData(event.target);
  try {
    await TrueLeadAPI.post('/api/agency/clients', Object.fromEntries(form.entries()));
    event.target.reset();
    event.target.closest('.modal-backdrop')?.classList.remove('open');
    TLUtils.showMessage(messageBox, 'Cliente creado correctamente.', 'success');
    await loadAll();
  } catch (error) {
    TLUtils.showMessage(messageBox, error.message, 'error');
  }
});

document.querySelector('[data-project-form]')?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = new FormData(event.target);
  try {
    await TrueLeadAPI.post('/api/agency/projects', Object.fromEntries(form.entries()));
    event.target.reset();
    event.target.closest('.modal-backdrop')?.classList.remove('open');
    TLUtils.showMessage(messageBox, 'Proyecto creado correctamente.', 'success');
    await loadAll();
  } catch (error) {
    TLUtils.showMessage(messageBox, error.message, 'error');
  }
});

document.querySelector('[data-confirm-form]')?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = new FormData(event.target);
  try {
    const code = String(form.get('code')).trim().toUpperCase();
    await TrueLeadAPI.post(`/api/preleads/${encodeURIComponent(code)}/confirm`, {
      phone: form.get('phone'),
      sendToMeta: form.get('sendToMeta') === 'on',
      source: 'manual_panel'
    });
    event.target.reset();
    TLUtils.showMessage(messageBox, `Lead ${code} confirmado.`, 'success');
    await loadAll();
  } catch (error) {
    TLUtils.showMessage(messageBox, error.message, 'error');
  }
});

document.querySelector('[data-request-qr]')?.addEventListener('click', async () => {
  const data = await TrueLeadAPI.post('/api/whatsapp/request-qr', {});
  state.whatsapp = data.session;
  renderWhatsapp();
});
document.querySelector('[data-mark-connected]')?.addEventListener('click', async () => {
  const number = prompt('Número conectado para demo:', '+54 11 0000 0000') || '+54 11 0000 0000';
  const data = await TrueLeadAPI.post('/api/whatsapp/mark-connected', { number, device: 'Demo browser' });
  state.whatsapp = data.session;
  renderWhatsapp();
});
document.querySelector('[data-disconnect-wa]')?.addEventListener('click', async () => {
  const data = await TrueLeadAPI.post('/api/whatsapp/disconnect', {});
  state.whatsapp = data.session;
  renderWhatsapp();
});
document.querySelector('[data-open-wa]')?.addEventListener('click', () => setTab('whatsapp'));

loadAll();
