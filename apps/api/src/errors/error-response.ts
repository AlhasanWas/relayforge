import { HttpException, HttpStatus } from '@nestjs/common';
import { AppError } from './app-error';

export interface ErrorBody {
  code: string;
  message: string;
  details?: unknown;
}

export interface ErrorResponse {
  status: number;
  body: ErrorBody;
  /** True when the failure is unexpected and must be logged with its stack. */
  unexpected: boolean;
}

const CODES_BY_STATUS: Partial<Record<number, string>> = {
  [HttpStatus.BAD_REQUEST]: 'BAD_REQUEST',
  [HttpStatus.UNAUTHORIZED]: 'UNAUTHORIZED',
  [HttpStatus.FORBIDDEN]: 'FORBIDDEN',
  [HttpStatus.NOT_FOUND]: 'NOT_FOUND',
  [HttpStatus.METHOD_NOT_ALLOWED]: 'METHOD_NOT_ALLOWED',
  [HttpStatus.CONFLICT]: 'CONFLICT',
  [HttpStatus.PAYLOAD_TOO_LARGE]: 'PAYLOAD_TOO_LARGE',
  [HttpStatus.UNSUPPORTED_MEDIA_TYPE]: 'UNSUPPORTED_MEDIA_TYPE',
  [HttpStatus.UNPROCESSABLE_ENTITY]: 'UNPROCESSABLE_ENTITY',
  [HttpStatus.TOO_MANY_REQUESTS]: 'RATE_LIMITED',
  [HttpStatus.SERVICE_UNAVAILABLE]: 'SERVICE_UNAVAILABLE',
};

const INTERNAL_ERROR: ErrorResponse = {
  status: HttpStatus.INTERNAL_SERVER_ERROR,
  body: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
  unexpected: true,
};

/** Maps any thrown value to the public error envelope without leaking internals. */
export function toErrorResponse(exception: unknown): ErrorResponse {
  if (exception instanceof AppError) {
    return {
      status: exception.httpStatus,
      body: withDetails({ code: exception.code, message: exception.message }, exception.details),
      unexpected: exception.httpStatus >= HttpStatus.INTERNAL_SERVER_ERROR,
    };
  }

  if (exception instanceof HttpException) {
    return fromHttpException(exception);
  }

  const clientError = asHttpClientError(exception);
  if (clientError) {
    return {
      status: clientError.status,
      body: { code: codeForStatus(clientError.status), message: clientError.message },
      unexpected: false,
    };
  }

  return INTERNAL_ERROR;
}

function fromHttpException(exception: HttpException): ErrorResponse {
  const status = exception.getStatus();
  if (status >= 500) {
    return { ...INTERNAL_ERROR, status };
  }

  const response = exception.getResponse();
  // ValidationPipe reports each failed constraint as an entry in `message`.
  if (isRecord(response) && Array.isArray(response.message)) {
    return {
      status,
      body: {
        code: 'VALIDATION_FAILED',
        message: 'Request validation failed',
        details: response.message,
      },
      unexpected: false,
    };
  }

  return {
    status,
    body: { code: codeForStatus(status), message: exception.message },
    unexpected: false,
  };
}

/**
 * Errors raised by Express middleware such as the body parser (`http-errors`
 * instances) carry a 4xx `status` and a message that is safe to expose.
 */
function asHttpClientError(exception: unknown): { status: number; message: string } | undefined {
  if (!(exception instanceof Error) || !isRecord(exception)) return undefined;
  const { status, expose } = exception;
  if (typeof status === 'number' && status >= 400 && status < 500 && expose === true) {
    return { status, message: exception.message };
  }
  return undefined;
}

function codeForStatus(status: number): string {
  return CODES_BY_STATUS[status] ?? 'HTTP_ERROR';
}

function withDetails(body: ErrorBody, details: unknown): ErrorBody {
  return details === undefined ? body : { ...body, details };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
