import type { Provider } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { DeliveryRetryPolicy } from './delivery-retry-policy';

export const deliveryRetryPolicyProvider: Provider = {
  provide: DeliveryRetryPolicy,
  inject: [APP_CONFIG],
  useFactory: (config: AppConfig) =>
    new DeliveryRetryPolicy({
      baseMs: config.delivery.retryBaseMs,
      maxMs: config.delivery.retryMaxMs,
      retryableStatusCodes: config.delivery.retryableStatusCodes,
    }),
};
