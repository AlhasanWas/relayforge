/**
 * Source of the current time. Injected wherever time affects behaviour (signature
 * tolerance, retry scheduling, leases) so tests can control it deterministically.
 */
export abstract class Clock {
  abstract now(): Date;
}

export class SystemClock extends Clock {
  now(): Date {
    return new Date();
  }
}
