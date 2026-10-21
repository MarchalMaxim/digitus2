import { expect, type Page } from '@playwright/test';

interface ScoreCamera {
  move(x: number, y: number, score?: number): void;
  freeze(value: boolean): void;
  /** Scene light, 1 = a normally lit page; the torch adds to it. */
  light(value: number): void;
  /** Defocus or shake, in source pixels; 0 is sharp. */
  blur(value: number): void;
  created: number;
  stopped: number;
  frames: number;
  torch: boolean;
  /** Every torch constraint the page applied, and 'stop' when the track stopped, in order. */
  log: (boolean | 'stop')[];
}
declare global {
  interface Window {
    scoreCamera: ScoreCamera;
  }
}

export interface CameraOptions {
  mode?: 'live' | 'denied';
  /** The camera reports a light the page can switch (as Android Chrome does). */
  torch?: boolean;
  light?: number;
  /** The page lies on a dark table, smaller than the frame, so its outline can be found. */
  table?: boolean;
}

/**
 * Only replace the physical camera. Every frame still goes through video, tracking and fusion;
 * the camera can be dark, out of focus or shaky, and its torch really brightens its picture.
 */
export async function installScoreCamera(
  page: Page,
  modeOrOptions: 'live' | 'denied' | CameraOptions = 'live',
) {
  const options = typeof modeOrOptions === 'string' ? { mode: modeOrOptions } : modeOrOptions;
  await page.addInitScript(
    ({ mode = 'live', torch = false, light: initialLight = 1, table = false }: CameraOptions) => {
      const canvas = document.createElement('canvas');
      canvas.width = 360;
      canvas.height = 480;
      const context = canvas.getContext('2d')!;
      let x = 0;
      let y = 0;
      let score = 1;
      let frozen = false;
      let light = initialLight;
      let blur = 0;
      const source = document.createElement('canvas');
      source.width = canvas.width;
      source.height = canvas.height;
      const ink = source.getContext('2d')!;
      function drawScore() {
        ink.fillStyle = '#f5f5f5';
        ink.fillRect(0, 0, source.width, source.height);
        let seed = score * 0x14213;
        const random = () => {
          seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
          return seed / 4294967296;
        };
        ink.fillStyle = '#151515';
        ink.font = 'bold 16px serif';
        ink.fillText(`Piano ${score}`, 30, 30);
        for (let system = 0; system < 6; system++) {
          const top = 58 + system * 66;
          ink.strokeStyle = '#5a5a5a';
          ink.lineWidth = 1;
          for (let line = 0; line < 5; line++) {
            ink.beginPath();
            ink.moveTo(20, top + line * 5);
            ink.lineTo(340, top + line * 5);
            ink.stroke();
          }
          ink.fillStyle = '#101010';
          for (let note = 0; note < 17; note++) {
            const nx = 28 + note * 18 + Math.floor(random() * 4);
            const ny = top + Math.floor(random() * 10) * 2.5 - 2;
            const stem = 14 + Math.floor(random() * 10);
            ink.beginPath();
            ink.ellipse(nx, ny, 3.5, 2.5, -0.3, 0, Math.PI * 2);
            ink.fill();
            ink.fillRect(nx + 2, ny - stem, 1.5, stem);
            if (random() > 0.5) ink.fillRect(nx + 3, ny - stem, 6 + random() * 5, 2);
            if (random() > 0.75) ink.fillRect(nx - 7, ny - 3, 1.5, 9);
          }
          // Bar lines and measure numbers create distinctive two-dimensional neighborhoods.
          ink.font = '9px serif';
          for (let bar = 0; bar < 4; bar++) {
            const bx = 25 + bar * 79 + Math.floor(random() * 8);
            ink.fillRect(bx, top - 1, 1, 23);
            ink.fillText(String(system * 4 + bar + score), bx, top - 13);
          }
        }
      }
      const camera: ScoreCamera = {
        freeze(value) {
          frozen = value;
        },
        light(value) {
          light = value;
        },
        blur(value) {
          blur = value;
        },
        created: 0,
        stopped: 0,
        frames: 0,
        torch: false,
        log: [],
        move(nextX, nextY, nextScore = score) {
          x = nextX;
          y = nextY;
          if (score !== nextScore) {
            score = nextScore;
            drawScore();
          }
        },
      };
      window.scoreCamera = camera;
      drawScore();
      function frame() {
        if (frozen) {
          requestAnimationFrame(frame);
          return;
        }
        const exposure = Math.min(1, light + (camera.torch ? 0.85 : 0));
        context.filter = 'none';
        context.fillStyle = table ? '#2a2a2a' : '#f5f5f5';
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.filter = `brightness(${exposure})${blur ? ` blur(${blur}px)` : ''}`;
        if (table) context.drawImage(source, 50 + x, 66 + y, 260, 347);
        else context.drawImage(source, x, y);
        camera.frames++;
        requestAnimationFrame(frame);
      }
      frame();
      Object.defineProperty(navigator, 'mediaDevices', {
        configurable: true,
        value: {
          getUserMedia: async () => {
            if (mode === 'denied')
              throw new DOMException('Camera permission denied', 'NotAllowedError');
            const stream = canvas.captureStream(30);
            camera.created++;
            for (const track of stream.getTracks()) {
              const stop = track.stop.bind(track);
              track.stop = () => {
                camera.stopped++;
                camera.log.push('stop');
                stop();
              };
              if (!torch) continue;
              const capabilities = track.getCapabilities.bind(track);
              track.getCapabilities = () => ({ ...capabilities(), torch: true }) as never;
              track.applyConstraints = async (constraints?: MediaTrackConstraints) => {
                for (const set of constraints?.advanced ?? []) {
                  const value = (set as { torch?: boolean }).torch;
                  if (typeof value !== 'boolean') continue;
                  camera.torch = value;
                  camera.log.push(value);
                }
              };
            }
            return stream;
          },
        },
      });
    },
    options,
  );
}

export async function moveScore(page: Page, x: number, y: number, score?: number) {
  const before = await page.evaluate(
    ({ x, y, score }) => {
      window.scoreCamera.move(x, y, score);
      return window.scoreCamera.frames;
    },
    { x, y, score },
  );
  // Let the changed source reach the real video stream before a reference still is taken.
  await expect
    .poll(() => page.evaluate((before) => window.scoreCamera.frames - before, before), {
      intervals: [25, 50],
    })
    .toBeGreaterThan(3);
}

export async function expectCameraStopped(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(() => ({
        created: window.scoreCamera.created,
        stopped: window.scoreCamera.stopped,
      })),
    )
    .toEqual({ created: 1, stopped: 1 });
}
