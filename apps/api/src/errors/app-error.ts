import { HttpStatus } from '@nestjs/common';

/**
 * An expected, client-facing failure with a stable machine-readable code.
 * Domain services throw these; the global exception filter renders them.
 */
export class AppError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly httpStatus: HttpStatus,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string, id: string) {
    super('NOT_FOUND', `${resource} ${id} was not found`, HttpStatus.NOT_FOUND);
  }
}
