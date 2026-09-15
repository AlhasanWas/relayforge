import { Global, Module } from '@nestjs/common';
import { Clock, SystemClock } from './clock';
import { MathRandomSource, RandomSource } from './random-source';

/** Time and randomness: the two inputs tests must control to be deterministic. */
@Global()
@Module({
  providers: [
    { provide: Clock, useClass: SystemClock },
    { provide: RandomSource, useClass: MathRandomSource },
  ],
  exports: [Clock, RandomSource],
})
export class ClockModule {}
