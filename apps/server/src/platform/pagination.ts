/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Builds a cursor page from a query result that may contain one extra row. The extra │
 * │ row signals a next cursor without being returned in the current page.                    │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Exports cursorPage. The extra row signals a next cursor without being returned in the  │
 * │   current page.                                                                          │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Feature list queries pass fetched rows and a cursor selector; the query owns ordering    │
 * │ and this helper only shapes the page.                                                    │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

/** Build a cursor page from a query that fetched one extra row. */
export function cursorPage<T, C>(rows: T[], limit: number, cursor: (row: T) => C) {
  return {
    items: rows.slice(0, limit),
    nextCursor: rows.length > limit ? cursor(rows[limit - 1]!) : null
  };
}
