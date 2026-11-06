/**
 * Rows from `DataSource.query` / `EntityManager.query`. For UPDATE and DELETE
 * the Postgres driver returns `[rows, affectedCount]` instead of the rows, so
 * a `RETURNING` result has to be unwrapped — its raw `.length` is always 2.
 * (Missing this made every order-draft item add look like an update of an
 * existing row, so nothing was inserted, and let payment details be claimed
 * twice.)
 */
export function returnedRows<T>(raw: unknown): T[] {
  if (Array.isArray(raw) && raw.length === 2 && Array.isArray(raw[0]) && typeof raw[1] === 'number') {
    return raw[0] as T[];
  }
  return raw as T[];
}
