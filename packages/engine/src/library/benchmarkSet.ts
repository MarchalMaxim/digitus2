/**
 * The library pieces a measurement uses. Library-based floors and metrics (hand separation on the
 * library, repeat consistency, the library checks in the engine tests) measure one benchmark set,
 * so that growing the built-in library never moves a number. The 30 pieces of the first library
 * carry `benchmarkSet: "core30"` in content/manifest.json; later pieces carry null (L1 plan,
 * decision 4). Pure: no Node API, so src/ and cli/ can both use it.
 */
export const CORE_BENCHMARK_SET = 'core30';

export interface BenchmarkTagged {
  slug: string;
  benchmarkSet?: string | null;
}

/**
 * The entries of `set` in manifest order. 'all' returns every entry; so does a manifest in which
 * no entry has a benchmarkSet (a manifest from before benchmark sets, or a test fixture). A named
 * set that no entry belongs to is an error, never an empty measurement.
 */
export function benchmarkEntries<T extends BenchmarkTagged>(
  entries: readonly T[],
  set: string = CORE_BENCHMARK_SET,
): T[] {
  if (set === 'all') return [...entries];
  if (!entries.some((e) => typeof e.benchmarkSet === 'string')) return [...entries];
  const chosen = entries.filter((e) => e.benchmarkSet === set);
  if (chosen.length === 0) throw new Error(`no library piece is in benchmark set "${set}"`);
  return chosen;
}
