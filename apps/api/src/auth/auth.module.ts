import { Module } from '@nestjs/common';
import { ApiKeyAuthGuard } from './api-key-auth.guard';
import { ApiKeyAuthenticator } from './api-key-authenticator';

/**
 * The guard is registered globally in AppModule, next to the rate limit guard, so the
 * order "authenticate, then rate limit per key" is explicit in one place.
 */
@Module({
  providers: [ApiKeyAuthenticator, ApiKeyAuthGuard],
  exports: [ApiKeyAuthenticator, ApiKeyAuthGuard],
})
export class AuthModule {}
