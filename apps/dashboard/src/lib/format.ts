const PLACEHOLDER = '—';

/**
 * Formats an integer amount of minor units (as the API returns it, a decimal string)
 * without passing through floating point, so large amounts stay exact.
 */
export function formatMinorUnits(amountMinor: string, currency: string): string {
  const formatter = new Intl.NumberFormat('en-US', { style: 'currency', currency });
  const digits = formatter.resolvedOptions().maximumFractionDigits ?? 2;
  const negative = amountMinor.startsWith('-');
  const magnitude = (negative ? amountMinor.slice(1) : amountMinor).padStart(digits + 1, '0');
  const whole = magnitude.slice(0, magnitude.length - digits);
  const fraction = magnitude.slice(magnitude.length - digits);
  const decimal = `${negative ? '-' : ''}${whole}${digits > 0 ? `.${fraction}` : ''}`;
  return formatter.format(decimal as Intl.StringNumericLiteral);
}

const dateTimeFormat = new Intl.DateTimeFormat('en-GB', {
  year: 'numeric',
  month: 'short',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
  timeZone: 'UTC',
});

/** Timestamps are shown in UTC so server-rendered pages read the same everywhere. */
export function formatDateTime(iso: string | null): string {
  return iso === null ? PLACEHOLDER : `${dateTimeFormat.format(new Date(iso))} UTC`;
}

export function formatDuration(ms: number | null): string {
  if (ms === null) return PLACEHOLDER;
  if (ms < 1_000) return `${ms} ms`;
  return `${(ms / 1_000).toFixed(ms < 10_000 ? 2 : 1)} s`;
}

/** DEAD_LETTER → "Dead letter"; payment.succeeded is returned unchanged. */
export function humanize(value: string): string {
  if (!/^[A-Z0-9_]+$/.test(value)) return value;
  const words = value.toLowerCase().replaceAll('_', ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** The random tail of a UUIDv7; its leading characters encode a timestamp and repeat. */
export function shortId(id: string): string {
  return `…${id.slice(-8)}`;
}
