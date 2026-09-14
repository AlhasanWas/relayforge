import { pageArgs, toPage } from './pagination';

const rows = (count: number) =>
  Array.from({ length: count }, (_, index) => ({ id: `id-${String(count - index)}` }));

describe('pagination', () => {
  it('requests one row beyond the page size', () => {
    expect(pageArgs({ limit: 10 })).toEqual({ take: 11, where: {}, orderBy: { id: 'desc' } });
    expect(pageArgs({}).take).toBe(51);
  });

  it('continues strictly after the cursor', () => {
    expect(pageArgs({ cursor: 'c' }).where).toEqual({ id: { lt: 'c' } });
  });

  it('returns the last id as the cursor when more rows exist', () => {
    const page = toPage(rows(4), { limit: 3 }, (row) => row.id);

    expect(page).toEqual({ data: ['id-4', 'id-3', 'id-2'], nextCursor: 'id-2' });
  });

  it('returns a null cursor on the last page', () => {
    expect(toPage(rows(3), { limit: 3 }, (row) => row.id).nextCursor).toBeNull();
    expect(toPage([], { limit: 3 }, (row: { id: string }) => row.id)).toEqual({
      data: [],
      nextCursor: null,
    });
  });
});
