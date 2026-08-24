import { defaultPolicy } from './default-policy.ts';
import { MerchantExperience } from './experience.ts';
import { Pipeline } from './pipeline.ts';
import { noopTelemetry, repositoryDelivery, type ApplicationPorts } from './ports.ts';
import { WebhookProcessor, type WebhookContext } from './webhook.ts';

export type ApplicationOptions = ApplicationPorts & {
  webhookSecret?: string;
  webhookContext?: WebhookContext;
};

const safeWebhookContext: WebhookContext = {
  merchantId: 'merchant_demo',
  consent: false,
  suppressed: false,
  contactAvailable: false,
  trustedUpdateLinkAvailable: false,
};

export function createApplication(options: ApplicationOptions) {
  const delivery = options.delivery ?? repositoryDelivery(options.repository);
  const telemetry = options.telemetry ?? noopTelemetry;
  const pipeline = new Pipeline(
    options.repository,
    defaultPolicy,
    options.advisor,
    options.clock,
    delivery,
    telemetry,
  );
  const experience = new MerchantExperience(options.repository, options.clock, delivery, telemetry);
  const webhook = new WebhookProcessor(
    options.repository,
    pipeline,
    options.webhookSecret ?? '',
    options.webhookContext ?? safeWebhookContext,
    options.clock,
    telemetry,
  );

  let closed = false;
  return {
    repository: options.repository,
    pipeline,
    experience,
    webhook,
    close() {
      if (closed) return;
      closed = true;
      options.repository.close();
      telemetry.record('application.closed', {});
    },
  };
}

export type RevenueRecoveryApplication = ReturnType<typeof createApplication>;
