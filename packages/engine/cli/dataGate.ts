/**
 * Some checks read datasets that are not in the repository (their licences forbid redistribution),
 * so CI and a fresh clone do not have them. A skipped check reads as a pass, so a missing dataset
 * is said out loud, and DIGITUS2_REQUIRE_DATA=1 turns the skip into a failure on a machine that is
 * meant to have the data.
 *
 * Use it where a suite decides whether to run: `describe.skipIf(!dataGate('corpora', have))`.
 */
export function dataGate(what: string, present: boolean): boolean {
  if (present) return true;
  const message = `${what}: the dataset is not on this machine, so these checks did not run`;
  if (process.env['DIGITUS2_REQUIRE_DATA'] === '1') {
    throw new Error(`${message} (DIGITUS2_REQUIRE_DATA=1 makes that a failure)`);
  }
  console.warn(`SKIPPED ${message}. Set DIGITUS2_REQUIRE_DATA=1 to fail instead.`);
  return false;
}
