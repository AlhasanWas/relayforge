import { Injectable } from '@nestjs/common';
import { ProviderAdapterType } from '../generated/prisma/client';
import { MockPayAdapter } from './mockpay.adapter';
import type { ProviderAdapter } from './provider-adapter';

/**
 * Maps each `ProviderAdapterType` to its implementation. Construction fails if an
 * adapter type in the schema has no implementation, so the process refuses to
 * start rather than failing on the first webhook for that provider.
 */
@Injectable()
export class ProviderAdapterRegistry {
  private readonly adapters: ReadonlyMap<ProviderAdapterType, ProviderAdapter>;

  constructor(mockPay: MockPayAdapter) {
    this.adapters = ProviderAdapterRegistry.index([mockPay]);
  }

  static index(adapters: ProviderAdapter[]): ReadonlyMap<ProviderAdapterType, ProviderAdapter> {
    const byType = new Map(adapters.map((adapter) => [adapter.type, adapter]));
    const missing = Object.values(ProviderAdapterType).filter((type) => !byType.has(type));
    if (missing.length > 0) {
      throw new Error(`No provider adapter registered for: ${missing.join(', ')}`);
    }
    return byType;
  }

  get(type: ProviderAdapterType): ProviderAdapter {
    const adapter = this.adapters.get(type);
    if (adapter === undefined) {
      throw new Error(`No provider adapter registered for ${type}`);
    }
    return adapter;
  }
}
