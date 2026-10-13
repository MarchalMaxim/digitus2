// Web APIs that browsers and Node both provide as globals and that src/ uses. The src-only type
// check (tsconfig.src.json) runs without DOM and Node types so that any other platform API fails
// it (M2 global constraint: no DOM or Node-only APIs outside cli/); this file declares the few
// universal ones it may use.
declare class TextDecoder {
  constructor(label?: string, options?: { fatal?: boolean; ignoreBOM?: boolean });
  decode(input?: ArrayBufferView | ArrayBuffer, options?: { stream?: boolean }): string;
}
