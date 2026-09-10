// Chunked createMany helper — SQLite has a bound-parameter limit per statement, so a
// single createMany() call over hundreds of thousands of rows needs splitting.
export function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

export async function createManyChunked<T>(
  createMany: (data: T[]) => Promise<unknown>,
  rows: T[],
  chunkSize = 1000,
  label = "rows"
): Promise<void> {
  const chunks = chunk(rows, chunkSize);
  for (let i = 0; i < chunks.length; i++) {
    await createMany(chunks[i]);
    if (chunks.length > 1) {
      console.log(`  ${label}: ${Math.min((i + 1) * chunkSize, rows.length)}/${rows.length}`);
    }
  }
}
