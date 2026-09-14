import { createParamDecorator, type ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Request } from 'express';
import type { ApiKeyRole } from '../generated/prisma/client';
import { requestIdOf } from '../logging/request-id';
import { isAuthenticated, type Principal } from './principal';

export const IS_PUBLIC_KEY = 'relayforge:isPublic';
export const REQUIRED_ROLES_KEY = 'relayforge:requiredRoles';

/** Opts a route out of API key authentication (health checks, signed webhook ingestion). */
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC_KEY, true);

/** Restricts a route to API keys with one of the given roles. */
export const RequireRole = (...roles: ApiKeyRole[]): MethodDecorator & ClassDecorator =>
  SetMetadata(REQUIRED_ROLES_KEY, roles);

export const CurrentPrincipal = createParamDecorator(
  (_data: unknown, context: ExecutionContext): Principal => {
    const request = context.switchToHttp().getRequest<Request>();
    if (!isAuthenticated(request)) {
      // Reaching this means a handler using @CurrentPrincipal was marked @Public.
      throw new Error('CurrentPrincipal used on a route without API key authentication');
    }
    return request.principal;
  },
);

export const RequestId = createParamDecorator(
  (_data: unknown, context: ExecutionContext): string | null =>
    requestIdOf(context.switchToHttp().getRequest<Request>()),
);
