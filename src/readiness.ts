export type ReadinessConfig = {
  webhookSecret?: string | undefined;
  publicBaseUrl?: string | undefined;
  modelProvider?: string | undefined;
  modelName?: string | undefined;
  modelApiKey?: string | undefined;
};
export function readiness(config: ReadinessConfig) {
  const webhookConfigured = Boolean(config.webhookSecret);
  const publicHttps = (() => {
    try {
      return new URL(config.publicBaseUrl ?? 'invalid:').protocol === 'https:';
    } catch {
      return false;
    }
  })();
  const modelConfigured = Boolean(config.modelProvider && config.modelName && config.modelApiKey);
  const blockers: string[] = [];
  if (!webhookConfigured) blockers.push('RAZORPAY_WEBHOOK_SECRET missing');
  if (!publicHttps) blockers.push('PUBLIC_BASE_URL must be public HTTPS');
  if (!modelConfigured) blockers.push('live model provider not configured');
  blockers.push('genuine Razorpay test lifecycle not yet captured');
  return {
    status: 'ok',
    phase: 'phase-6-credential-independent',
    fixtureDemoReady: true,
    integratedDemoReady: false,
    integrations: {
      razorpayWebhook: webhookConfigured,
      publicHttpsEndpoint: publicHttps,
      liveAdvisor: modelConfigured,
      customerDelivery: 'simulated',
      trustedRecoveryFlow: 'simulated',
    },
    integratedDemoBlockers: blockers,
  };
}
