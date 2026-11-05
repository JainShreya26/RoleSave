const pageSize = 500;

interface Page<Row, Failure> {
  data: Row[] | null;
  error: Failure | null;
}

/**
 * Reads every row of a query, a page at a time. Supabase caps each response at
 * 1,000 rows by default without saying so, which would drop rows from long lists.
 *
 * `readPage` should order by a column that never changes, such as `id`, so a row
 * cannot move between pages while they are being read.
 */
export async function fetchAllRows<Row, Failure>(
  readPage: (from: number, to: number) => PromiseLike<Page<Row, Failure>>,
): Promise<{ data: Row[]; error: null } | { data: null; error: Failure }> {
  const rows: Row[] = [];
  while (true) {
    const { data, error } = await readPage(rows.length, rows.length + pageSize - 1);
    if (error) return { data: null, error };
    const page = data ?? [];
    rows.push(...page);
    if (page.length < pageSize) return { data: rows, error: null };
  }
}
