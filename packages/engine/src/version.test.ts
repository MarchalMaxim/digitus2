import { describe, expect, it } from 'vitest';
import { ENGINE_VERSION } from './index.js';

describe('engine package', () => {
  it('exposes a semver version', () => {
    expect(ENGINE_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
