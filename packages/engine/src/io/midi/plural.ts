/** `1 note` / `3 notes`: every count in a warning goes through this. */
export function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}
