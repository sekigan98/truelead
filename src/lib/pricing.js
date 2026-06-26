export const PLAN_DEFINITIONS = [
  {
    id: 'starter',
    name: 'Starter',
    title: 'Trial automático',
    usdMonthly: 19,
    leadsMonthly: null,
    clientsLimit: 3,
    projectsLimit: 5,
    whatsappLimit: 1,
    features: [
      '3 clientes',
      '5 proyectos',
      '1 WhatsApp conectado',
      'Leads reales automáticos',
      'Reportes básicos'
    ]
  },
  {
    id: 'pro',
    name: 'Pro',
    title: 'Agencias en crecimiento',
    usdMonthly: 49,
    leadsMonthly: null,
    clientsLimit: 10,
    projectsLimit: 30,
    whatsappLimit: 5,
    featured: true,
    features: [
      '10 clientes',
      '30 proyectos',
      'Hasta 5 WhatsApps',
      'Tracking automático de leads',
      'Meta Conversions API'
    ]
  },
  {
    id: 'agency',
    name: 'Agency',
    title: 'Escala y multi-cliente',
    usdMonthly: 99,
    leadsMonthly: null,
    clientsLimit: 50,
    projectsLimit: 150,
    whatsappLimit: 20,
    features: [
      '50 clientes',
      '150 proyectos',
      'Hasta 20 WhatsApps',
      'Panel administrador avanzado',
      'Soporte prioritario'
    ]
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    title: 'Operación a medida',
    usdMonthly: null,
    leadsMonthly: null,
    clientsLimit: null,
    projectsLimit: null,
    whatsappLimit: null,
    features: [
      'Clientes ilimitados',
      'Múltiples agencias/equipos',
      'Onboarding personalizado',
      'Soporte dedicado',
      'Condiciones comerciales a medida'
    ]
  }
];

export function getUsdArsRate() {
  const raw = Number(process.env.TRUELEAD_USD_ARS_RATE || process.env.USD_ARS_RATE || 1200);
  return Number.isFinite(raw) && raw > 0 ? raw : 1200;
}

export function isArgentinaRequest(req) {
  const queryCountry = String(req.query.country || '').toUpperCase();
  const headerCountry = String(
    req.headers['cf-ipcountry'] ||
    req.headers['x-vercel-ip-country'] ||
    req.headers['x-country-code'] ||
    ''
  ).toUpperCase();

  const tz = String(req.query.tz || req.headers['x-timezone'] || '').toLowerCase();
  const lang = String(req.headers['accept-language'] || '').toLowerCase();

  return queryCountry === 'AR' ||
    headerCountry === 'AR' ||
    tz.includes('argentina') ||
    lang.includes('es-ar');
}

export function roundArs(value) {
  return Math.round(Number(value || 0) / 100) * 100;
}

export function formatUsd(value) {
  if (value == null) return 'Consultar';
  return `USD ${Number(value).toLocaleString('en-US')}`;
}

export function formatArs(value) {
  if (value == null) return 'Consultar';
  return `$${Number(value).toLocaleString('es-AR')}`;
}

export function getPricingForRequest(req) {
  const usdArsRate = getUsdArsRate();
  const country = isArgentinaRequest(req) ? 'AR' : 'INTL';
  const currency = country === 'AR' ? 'ARS' : 'USD';

  const plans = PLAN_DEFINITIONS.map((plan) => {
    const arsMonthly = plan.usdMonthly == null ? null : roundArs(plan.usdMonthly * usdArsRate);
    const displayPrice = currency === 'ARS' ? formatArs(arsMonthly) : formatUsd(plan.usdMonthly);

    return {
      ...plan,
      arsMonthly,
      currency,
      displayPrice,
      displaySuffix: plan.usdMonthly == null ? '' : '/mes'
    };
  });

  return {
    country,
    currency,
    usdArsRate,
    rateSource: 'Render env TRUELEAD_USD_ARS_RATE',
    plans
  };
}

export function getPlanById(id) {
  return PLAN_DEFINITIONS.find((plan) => plan.id === id) || PLAN_DEFINITIONS[0];
}
