import { afterEach, expect, it } from 'vitest';
import { cameraDebugRequested } from './diagnosis.js';

afterEach(() => sessionStorage.clear());

it('issue 147: camera=debug works before or after the hash, and stays on in the tab', () => {
  expect(cameraDebugRequested('', '')).toBe(false);
  expect(cameraDebugRequested('?audio=silent', '#/library')).toBe(false);
  expect(cameraDebugRequested('?camera=debug', '#/')).toBe(true);
  sessionStorage.clear();
  expect(cameraDebugRequested('', '#?camera=debug')).toBe(true);
  sessionStorage.clear();
  expect(cameraDebugRequested('', '#/scan?camera=debug')).toBe(true);
  // Remembered once asked: the app's own navigation may drop it from the address.
  expect(cameraDebugRequested('', '#/library')).toBe(true);
  sessionStorage.clear();
  expect(cameraDebugRequested('?camera=debugger', '')).toBe(false);
});
