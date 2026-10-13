// verovio@6 ships no TypeScript declarations; this is the minimal ambient typing the spike needs.
declare module 'verovio/wasm' {
  const createVerovioModule: (opts?: Record<string, unknown>) => Promise<unknown>;
  export default createVerovioModule;
}
declare module 'verovio/esm' {
  export class VerovioToolkit {
    constructor(module: unknown);
    setOptions(o: Record<string, unknown>): void;
    getOptions(): Record<string, unknown>;
    getAvailableOptions(): Record<string, unknown>;
    loadData(data: string): boolean;
    loadZipDataBuffer(data: ArrayBuffer): boolean;
    getPageCount(): number;
    renderToSVG(page?: number, xmlDeclaration?: boolean): string;
    renderToTimemap(o?: Record<string, unknown>): Array<{ tstamp: number; qstamp: number; on?: string[]; off?: string[]; restsOn?: string[]; tempo?: number; measureOn?: string }>;
    renderToMIDI(): string;
    getElementsAtTime(ms: number): { notes: string[]; chords: string[]; rests: string[]; page: number; measure: string };
    getMIDIValuesForElement(id: string): { pitch: number; time: number; duration: number };
    getTimesForElement(id: string): Record<string, unknown>;
    getTimeForElement(id: string): number;
    getElementAttr(id: string): Record<string, string>;
    getPageWithElement(id: string): number;
    getNotatedIdForElement(id: string): string;
    getMEI(o?: Record<string, unknown>): string;
    redoLayout(o?: Record<string, unknown>): void;
    edit(action: Record<string, unknown>): boolean;
    editInfo(): unknown;
    select(sel: Record<string, unknown>): void;
    getVersion(): string;
    getLog(): string;
    destroy(): void;
  }
  export const enableLog: (level: number, module?: unknown) => void;
  export const LOG_OFF: number;
}
