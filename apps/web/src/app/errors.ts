/** The message of anything thrown: an Error's message, else the value as text. */
export function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
