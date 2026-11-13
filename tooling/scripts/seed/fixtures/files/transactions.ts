/** Keep related writes inside one synchronous transaction boundary. */
export function transfer(
  transaction: (work: () => void) => void,
  debit: () => void,
  credit: () => void
) {
  transaction(() => {
    debit();
    credit();
  });
}

// The callbacks describe an example, not an application service implementation.
// If credit throws, the transaction owner must roll back the debit as well.
// Do not hold a synchronous SQLite transaction across an await.
