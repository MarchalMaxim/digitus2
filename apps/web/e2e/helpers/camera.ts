import { expect, type Page } from '@playwright/test';

interface ScoreCamera {
  move(x: number, y: number, score?: number): void;
  freeze(value: boolean): void;
  created: number;
  stopped: number;
  frames: number;
}
declare global {
  interface Window {
    scoreCamera: ScoreCamera;
  }
}

/** Only replace the physical camera. Every frame still goes through video, tracking and fusion. */
export async function installScoreCamera(page: Page, mode: 'live' | 'denied' = 'live') {
  await page.addInitScript(
    ({ mode }) => {
      const canvas = document.createElement('canvas');
      canvas.width = 360;
      canvas.height = 480;
      const context = canvas.getContext('2d')!;
      let x = 0;
      let y = 0;
      let score = 1;
      let frozen = false;
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
        created: 0,
        stopped: 0,
        frames: 0,
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
        context.fillStyle = '#f5f5f5';
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(source, x, y);
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
                stop();
              };
            }
            return stream;
          },
        },
      });
    },
    { mode },
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
