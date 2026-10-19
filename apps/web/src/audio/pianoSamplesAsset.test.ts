// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  assetEntries,
  checkAssetEntries,
  gitBlobSha1,
  lockFor,
  readTar,
  sampleFileName,
  sha256,
  writeTar,
  type SampleSource,
  type TarEntry,
} from '../../../../scripts/piano-samples-lib.mjs';

const bytes = (text: string) => new TextEncoder().encode(text);
const source = (name: string, format: string, data: Uint8Array): SampleSource => ({
  name,
  format,
  data,
  gitBlobSha1: gitBlobSha1(data),
});
const samples: SampleSource[] = [
  source('PP C#1', 'ogg', bytes('ogg one')),
  source('PP C#1', 'm4a', bytes('m4a one')),
  source('Mf B-1', 'ogg', bytes('x'.repeat(700))),
];
const hex = (data: Uint8Array) => Buffer.from(data).toString('hex');

describe('the piano samples asset', () => {
  it('names a sample so that its URL needs no escaping', () => {
    expect(sampleFileName('PP C#1')).toBe('PP_Cs1');
    expect(sampleFileName('Mf B-1')).toBe('Mf_B-1');
  });

  it('hashes like git hash-object and like sha256sum', () => {
    expect(gitBlobSha1(new Uint8Array())).toBe('e69de29bb2d1d6434b8b29ae775ad8c2e48c5391');
    expect(gitBlobSha1(bytes('hello\n'))).toBe('ce013625030ba8dba906f756967f9e9ca394464a');
    expect(sha256(bytes('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('writes a deterministic tar that reads back to the same entries', () => {
    const entries: TarEntry[] = [
      { name: 'a.ogg', data: bytes('a') },
      { name: 'b.m4a', data: new Uint8Array(1024).fill(7) },
    ];
    const tar = writeTar(entries);
    expect(tar.length).toBe(512 + 512 + 512 + 1024 + 1024);
    expect(hex(writeTar(entries))).toBe(hex(tar));
    expect(readTar(tar).map((e) => [e.name, hex(e.data)])).toEqual(
      entries.map((e) => [e.name, hex(e.data)]),
    );
  });

  it('refuses a corrupted header, a missing end marker and a name over 100 bytes', () => {
    const tar = Buffer.from(writeTar([{ name: 'a.ogg', data: bytes('a') }]));
    const corrupted = Buffer.from(tar);
    corrupted[0] = 0x62;
    expect(() => readTar(corrupted)).toThrow(/checksum/);
    expect(() => readTar(tar.subarray(0, tar.length - 1024))).toThrow(/end marker/);
    expect(() => writeTar([{ name: `${'a'.repeat(101)}.ogg`, data: bytes('a') }])).toThrow(/100/);
  });

  it('builds entries whose manifest the checks accept, and a lock that pins the tar', () => {
    const entries = assetEntries(samples);
    expect(entries.map((e) => e.name)).toEqual([
      'README.md',
      'manifest.json',
      'Mf_B-1.ogg',
      'PP_Cs1.m4a',
      'PP_Cs1.ogg',
    ]);
    const tar = writeTar(entries);
    const lock = lockFor(tar, entries);
    expect(lock).toEqual({
      tag: 'piano-samples-v1',
      repository: 'MarchalMaxim/digitus2',
      asset: 'splendid-grand-piano-v1.tar',
      bytes: tar.length,
      sha256: sha256(tar),
      files: ['Mf_B-1.ogg', 'PP_Cs1.m4a', 'PP_Cs1.ogg'],
    });
    expect(() => checkAssetEntries(readTar(tar), lock)).not.toThrow();
    const manifest = JSON.parse(Buffer.from(entries[1]!.data).toString('utf8'));
    expect(manifest.source).toEqual({
      repository: 'https://github.com/smpldsnds/sfzinstruments-splendid-grand-piano',
      commit: '009793ebf849aee57f9a213aeaf8f2d1e2178f4f',
      path: 'samples',
    });
    expect(manifest.files[2]).toEqual({
      file: 'PP_Cs1.ogg',
      source: 'samples/PP C#1.ogg',
      bytes: 7,
      sha256: sha256(bytes('ogg one')),
      gitBlobSha1: gitBlobSha1(bytes('ogg one')),
    });
  });

  it('refuses a changed file, an unsafe name, a missing file and a duplicate', () => {
    const entries = assetEntries(samples);
    const lock = lockFor(writeTar(entries), entries);
    const changed = entries.map((e) =>
      e.name === 'PP_Cs1.ogg' ? { ...e, data: bytes('ogg 0ne') } : e,
    );
    expect(() => checkAssetEntries(changed, lock)).toThrow(/PP_Cs1\.ogg/);
    expect(() =>
      checkAssetEntries([...entries, { name: '../evil.ogg', data: bytes('x') }], lock),
    ).toThrow(/unexpected entry/);
    expect(() =>
      checkAssetEntries(
        entries.filter((e) => e.name !== 'Mf_B-1.ogg'),
        lock,
      ),
    ).toThrow(/manifest/);
    expect(() => checkAssetEntries([...entries, entries[2]!], lock)).toThrow(/duplicate/);
  });

  it('refuses two samples whose files differ only in case', () => {
    expect(() => assetEntries([...samples, { ...samples[0]!, name: 'pp C#1' }])).toThrow(
      /two samples/,
    );
  });
});
