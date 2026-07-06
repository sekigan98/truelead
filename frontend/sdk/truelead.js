
(function () {
  const currentScript = document.currentScript;
  const projectPublicId = currentScript?.dataset.project || '';
  const apiBase = currentScript?.dataset.api || new URL(currentScript.src).origin;
  const defaultMessage = currentScript?.dataset.message || '';
  const buttons = document.querySelectorAll('[data-truelead-whatsapp]');

  function getCookie(name) {
    return document.cookie
      .split('; ')
      .find(row => row.startsWith(name + '='))
      ?.split('=')[1] || '';
  }

  function getVisitorId() {
    const key = 'truelead_visitor_id';
    let value = localStorage.getItem(key);
    if (!value) {
      value = 'v_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
      localStorage.setItem(key, value);
    }
    return value;
  }

  function collectUtm() {
    const params = new URLSearchParams(location.search);
    const keys = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'ad_id', 'adset_id', 'campaign_id'];
    const out = {};
    keys.forEach(key => {
      if (params.get(key)) out[key] = params.get(key);
    });
    return out;
  }

  async function createPrelead(button) {
    const messageTemplate = button?.dataset.trueleadMessage || defaultMessage || '';
    const buttonSource = button?.dataset.trueleadSource || button?.id || button?.textContent?.trim() || '';

    const response = await fetch(apiBase + '/api/preleads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectPublicId,
        landingUrl: location.href,
        visitorId: getVisitorId(),
        buttonSource,
        messageTemplate,
        fbp: getCookie('_fbp'),
        fbc: getCookie('_fbc'),
        utm: collectUtm()
      })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'No se pudo crear el lead.');
    return data;
  }

  if (!projectPublicId) {
    console.warn('[TrueLead] Falta data-project en el script.');
    return;
  }

  buttons.forEach((button) => {
    button.addEventListener('click', async (event) => {
      event.preventDefault();

      const originalText = button.textContent;
      button.textContent = button.dataset.trueleadLoading || 'Abriendo WhatsApp...';
      button.setAttribute('aria-busy', 'true');

      try {
        const prelead = await createPrelead(button);
        if (prelead.whatsappHref) {
          window.location.href = prelead.whatsappHref;
        } else {
          throw new Error('El proyecto no tiene WhatsApp vinculado.');
        }
      } catch (error) {
        console.error('[TrueLead]', error);
        alert(error.message);
        button.textContent = originalText;
        button.removeAttribute('aria-busy');
      }
    });
  });
})();
