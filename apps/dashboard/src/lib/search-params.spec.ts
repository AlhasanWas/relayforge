import { enumParam, hrefWith, isUuid, uuidParam } from './search-params';

const STATUSES = ['PENDING', 'DEAD_LETTER'] as const;

describe('enumParam', () => {
  it('accepts only known values', () => {
    expect(enumParam({ status: 'DEAD_LETTER' }, 'status', STATUSES)).toBe('DEAD_LETTER');
    expect(enumParam({ status: 'dead_letter' }, 'status', STATUSES)).toBeUndefined();
    expect(enumParam({}, 'status', STATUSES)).toBeUndefined();
  });

  it('uses the first of repeated parameters', () => {
    expect(enumParam({ status: ['PENDING', 'DEAD_LETTER'] }, 'status', STATUSES)).toBe('PENDING');
  });
});

describe('uuidParam', () => {
  it('ignores malformed ids instead of forwarding them to the API', () => {
    const id = '01a0a480-10b7-779d-83bf-01c20f4ec4b3';
    expect(uuidParam({ cursor: id }, 'cursor')).toBe(id);
    expect(uuidParam({ cursor: "1' OR '1'='1" }, 'cursor')).toBeUndefined();
    expect(isUuid('not-a-uuid')).toBe(false);
  });
});

describe('hrefWith', () => {
  it('omits empty values', () => {
    expect(hrefWith('/deliveries', { status: 'DEAD_LETTER', cursor: undefined })).toBe(
      '/deliveries?status=DEAD_LETTER',
    );
    expect(hrefWith('/deliveries', { status: '' })).toBe('/deliveries');
  });
});
