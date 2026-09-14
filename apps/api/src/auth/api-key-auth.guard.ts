import { type CanActivate, type ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { AppError } from '../errors/app-error';
import type { ApiKeyRole } from '../generated/prisma/client';
import { parseBearerToken } from './api-key';
import { ApiKeyAuthenticator } from './api-key-authenticator';
import { IS_PUBLIC_KEY, REQUIRED_ROLES_KEY } from './auth.decorators';
import { attachPrincipal } from './principal';

/**
 * Global guard: every route requires a valid, unrevoked API key unless marked
 * `@Public()`. Keys are checked against the database on every request, so a
 * revocation takes effect immediately.
 */
@Injectable()
export class ApiKeyAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly authenticator: ApiKeyAuthenticator,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean | undefined>(IS_PUBLIC_KEY, targets)) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const token = parseBearerToken(request.headers.authorization);
    if (token === undefined) {
      throw new AppError(
        'UNAUTHORIZED',
        'An API key is required: Authorization: Bearer <key>',
        HttpStatus.UNAUTHORIZED,
      );
    }

    const principal = await this.authenticator.authenticate(token);
    if (principal === null) {
      // One response for unknown and revoked keys: callers learn nothing about key state.
      throw new AppError('UNAUTHORIZED', 'Invalid or revoked API key', HttpStatus.UNAUTHORIZED);
    }

    const requiredRoles = this.reflector.getAllAndOverride<ApiKeyRole[] | undefined>(
      REQUIRED_ROLES_KEY,
      targets,
    );
    if (requiredRoles !== undefined && !requiredRoles.includes(principal.role)) {
      throw new AppError(
        'FORBIDDEN',
        `This operation requires one of the roles: ${requiredRoles.join(', ')}`,
        HttpStatus.FORBIDDEN,
      );
    }

    attachPrincipal(request, principal);
    return true;
  }
}
