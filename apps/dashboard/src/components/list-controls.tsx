import Link from 'next/link';
import { humanize } from '@/lib/format';
import { hrefWith } from '@/lib/search-params';

/** Filter links: a plain navigation, so filters work without client JavaScript. */
export function FilterTabs<const Value extends string>({
  pathname,
  param,
  values,
  current,
  keep = {},
}: {
  pathname: string;
  param: string;
  values: readonly Value[];
  current: Value | undefined;
  /** Other filters to preserve when switching this one. */
  keep?: Record<string, string | undefined>;
}) {
  const options = [
    { label: 'All', value: undefined },
    ...values.map((value) => ({ label: humanize(value), value })),
  ];
  return (
    <nav aria-label="Filter" className="mb-4 overflow-x-auto">
      <ul className="border-line bg-surface inline-flex gap-1 rounded-lg border p-1">
        {options.map((option) => {
          const active = option.value === current;
          return (
            <li key={option.label}>
              <Link
                href={hrefWith(pathname, { ...keep, [param]: option.value })}
                aria-current={active ? 'true' : undefined}
                className={`block rounded-md px-2.5 py-1 text-xs whitespace-nowrap ${
                  active ? 'bg-subtle text-ink font-medium' : 'text-muted hover:text-ink'
                }`}
              >
                {option.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/**
 * Cursor pagination moves forward through older rows; "Newest" returns to the start.
 * Existing filters are kept.
 */
export function Pagination({
  pathname,
  filters,
  cursor,
  nextCursor,
}: {
  pathname: string;
  filters: Record<string, string | undefined>;
  cursor: string | undefined;
  nextCursor: string | null;
}) {
  if (cursor === undefined && nextCursor === null) return null;
  const linkClass = 'border-line bg-surface hover:bg-subtle rounded-md border px-3 py-1.5 text-xs';
  return (
    <nav aria-label="Pagination" className="mt-4 flex justify-end gap-2">
      {cursor !== undefined && (
        <Link href={hrefWith(pathname, filters)} className={linkClass}>
          ← Newest
        </Link>
      )}
      {nextCursor !== null && (
        <Link href={hrefWith(pathname, { ...filters, cursor: nextCursor })} className={linkClass}>
          Older →
        </Link>
      )}
    </nav>
  );
}
