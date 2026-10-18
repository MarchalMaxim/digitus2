// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const publicFile = (path: string) => new URL(`../../public/${path}`, import.meta.url);
const manifest = JSON.parse(readFileSync(publicFile('manifest.webmanifest'), 'utf8')) as {
  [key: string]: unknown;
  icons: { src: string; sizes: string; type: string; purpose: string }[];
};

describe('the web app manifest', () => {
  it('installs the app full screen under its name, wherever the site is served', () => {
    expect(manifest).toMatchObject({
      id: './',
      name: 'digitus2',
      short_name: 'digitus2',
      start_url: './',
      scope: './',
      display: 'standalone',
      background_color: '#ffffff',
      theme_color: '#ffffff',
    });
    expect(manifest).not.toHaveProperty('description');
  });

  it('lists PNG icons of the sizes it claims, a maskable one included', () => {
    for (const icon of manifest.icons) {
      const png = readFileSync(publicFile(icon.src));
      expect(png.subarray(0, 8).toString('hex'), icon.src).toBe('89504e470d0a1a0a');
      const [width, height] = icon.sizes.split('x').map(Number);
      expect([png.readUInt32BE(16), png.readUInt32BE(20)], icon.src).toEqual([width, height]);
      expect(icon.type).toBe('image/png');
    }
    expect(manifest.icons.map((i) => `${i.sizes} ${i.purpose}`)).toEqual([
      '192x192 any',
      '512x512 any',
      '512x512 maskable',
    ]);
    expect(existsSync(publicFile('icons/apple-touch-icon.png'))).toBe(true);
  });

  it('draws the icon in black and white only', () => {
    const svg = readFileSync(publicFile('icon.svg'), 'utf8');
    expect(new Set(svg.match(/#[0-9a-f]{3,8}\b/gi))).toEqual(new Set(['#000000', '#ffffff']));
  });

  it('is linked from index.html with the icon and the Apple touch icon', () => {
    const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
    expect(html).toContain('<link rel="manifest" href="/manifest.webmanifest" />');
    expect(html).toContain('<link rel="icon" href="/icon.svg" type="image/svg+xml" />');
    expect(html).toContain('<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />');
  });
});
