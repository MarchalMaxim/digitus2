// Types for check-colors.mjs, so the TypeScript test in apps/web/src/design can import it.
export interface ColorProblem {
  path: string;
  line: number;
  reason: string;
}

export function findForbiddenColors(files: { path: string; text: string }[]): ColorProblem[];
