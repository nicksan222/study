/** Build a cursor page from a query that fetched one extra row. */
export function cursorPage<T, C>(rows: T[], limit: number, cursor: (row: T) => C) {
  return {
    items: rows.slice(0, limit),
    nextCursor: rows.length > limit ? cursor(rows[limit - 1]!) : null
  };
}
