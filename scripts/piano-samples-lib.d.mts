// Types for piano-samples-lib.mjs, so the TypeScript tests in apps/web can import it.
export interface TarEntry {
  name: string;
  data: Uint8Array;
}
export interface SampleSource {
  name: string;
  format: string;
  data: Uint8Array;
  gitBlobSha1: string;
}
export interface PianoSamplesLock {
  tag: string;
  repository: string;
  asset: string;
  bytes: number;
  sha256: string;
  files: string[];
}
export const TAG: string;
export const ASSET_NAME: string;
export const RELEASE_REPOSITORY: string;
export const SOURCE_REPOSITORY: string;
export const SOURCE_COMMIT: string;
export const FORMATS: string[];
export const LOCK_FILE: string;
export const README: string;
export function sampleFileName(name: string): string;
export function sha256(bytes: Uint8Array): string;
export function gitBlobSha1(bytes: Uint8Array): string;
export function writeTar(entries: readonly TarEntry[]): Uint8Array;
export function readTar(bytes: Uint8Array): TarEntry[];
export function assetEntries(samples: readonly SampleSource[]): TarEntry[];
export function lockFor(tar: Uint8Array, entries: readonly TarEntry[]): PianoSamplesLock;
export function checkAssetEntries(entries: readonly TarEntry[], lock: PianoSamplesLock): void;
