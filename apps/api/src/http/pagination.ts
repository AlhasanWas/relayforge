import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 100;

/**
 * Cursor pagination over UUIDv7 ids, newest first. Ids are time-ordered, so the
 * cursor is simply the last id of the previous page: stable under concurrent inserts.
 */
export class PageQueryDto {
  @ApiPropertyOptional({ minimum: 1, maximum: MAX_PAGE_SIZE, default: DEFAULT_PAGE_SIZE })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  limit?: number;

  @ApiPropertyOptional({ description: 'The `nextCursor` value from the previous page' })
  @IsOptional()
  @IsUUID()
  cursor?: string;
}

export interface Page<T> {
  data: T[];
  nextCursor: string | null;
}

export interface PageArgs {
  take: number;
  where: { id?: { lt: string } };
  orderBy: { id: 'desc' };
}

/** Prisma arguments that fetch one extra row to learn whether another page exists. */
export function pageArgs(query: PageQueryDto): PageArgs {
  return {
    take: (query.limit ?? DEFAULT_PAGE_SIZE) + 1,
    where: query.cursor === undefined ? {} : { id: { lt: query.cursor } },
    orderBy: { id: 'desc' },
  };
}

export function toPage<Row extends { id: string }, T>(
  rows: Row[],
  query: PageQueryDto,
  map: (row: Row) => T,
): Page<T> {
  const limit = query.limit ?? DEFAULT_PAGE_SIZE;
  const pageRows = rows.slice(0, limit);
  const last = pageRows.at(-1);
  return {
    data: pageRows.map(map),
    nextCursor: rows.length > limit && last !== undefined ? last.id : null,
  };
}
