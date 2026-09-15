import { formatDateTime, formatDuration, formatMinorUnits, humanize, shortId } from './format';

describe('formatMinorUnits', () => {
  it('places the decimal point by the currency’s minor unit', () => {
    expect(formatMinorUnits('4200', 'USD')).toBe('$42.00');
    expect(formatMinorUnits('5', 'EUR')).toBe('€0.05');
    expect(formatMinorUnits('1500', 'JPY')).toBe('¥1,500');
  });

  it('formats negative amounts', () => {
    expect(formatMinorUnits('-1999', 'USD')).toBe('-$19.99');
  });

  it('stays exact beyond the safe integer range', () => {
    expect(formatMinorUnits('9007199254740993', 'USD')).toBe('$90,071,992,547,409.93');
  });
});

describe('formatDateTime', () => {
  it('renders UTC timestamps and a placeholder for null', () => {
    expect(formatDateTime('2026-09-15T09:57:53.552Z')).toBe('15 Sept 2026, 09:57:53 UTC');
    expect(formatDateTime(null)).toBe('—');
  });
});

describe('formatDuration', () => {
  it('uses milliseconds below a second and seconds above', () => {
    expect(formatDuration(84)).toBe('84 ms');
    expect(formatDuration(10_002)).toBe('10.0 s');
    expect(formatDuration(1_250)).toBe('1.25 s');
    expect(formatDuration(null)).toBe('—');
  });
});

describe('humanize', () => {
  it('turns enum values into words and leaves other strings alone', () => {
    expect(humanize('DEAD_LETTER')).toBe('Dead letter');
    expect(humanize('payment.succeeded')).toBe('payment.succeeded');
  });
});

describe('shortId', () => {
  it('keeps the random tail of the id', () => {
    expect(shortId('01a0a480-10b7-779d-83bf-01c20f4ec4b3')).toBe('…0f4ec4b3');
  });
});
