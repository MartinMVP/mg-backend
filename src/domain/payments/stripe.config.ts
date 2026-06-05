export type StripeEnvironment = 'sandbox' | 'production';

export type StripeConfig = {
  enabled: boolean;
  environment: StripeEnvironment;
  secretKey?: string;
  webhookSecret?: string;
  apiUrl?: string;
  successUrl?: string;
  cancelUrl?: string;
};

function parseBool(value: string | undefined, fallback = false) {
  if (value === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

function parseEnvironment(value: string | undefined): StripeEnvironment {
  return value === 'production' ? 'production' : 'sandbox';
}

export function getStripeConfig(source: NodeJS.ProcessEnv = process.env): StripeConfig {
  return {
    enabled: parseBool(source.STRIPE_ENABLED, false),
    environment: parseEnvironment(source.STRIPE_ENVIRONMENT),
    secretKey: source.STRIPE_SECRET_KEY?.trim() || undefined,
    webhookSecret: source.STRIPE_WEBHOOK_SECRET?.trim() || undefined,
    apiUrl: source.STRIPE_API_URL?.trim() || undefined,
    successUrl: source.STRIPE_SUCCESS_URL?.trim() || undefined,
    cancelUrl: source.STRIPE_CANCEL_URL?.trim() || undefined,
  };
}

export function validateStripeConfig(config: StripeConfig) {
  const issues: string[] = [];

  if (!config.enabled) {
    return {
      ok: true,
      issues,
    };
  }

  if (config.environment !== 'sandbox') issues.push('stripe_environment_not_sandbox');
  if (!config.secretKey) issues.push('stripe_secret_key_missing');
  if (config.secretKey?.startsWith('sk_live_')) issues.push('stripe_live_key_not_allowed');
  if (config.secretKey && !config.secretKey.startsWith('sk_test_')) {
    issues.push('stripe_test_key_required');
  }
  if (!config.successUrl) issues.push('stripe_success_url_missing');
  if (!config.cancelUrl) issues.push('stripe_cancel_url_missing');

  return {
    ok: issues.length === 0,
    issues,
  };
}

export function toSafeStripeConfig(config: StripeConfig) {
  return {
    enabled: config.enabled,
    environment: config.environment,
    hasSecretKey: Boolean(config.secretKey),
    hasWebhookSecret: Boolean(config.webhookSecret),
    hasApiUrl: Boolean(config.apiUrl),
    hasSuccessUrl: Boolean(config.successUrl),
    hasCancelUrl: Boolean(config.cancelUrl),
  };
}
