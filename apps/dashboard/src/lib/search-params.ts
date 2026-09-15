export type SearchParams = Record<string, string | string[] | undefined>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID.test(value);
}

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** A value from a fixed set, or undefined when absent or not one of them. */
export function enumParam<const Values extends readonly string[]>(
  params: SearchParams,
  name: string,
  values: Values,
): Values[number] | undefined {
  const raw = single(params[name]);
  return values.find((value) => value === raw);
}

/** A UUID parameter such as a pagination cursor, or undefined when absent or malformed. */
export function uuidParam(params: SearchParams, name: string): string | undefined {
  const raw = single(params[name]);
  return raw !== undefined && isUuid(raw) ? raw : undefined;
}

/** Builds a query string from the defined values, for filter and pagination links. */
export function hrefWith(pathname: string, params: Record<string, string | undefined>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') query.set(key, value);
  }
  const serialized = query.toString();
  return serialized === '' ? pathname : `${pathname}?${serialized}`;
}
