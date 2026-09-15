/** Source of uniform random numbers in [0, 1). Injected so jittered schedules are testable. */
export abstract class RandomSource {
  abstract next(): number;
}

export class MathRandomSource extends RandomSource {
  next(): number {
    return Math.random();
  }
}
