import {
  BadRequestException,
  HttpStatus,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { AppError, NotFoundError } from './app-error';
import { toErrorResponse } from './error-response';

describe('toErrorResponse', () => {
  it('renders an AppError with its code, status and details', () => {
    const error = new AppError('EVENT_PAYLOAD_CONFLICT', 'Payload differs', HttpStatus.CONFLICT, {
      externalEventId: 'evt_1',
    });

    expect(toErrorResponse(error)).toEqual({
      status: 409,
      body: {
        code: 'EVENT_PAYLOAD_CONFLICT',
        message: 'Payload differs',
        details: { externalEventId: 'evt_1' },
      },
      unexpected: false,
    });
  });

  it('omits details when an AppError has none', () => {
    expect(toErrorResponse(new NotFoundError('Delivery', 'd_1')).body).toEqual({
      code: 'NOT_FOUND',
      message: 'Delivery d_1 was not found',
    });
  });

  it('maps Nest HTTP exceptions to a code derived from the status', () => {
    expect(toErrorResponse(new NotFoundException('Cannot GET /nope'))).toEqual({
      status: 404,
      body: { code: 'NOT_FOUND', message: 'Cannot GET /nope' },
      unexpected: false,
    });
  });

  it('reports validation pipe failures as VALIDATION_FAILED with the constraint messages', () => {
    const exception = new BadRequestException({
      message: ['url must be a URL address', 'eventTypes should not be empty'],
      error: 'Bad Request',
      statusCode: 400,
    });

    expect(toErrorResponse(exception).body).toEqual({
      code: 'VALIDATION_FAILED',
      message: 'Request validation failed',
      details: ['url must be a URL address', 'eventTypes should not be empty'],
    });
  });

  it('exposes client errors raised by Express middleware', () => {
    const tooLarge = Object.assign(new Error('request entity too large'), {
      status: 413,
      expose: true,
    });

    expect(toErrorResponse(tooLarge)).toEqual({
      status: 413,
      body: { code: 'PAYLOAD_TOO_LARGE', message: 'request entity too large' },
      unexpected: false,
    });
  });

  it.each([
    ['a plain Error', new Error('connection string postgres://secret@db leaked')],
    ['a 5xx HttpException', new InternalServerErrorException('stack details')],
    ['a non-error value', 'boom'],
    ['middleware errors not marked safe to expose', Object.assign(new Error('x'), { status: 400 })],
  ])('hides the internals of %s behind a generic 500', (_label, exception) => {
    const response = toErrorResponse(exception);

    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
    });
    expect(response.unexpected).toBe(true);
  });
});
