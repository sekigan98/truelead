export const PLAN_DEFINITIONS = [
  {
    id: 'starter',
    name: 'Starter',
    title: 'Para probar medición real',
    usdMonthly: 19,
    leadsMonthly: null,
    clientsLimit: 1,
    projectsLimit: 1,
    whatsappLimit: 1,
    featured: false,
    capabilities: {
      phoneVisibility: 'masked',
      canViewFullPhones: false,
      canExportLeads: false,
      canUseMetaCapi: true,
      canUsePurchases: true,
      exportLabel: 'Exportación disponible desde Agency'
    },
    features: [
      '1 cliente',
      '1 proyecto / landing',
      '1 WhatsApp conectado',
      'Teléfonos enmascarados: solo últimos 4 dígitos',
      'Sin exportación CSV/XLSX',
      'Leads reales y Meta CAPI'
    ]
  },
  {
    id: 'pro',
    name: 'Pro',
    title: 'Para agencias en crecimiento',
    usdMonthly: 49,
    leadsMonthly: null,
    clientsLimit: 10,
    projectsLimit: 30,
    whatsappLimit: 5,
    featured: true,
    capabilities: {
      phoneVisibility: 'full',
      canViewFullPhones: true,
      canExportLeads: false,
      canUseMetaCapi: true,
      canUsePurchases: true,
      exportLabel: 'Exportación CSV/XLSX disponible en Agency'
    },
    features: [
      '10 clientes',
      '30 proyectos / landings',
      'Hasta 5 WhatsApps conectados',
      'Teléfonos completos visibles en el panel',
      'Meta Conversions API',
      'Sin descarga CSV/XLSX'
    ]
  },
  {
    id: 'agency',
    name: 'Agency',
    title: 'Escala, bases y multi-cliente',
    usdMonthly: 99,
    leadsMonthly: null,
    clientsLimit: 50,
    projectsLimit: 150,
    whatsappLimit: 20,
    capabilities: {
      phoneVisibility: 'full',
      canViewFullPhones: true,
      canExportLeads: true,
      canUseMetaCapi: true,
      canUsePurchases: true,
      exportLabel: 'Exportación CSV/XLSX incluida'
    },
    features: [
      '50 clientes',
      '150 proyectos / landings',
      'Hasta 20 WhatsApps conectados',
      'Teléfonos completos visibles',
      'Exportación CSV/XLSX por fechas',
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
    capabilities: {
      phoneVisibility: 'full',
      canViewFullPhones: true,
      canExportLeads: true,
      canUseMetaCapi: true,
      canUsePurchases: true,
      exportLabel: 'Exportación avanzada incluida'
    },
    features: [
      'Clientes ilimitados',
      'Proyectos ilimitados',
      'WhatsApps según operación',
      'Exportación avanzada',
      'Onboarding personalizado',
      'Soporte dedicado'
    ]
  }
];

const PLAN_ALIASES = {
  supreme: 'enterprise',
  premium: 'agency'
};

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
  const normalized = String(id || 'starter').toLowerCase();
  const target = PLAN_ALIASES[normalized] || normalized;
  return PLAN_DEFINITIONS.find((plan) => plan.id === target) || PLAN_DEFINITIONS[0];
}

export function getPlanCapabilities(id) {
  const plan = getPlanById(id);
  return {
    phoneVisibility: 'masked',
    canViewFullPhones: false,
    canExportLeads: false,
    canUseMetaCapi: false,
    canUsePurchases: true,
    exportLabel: 'Exportación disponible desde Agency',
    ...(plan.capabilities || {})
  };
}

export function isWithinPlanLimit(currentCount, limit) {
  if (limit == null) return true;
  return Number(currentCount || 0) < Number(limit);
}
