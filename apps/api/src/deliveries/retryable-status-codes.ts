/**
 * Which HTTP statuses count as transient. Configured as a comma-separated list of
 * exact codes and status classes, e.g. `408,429,5xx`.
 */
export class RetryableStatusCodes {
  private constructor(
    private readonly codes: ReadonlySet<number>,
    private readonly classes: ReadonlySet<number>,
  ) {}

  static parse(spec: string): RetryableStatusCodes {
    const codes = new Set<number>();
    const classes = new Set<number>();
    for (const token of spec.split(',').map((part) => part.trim().toLowerCase())) {
      if (/^[1-5]xx$/.test(token)) {
        classes.add(Number(token[0]));
      } else if (/^[1-5]\d{2}$/.test(token)) {
        codes.add(Number(token));
      } else {
        throw new Error(
          `Invalid retryable status "${token}": use codes like 429 or classes like 5xx`,
        );
      }
    }
    if (codes.has(200) || classes.has(2) || [...codes].some((code) => code >= 200 && code < 300)) {
      throw new Error('2xx statuses mean success and cannot be retryable');
    }
    return new RetryableStatusCodes(codes, classes);
  }

  includes(status: number): boolean {
    return this.codes.has(status) || this.classes.has(Math.floor(status / 100));
  }

  toString(): string {
    return [...[...this.codes].map(String), ...[...this.classes].map((c) => `${c}xx`)].join(',');
  }
}
