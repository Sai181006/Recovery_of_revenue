import { isAbsolute, resolve } from 'node:path';
import { AppError } from './errors.ts';
import type { WebhookContext } from './webhook.ts';

export const RUNTIME_MODES = ['demo', 'development', 'production'] as const;
export type RuntimeMode = (typeof RUNTIME_MODES)[number];

export type RuntimeConfig = {
  mode: RuntimeMode;
  host: string;
  port: number;
  dataPath: string;
  publicDir: string;
  seedFixtures: boolean;
  webhookEnabled: boolean;
  webhookSecret: string;
  webhookContext: WebhookContext;
  readOnly: boolean;
  adminToken?: string | undefined;
  publicBaseUrl?: string | undefined;
  modelProvider?: string | undefined;
  modelName?: string | undefined;
  modelApiKey?: string | undefined;
};

type Environment = Record<string, string | undefined>;
const present = (value: string | undefined) => value?.trim() || undefined;

export function parseRuntimeConfig(
  environment: Environment = process.env,
  modeOverride?: string,
  cwd = process.cwd(),
): RuntimeConfig {
  const issues: string[] = [];
  const rawMode = modeOverride ?? present(environment.APP_MODE) ?? 'production';
  if (!RUNTIME_MODES.includes(rawMode as RuntimeMode)) {
    issues.push('APP_MODE must be demo, development, or production');
  }
  const mode = RUNTIME_MODES.includes(rawMode as RuntimeMode)
    ? (rawMode as RuntimeMode)
    : 'production';
  const port = Number(present(environment.PORT) ?? '3000');
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    issues.push('PORT must be an integer from 0 through 65535');
  }
  const host = present(environment.HOST) ?? '127.0.0.1';
  if (/[/\\\s]/.test(host)) issues.push('HOST is invalid');
  const rawDataPath = present(environment.DATA_PATH) ?? 'data/recovery.sqlite';
  const dataPath = isAbsolute(rawDataPath) ? rawDataPath : resolve(cwd, rawDataPath);
  const rawPublicDir = present(environment.PUBLIC_DIR) ?? 'public';
  const publicDir = isAbsolute(rawPublicDir) ? rawPublicDir : resolve(cwd, rawPublicDir);
  const webhookEnabled = present(environment.WEBHOOK_ENABLED) === 'true';
  const webhookSecret = present(environment.RAZORPAY_WEBHOOK_SECRET) ?? '';
  if (webhookEnabled && !webhookSecret) {
    issues.push('RAZORPAY_WEBHOOK_SECRET is required when WEBHOOK_ENABLED=true');
  }
  if (issues.length) throw new AppError('CONFIG_INVALID', 'Invalid runtime configuration.', issues);
  return {
    mode,
    host,
    port,
    dataPath,
    publicDir,
    seedFixtures: mode !== 'production',
    webhookEnabled,
    webhookSecret,
    // Merchant-level context for live webhooks. Both flags default to false, so
    // customer contact fails closed unless the operator opts in (test mode only).
    webhookContext: {
      merchantId: present(environment.WEBHOOK_MERCHANT_ID) ?? 'merchant_demo',
      consent: present(environment.WEBHOOK_ASSUME_CONSENT) === 'true',
      suppressed: false,
      contactAvailable: present(environment.WEBHOOK_ASSUME_CONTACT_ROUTE) === 'true',
      trustedUpdateLinkAvailable: false,
    },
    readOnly: present(environment.READ_ONLY) === 'true',
    ...(present(environment.ADMIN_TOKEN) ? { adminToken: present(environment.ADMIN_TOKEN) } : {}),
    ...(present(environment.PUBLIC_BASE_URL)
      ? { publicBaseUrl: present(environment.PUBLIC_BASE_URL) }
      : {}),
    ...(present(environment.MODEL_PROVIDER)
      ? { modelProvider: present(environment.MODEL_PROVIDER) }
      : {}),
    ...(present(environment.MODEL_NAME) ? { modelName: present(environment.MODEL_NAME) } : {}),
    ...(present(environment.MODEL_API_KEY)
      ? { modelApiKey: present(environment.MODEL_API_KEY) }
      : {}),
  };
}

export function formatConfigError(error: unknown) {
  if (!(error instanceof AppError) || error.code !== 'CONFIG_INVALID') {
    return 'Startup failed [INTERNAL_ERROR].';
  }
  return `Startup failed [${error.code}]: ${(error.details ?? []).join('; ')}`;
}
