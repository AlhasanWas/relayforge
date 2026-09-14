import { Global, Module } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { SecretCipher } from './secret-cipher';

@Global()
@Module({
  providers: [
    {
      provide: SecretCipher,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => new SecretCipher(config.security.encryptionKey),
    },
  ],
  exports: [SecretCipher],
})
export class CryptoModule {}
