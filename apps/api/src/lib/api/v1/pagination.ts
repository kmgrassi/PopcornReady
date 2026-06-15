export interface PageResult<T> {
  items: T[];
  nextCursor: string | null;
}

// Newest-first cursor pagination keyed on stable record IDs. We over-fetch by one
// to learn whether more rows exist, then trim. The (created_at desc, id desc)
// ordering matches the old JSON sort exactly; the cursor is the last item's id and
// its created_at locates the seek position even when timestamps collide.
function orderTuple(
  a: { id: string; createdAt: string },
  b: { id: string; createdAt: string }
): number {
  if (a.createdAt === b.createdAt) return a.id < b.id ? 1 : -1;
  return a.createdAt < b.createdAt ? 1 : -1;
}

export function paginate<T extends { id: string; createdAt: string }>(
  all: T[],
  limit: number,
  cursor: string | null
): PageResult<T> {
  const sorted = [...all].sort(orderTuple);
  let start = 0;
  if (cursor) {
    const idx = sorted.findIndex((item) => item.id === cursor);
    start = idx === -1 ? sorted.length : idx + 1;
  }
  const items = sorted.slice(start, start + limit);
  const nextCursor =
    start + limit < sorted.length && items.length > 0
      ? items[items.length - 1].id
      : null;
  return { items, nextCursor };
}

function updatedOrderTuple(
  a: { id: string; updatedAt: string },
  b: { id: string; updatedAt: string }
): number {
  if (a.updatedAt === b.updatedAt) return a.id < b.id ? 1 : -1;
  return a.updatedAt < b.updatedAt ? 1 : -1;
}

export function paginateByUpdatedAt<T extends { id: string; updatedAt: string }>(
  all: T[],
  limit: number,
  cursor: string | null
): PageResult<T> {
  const sorted = [...all].sort(updatedOrderTuple);
  let start = 0;
  if (cursor) {
    const idx = sorted.findIndex((item) => item.id === cursor);
    start = idx === -1 ? sorted.length : idx + 1;
  }
  const items = sorted.slice(start, start + limit);
  const nextCursor =
    start + limit < sorted.length && items.length > 0
      ? items[items.length - 1].id
      : null;
  return { items, nextCursor };
}
