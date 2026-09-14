import { type ArgumentsHost, Catch, type ExceptionFilter } from '@nestjs/common';
import type { Request, Response } from 'express';
import { PinoLogger } from 'nestjs-pino';
import { requestIdOf } from '../logging/request-id';
import { toErrorResponse } from './error-response';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  constructor(private readonly logger: PinoLogger) {
    this.logger.setContext(GlobalExceptionFilter.name);
  }

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    const { status, body, unexpected } = toErrorResponse(exception);

    if (unexpected) {
      this.logger.error(
        { err: exception, method: request.method, path: request.path },
        'Unhandled error while processing request',
      );
    }

    response.status(status).json({ error: { ...body, requestId: requestIdOf(request) } });
  }
}
