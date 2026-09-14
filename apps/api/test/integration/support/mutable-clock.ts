import { Clock } from '../../../src/clock/clock';

/** A clock tests can set and advance explicitly. */
export class MutableClock extends Clock {
  private current: Date;

  constructor(start: Date = new Date('2026-09-15T12:00:00.000Z')) {
    super();
    this.current = new Date(start);
  }

  now(): Date {
    return new Date(this.current);
  }

  set(date: Date): void {
    this.current = new Date(date);
  }

  advance(milliseconds: number): void {
    this.current = new Date(this.current.getTime() + milliseconds);
  }
}
