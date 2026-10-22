import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, type Page } from '@playwright/test';

interface ScoreCamera {
  move(x: number, y: number, score?: number): void;
  /** Move to (x, y) smoothly over `ms` milliseconds of page time, as a hand does. */
  glide(x: number, y: number, ms: number): void;
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
  /** Where the page is now, in camera pixels from its starting place (glides included). */
  x: number;
  y: number;
  /** A glide is under way. */
  moving: boolean;
  /** The picture is ready to film (a photographed page has loaded). */
  ready: boolean;
  /** Why a photographed page could not be filmed. */
  error: string | null;
  /** The camera's own picture, as the stream carries it. */
  canvas: HTMLCanvasElement;
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
  /**
   * Film a photograph of a printed page (a same-origin URL) lying on a darker table, through a
   * pinhole camera: true perspective, handheld jitter, motion blur while moving and sensor noise.
   * `installPhotoCamera` serves the committed photo and sets this.
   */
  photo?: string;
  /** The camera's picture size; 360 x 480 unless given. */
  width?: number;
  height?: number;
  /** Camera tilt in degrees: pitch (top edge away), yaw and roll. */
  tilt?: { pitch?: number; yaw?: number; roll?: number };
  /** Share of the picture's height the page fills when the camera is over its centre. */
  fill?: number;
  /** Handheld tremor amplitude in camera pixels (bounded, mean-reverting). */
  jitter?: number;
  /** Sensor noise, standard deviation in 8-bit levels. */
  noise?: number;
  /** Smear the picture along the motion while a glide is under way. */
  motionBlur?: boolean;
  /** Systems of music on the drawn page, from the top; fewer leave the rest blank (issue 147). */
  systems?: number;
  /** A shaking hand: every frame the drawn page lands up to this many camera pixels off. */
  shake?: number;
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
    ({
      mode = 'live',
      torch = false,
      light: initialLight = 1,
      table = false,
      photo,
      width = 360,
      height = 480,
      tilt = {},
      fill = 0.84,
      jitter = 1,
      noise = 2.5,
      motionBlur = true,
      systems = 6,
      shake = 0,
    }: CameraOptions) => {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d')!;
      const soft = document.createElement('canvas');
      const softContext = soft.getContext('2d')!;
      /** Whether this canvas applies filters: a white pixel blurred into black must spread. */
      const filters = (() => {
        const probe = document.createElement('canvas');
        probe.width = probe.height = 9;
        const c = probe.getContext('2d')!;
        c.fillRect(0, 0, 9, 9);
        const dot = document.createElement('canvas');
        dot.width = dot.height = 1;
        const d = dot.getContext('2d')!;
        d.fillStyle = '#fff';
        d.fillRect(0, 0, 1, 1);
        c.filter = 'blur(2px)';
        c.drawImage(dot, 4, 4);
        return c.getImageData(2, 4, 1, 1).data[0]! > 0;
      })();
      let x = 0;
      let y = 0;
      let score = 1;
      let frozen = false;
      let light = initialLight;
      let blur = 0;
      let glide: {
        from: [number, number];
        to: [number, number];
        start: number;
        ms: number;
      } | null = null;
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
        for (let system = 0; system < systems; system++) {
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
        x: 0,
        y: 0,
        moving: false,
        ready: !photo,
        error: null,
        canvas,
        move(nextX, nextY, nextScore = score) {
          glide = null;
          camera.moving = false;
          x = camera.x = nextX;
          y = camera.y = nextY;
          if (score !== nextScore) {
            score = nextScore;
            drawScore();
          }
        },
        glide(nextX, nextY, ms) {
          glide = {
            from: [x, y],
            to: [nextX, nextY],
            start: performance.now(),
            ms: Math.max(1, ms),
          };
          camera.moving = true;
        },
      };
      window.scoreCamera = camera;
      /** Advance a glide by page time, so a slow (throttled) page still moves continuously. */
      function step() {
        if (!glide) return;
        const t = Math.min(1, (performance.now() - glide.start) / glide.ms);
        const eased = t * t * (3 - 2 * t);
        x = camera.x = glide.from[0] + (glide.to[0] - glide.from[0]) * eased;
        y = camera.y = glide.from[1] + (glide.to[1] - glide.from[1]) * eased;
        if (t >= 1) {
          glide = null;
          camera.moving = false;
        }
      }
      const render = photo ? photoRenderer(photo) : null;
      let lastDrawn = -Infinity;
      if (!photo) drawScore();
      function frame() {
        if (frozen) {
          requestAnimationFrame(frame);
          return;
        }
        step();
        const exposure = Math.min(1, light + (camera.torch ? 0.85 : 0));
        // A shaking hand: this frame's page lands a little off, independently each frame.
        const sx = shake ? (Math.random() * 2 - 1) * shake : 0;
        const sy = shake ? (Math.random() * 2 - 1) * shake : 0;
        if (render) {
          // A phone camera delivers about 30 frames a second; drawing every animation frame
          // would only cost CPU (WebGL is software-rendered in headless Chromium).
          const now = performance.now();
          if (now - lastDrawn < 30 || !render(exposure)) {
            requestAnimationFrame(frame);
            return;
          }
          lastDrawn = now;
        } else if (filters) {
          context.filter = 'none';
          context.fillStyle = table ? '#2a2a2a' : '#f5f5f5';
          context.fillRect(0, 0, canvas.width, canvas.height);
          context.filter = `brightness(${exposure})${blur ? ` blur(${blur}px)` : ''}`;
          if (table) context.drawImage(source, 50 + x + sx, 66 + y + sy, 260, 347);
          else context.drawImage(source, x + sx, y + sy);
        } else {
          // Safari's canvas has no filter (issue 145). Blur is a box blur of shifted copies
          // averaged in turn, across and then down; exposure multiplies every pixel, as
          // brightness() does.
          context.fillStyle = table ? '#2a2a2a' : '#f5f5f5';
          context.fillRect(0, 0, canvas.width, canvas.height);
          if (table) context.drawImage(source, 50 + x + sx, 66 + y + sy, 260, 347);
          else context.drawImage(source, x + sx, y + sy);
          if (blur) {
            const reach = Math.ceil(blur * 1.5);
            soft.width = canvas.width;
            soft.height = canvas.height;
            for (const across of [true, false]) {
              softContext.drawImage(canvas, 0, 0);
              for (let shift = -reach, taps = 0; shift <= reach; shift++, taps++) {
                context.globalAlpha = 1 / (taps + 1);
                context.drawImage(soft, across ? shift : 0, across ? 0 : shift);
              }
              context.globalAlpha = 1;
            }
          }
          if (exposure < 1) {
            const level = Math.round(255 * exposure);
            context.globalCompositeOperation = 'multiply';
            context.fillStyle = `rgb(${level}, ${level}, ${level})`;
            context.fillRect(0, 0, canvas.width, canvas.height);
            context.globalCompositeOperation = 'source-over';
          }
        }
        camera.frames++;
        requestAnimationFrame(frame);
      }

      /**
       * A pinhole camera over a photographed page on a table, drawn by WebGL: each pixel's ray
       * meets the table plane, so the page is a true homography of the photo, and moving the
       * camera parallel to the table changes that homography as a real phone's would.
       */
      function photoRenderer(url: string) {
        const image = new Image();
        let decoded = false;
        image.src = url;
        image
          .decode()
          .then(() => {
            decoded = true;
          })
          .catch((cause: unknown) => {
            camera.error = `The page photo did not load: ${String(cause)}`;
          });
        const VERTEX = `#version 300 es
          in vec2 corner;
          void main() { gl_Position = vec4(corner, 0.0, 1.0); }`;
        const FRAGMENT = `#version 300 es
          precision highp float;
          uniform sampler2D page;
          uniform vec2 size;      // picture size in pixels
          uniform float focal;    // focal length in pixels
          uniform vec3 eye;       // camera centre; the table is the plane z = 0
          uniform mat3 rotation;  // camera to table axes
          uniform float aspect;   // page width over height (the page is 1 high)
          uniform vec2 smear;     // motion during the exposure, in pixels
          uniform float defocus;  // blur radius in pixels
          uniform float exposure;
          uniform float noise;    // standard deviation, 0..1
          uniform float seed;
          out vec4 colour;
          float hash(vec2 p) {
            p = fract(p * vec2(443.897, 441.423) + seed);
            p += dot(p, p.yx + 19.19);
            return fract((p.x + p.y) * p.x);
          }
          float lattice(vec2 i) {
            return fract(sin(dot(i, vec2(127.1, 311.7))) * 43758.5453);
          }
          float value(vec2 p) {
            vec2 i = floor(p), f = fract(p);
            f = f * f * (3.0 - 2.0 * f);
            return mix(
              mix(lattice(i), lattice(i + vec2(1.0, 0.0)), f.x),
              mix(lattice(i + vec2(0.0, 1.0)), lattice(i + vec2(1.0, 1.0)), f.x),
              f.y);
          }
          vec3 scene(vec2 pixel) {
            vec3 ray = rotation * vec3(pixel - size * 0.5, focal);
            if (ray.z <= 0.0) return vec3(0.0);
            vec2 table = eye.xy + ray.xy * (-eye.z / ray.z);
            vec2 uv = vec2(table.x / aspect + 0.5, table.y + 0.5);
            // A wooden table: dark, with slow grain along x and a fine texture.
            float grain = value(table * vec2(3.0, 40.0)) * 0.6 + value(table * 90.0) * 0.4;
            vec3 wood = vec3(0.30, 0.22, 0.16) * (0.82 + 0.3 * grain);
            vec2 outside = max(max(-uv, uv - 1.0), 0.0) * vec2(aspect, 1.0);
            wood *= 0.65 + 0.35 * smoothstep(0.0, 0.03, length(outside)); // the page's soft shadow
            vec2 texel = vec2(textureSize(page, 0));
            vec2 inside = min(uv, 1.0 - uv) * texel;
            float paper = clamp(
              min(inside.x, inside.y) / max(fwidth(uv.y) * texel.y, 1e-3) + 0.5, 0.0, 1.0);
            // Uneven light: brighter toward the top left, as from a window.
            float lit = 1.03 - 0.07 * length(table - vec2(-0.3, -0.4));
            vec3 ink = texture(page, clamp(uv, 0.0, 1.0)).rgb * lit;
            return mix(wood, ink, paper);
          }
          void main() {
            vec2 pixel = vec2(gl_FragCoord.x, size.y - gl_FragCoord.y);
            vec3 sum = vec3(0.0);
            float taps = (defocus > 0.0 || length(smear) > 0.25) ? 12.0 : 1.0;
            for (int i = 0; i < 12; i++) {
              if (float(i) >= taps) break;
              float k = taps > 1.0 ? float(i) / (taps - 1.0) : 0.5;
              float angle = float(i) * 2.39996;
              vec2 disk = defocus * sqrt((float(i) + 0.5) / taps) * vec2(cos(angle), sin(angle));
              sum += scene(pixel + disk - smear * k);
            }
            vec3 c = sum / taps * exposure;
            float n = (hash(pixel) + hash(pixel + 17.0) + hash(pixel + 41.0) - 1.5) * 2.0;
            colour = vec4(clamp(c + n * noise, 0.0, 1.0), 1.0);
          }`;
        let gpu: ReturnType<typeof program> | null = null;
        /**
         * A context made while the document is still loading is lost at once (headless
         * Chromium), and a GPU reset can lose one later: build it lazily, and again after a loss.
         */
        function program() {
          const gl = document.createElement('canvas');
          gl.width = width;
          gl.height = height;
          const g = gl.getContext('webgl2', { preserveDrawingBuffer: true, antialias: false });
          if (!g) throw new Error('WebGL 2 is unavailable');
          gl.addEventListener('webglcontextlost', (event) => {
            event.preventDefault();
            gpu = null;
          });
          const shader = (type: number, text: string) => {
            const s = g.createShader(type)!;
            g.shaderSource(s, text);
            g.compileShader(s);
            if (!g.getShaderParameter(s, g.COMPILE_STATUS)) throw new Error(g.getShaderInfoLog(s)!);
            return s;
          };
          const program = g.createProgram();
          g.attachShader(program, shader(g.VERTEX_SHADER, VERTEX));
          g.attachShader(program, shader(g.FRAGMENT_SHADER, FRAGMENT));
          g.linkProgram(program);
          if (!g.getProgramParameter(program, g.LINK_STATUS))
            throw new Error(g.getProgramInfoLog(program)!);
          g.useProgram(program);
          g.bindBuffer(g.ARRAY_BUFFER, g.createBuffer());
          g.bufferData(
            g.ARRAY_BUFFER,
            new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
            g.STATIC_DRAW,
          );
          const corner = g.getAttribLocation(program, 'corner');
          g.enableVertexAttribArray(corner);
          g.vertexAttribPointer(corner, 2, g.FLOAT, false, 0, 0);
          g.viewport(0, 0, width, height);
          g.bindTexture(g.TEXTURE_2D, g.createTexture());
          g.texImage2D(g.TEXTURE_2D, 0, g.RGBA, g.RGBA, g.UNSIGNED_BYTE, image);
          g.generateMipmap(g.TEXTURE_2D);
          g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, g.LINEAR_MIPMAP_LINEAR);
          g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MAG_FILTER, g.LINEAR);
          const anisotropy = g.getExtension('EXT_texture_filter_anisotropic');
          if (anisotropy) g.texParameterf(g.TEXTURE_2D, anisotropy.TEXTURE_MAX_ANISOTROPY_EXT, 4);
          const at = (name: string) => g.getUniformLocation(program, name);
          return { gl, g, at };
        }
        const radians = Math.PI / 180;
        const focal = height;
        // The camera's distance at which the page, 1 high, fills `fill` of the picture.
        const distance = focal / (fill * height);
        const phase = [Math.random() * 6.28, Math.random() * 6.28, Math.random() * 6.28];
        let last = { x, y };
        let frameNumber = 0;
        return (exposure: number): boolean => {
          if (!decoded || document.readyState === 'loading') return false;
          if (!gpu)
            try {
              gpu = program();
            } catch (cause) {
              camera.error = `The camera picture could not be drawn: ${String(cause)}`;
              return false;
            }
          const { gl, g, at } = gpu;
          const aspect = image.naturalWidth / image.naturalHeight;
          const now = performance.now() / 1000;
          // Tremor: two bounded sinusoids per axis and a little roll, never a drifting walk.
          const shakeX =
            jitter *
            (0.6 * Math.sin(8.2 * now + phase[0]!) + 0.4 * Math.sin(23.1 * now + phase[1]!));
          const shakeY =
            jitter *
            (0.6 * Math.sin(7.3 * now + phase[1]!) + 0.4 * Math.sin(19.7 * now + phase[2]!));
          const roll =
            ((tilt.roll ?? 0) + 0.04 * jitter * Math.sin(5.1 * now + phase[2]!)) * radians;
          const pitch = (tilt.pitch ?? 0) * radians;
          const yaw = (tilt.yaw ?? 0) * radians;
          // rotation = Rx(pitch) * Ry(yaw) * Rz(roll), camera axes to table axes.
          const [cp, sp, cy, sy, cr, sr] = [
            Math.cos(pitch),
            Math.sin(pitch),
            Math.cos(yaw),
            Math.sin(yaw),
            Math.cos(roll),
            Math.sin(roll),
          ];
          const rz = [cr, -sr, 0, sr, cr, 0, 0, 0, 1];
          const ry = [cy, 0, sy, 0, 1, 0, -sy, 0, cy];
          const rx = [1, 0, 0, 0, cp, -sp, 0, sp, cp];
          const multiply = (a: number[], b: number[]) =>
            [0, 1, 2].flatMap((r) =>
              [0, 1, 2].map(
                (c) => a[r * 3]! * b[c]! + a[r * 3 + 1]! * b[3 + c]! + a[r * 3 + 2]! * b[6 + c]!,
              ),
            );
          const rotation = multiply(rx, multiply(ry, rz));
          // Aim the optical axis at the page centre, then shift the camera parallel to the table
          // so the page centre moves by (x, y) pixels in the picture.
          const axis = [rotation[2]!, rotation[5]!, rotation[8]!];
          const scale = distance / focal;
          const eye = [
            (-distance * axis[0]!) / axis[2]! - (x + shakeX) * scale,
            (-distance * axis[1]!) / axis[2]! - (y + shakeY) * scale,
            -distance,
          ];
          const moved = { x: x - last.x, y: y - last.y };
          last = { x, y };
          g.uniform1i(at('page'), 0);
          g.uniform2f(at('size'), width, height);
          g.uniform1f(at('focal'), focal);
          g.uniform3f(at('eye'), eye[0]!, eye[1]!, eye[2]!);
          // Row-major, so transposed on upload (WebGL 2 allows it).
          g.uniformMatrix3fv(at('rotation'), true, rotation);
          g.uniform1f(at('aspect'), aspect);
          // Half the frame interval exposed: the smear is half the motion since the last frame.
          const smear = motionBlur ? 0.5 : 0;
          g.uniform2f(at('smear'), moved.x * smear, moved.y * smear);
          g.uniform1f(at('defocus'), blur);
          g.uniform1f(at('exposure'), exposure);
          g.uniform1f(at('noise'), noise / 255);
          g.uniform1f(at('seed'), (frameNumber++ % 997) * 0.618);
          g.drawArrays(g.TRIANGLE_STRIP, 0, 4);
          context.drawImage(gl, 0, 0);
          camera.ready = true;
          return true;
        };
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

/** A public-domain phone photo of a printed page (research/omr/photos/README.md). */
export const PAGE_PHOTO = fileURLToPath(
  new URL('../../../../research/omr/photos/boellmann-op28-page2-flat.jpeg', import.meta.url),
);
/** Where the page reads the photo from: a same-origin path that only the test answers. */
export const PAGE_PHOTO_URL = '/__score-camera/page.jpeg';
/** The photo's size in pixels (its JPEG header). */
export const PAGE_PHOTO_SIZE = { width: 1308, height: 1600 } as const;

/** Serve the page photo to the page under test from `PAGE_PHOTO_URL`. */
export async function servePagePhoto(page: Page) {
  const body = readFileSync(PAGE_PHOTO);
  await page.route(`**${PAGE_PHOTO_URL}`, (route) =>
    route.fulfill({ body, contentType: 'image/jpeg' }),
  );
}

/** A camera filming the real photographed page on a table, with perspective, tremor and noise. */
export async function installPhotoCamera(page: Page, options: Omit<CameraOptions, 'photo'> = {}) {
  await servePagePhoto(page);
  await installScoreCamera(page, {
    width: 720,
    height: 960,
    tilt: { pitch: 7, yaw: -3, roll: 1.5 },
    ...options,
    photo: PAGE_PHOTO_URL,
  });
}

/** Wait until the camera is filming its picture (a photographed page has loaded). */
export async function expectCameraReady(page: Page) {
  await expect
    .poll(() => page.evaluate(() => window.scoreCamera.error ?? window.scoreCamera.ready))
    .toBe(true);
}

/** Glide the page (by moving the camera) to (x, y) over `ms`, and wait until it has arrived. */
export async function glideScore(page: Page, x: number, y: number, ms = 300) {
  await page.evaluate(({ x, y, ms }) => window.scoreCamera.glide(x, y, ms), { x, y, ms });
  await expect
    .poll(() => page.evaluate(() => window.scoreCamera.moving), { intervals: [25, 50] })
    .toBe(false);
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
