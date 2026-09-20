/**
 * A PNG encoder, so the tray icon can be drawn in code.
 *
 * The alternative is a binary blob checked into the repo that nobody can read,
 * diff, or adjust. The buddy is eleven rectangles; this is forty lines.
 */
import zlib from 'node:zlib';

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body) >>> 0, 0);
  return Buffer.concat([len, body, crc]);
}

const TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return c ^ 0xffffffff;
}

/** `rgba` is width * height * 4 bytes, row major, no filtering. */
export function encodePng(width: number, height: number, rgba: Buffer): Buffer {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // truecolour with alpha
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

/**
 * The buddy, 36×36, opaque black on transparent: the drag image for a Tray
 * file that has no thumbnail of its own. The menu bar shows menubarIcon below.
 */
export function trayIcon(): Buffer {
  const w = 36;
  const h = 36;
  const px = Buffer.alloc(w * h * 4, 0);
  const fill = (x0: number, y0: number, x1: number, y1: number) => {
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const i = (y * w + x) * 4;
        px[i] = 0;
        px[i + 1] = 0;
        px[i + 2] = 0;
        px[i + 3] = 255;
      }
    }
  };
  const clear = (x0: number, y0: number, x1: number, y1: number) => {
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) px[(y * w + x) * 4 + 3] = 0;
  };
  fill(6, 4, 30, 26); // head
  fill(2, 12, 6, 20); // left arm
  fill(30, 12, 34, 20); // right arm
  fill(6, 26, 10, 32); // legs
  fill(16, 26, 20, 32);
  fill(26, 26, 30, 32);
  clear(12, 12, 16, 16); // eyes
  clear(20, 12, 24, 16);
  return encodePng(w, h, px);
}

/**
 * The menu bar mark: the notch with its light on, from the 1a logo package
 * (marketing/logo/notchlight-menubar-template.svg), 32×32 for a 16pt template
 * image at Retina scale.
 *
 * The screen-edge line sits at 40% and the notch at 100%, with the light
 * punched out as a hole so macOS can recolour the whole thing for light and
 * dark menu bars. Rendered here rather than shipped as a bitmap: each pixel is
 * sampled sixteen times against the same 100-unit geometry the SVG uses, so the
 * curves stay smooth without a blob in the repo.
 */
export function menubarIcon(): Buffer {
  const size = 32;
  const px = Buffer.alloc(size * size * 4, 0);
  // The mark spans y 28…66 in the SVG; +3 centres it in the square.
  const notch = (u: number, v: number) => {
    if (u < 16 || u > 84 || v < 33 || v > 69) return false;
    if (v > 53 && u < 32 && (u - 32) ** 2 + (v - 53) ** 2 > 256) return false;
    if (v > 53 && u > 68 && (u - 68) ** 2 + (v - 53) ** 2 > 256) return false;
    return (u - 34) ** 2 + (v - 53) ** 2 > 42.25;
  };
  const bar = (u: number, v: number) => {
    if (v < 31 || v > 35) return false;
    if (u < 2) return (u - 2) ** 2 + (v - 33) ** 2 <= 4;
    if (u > 98) return (u - 98) ** 2 + (v - 33) ** 2 <= 4;
    return true;
  };
  const step = 100 / size;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let alpha = 0;
      for (let sy = 0; sy < 4; sy++) {
        for (let sx = 0; sx < 4; sx++) {
          const u = (x + (sx + 0.5) / 4) * step;
          const v = (y + (sy + 0.5) / 4) * step;
          alpha += notch(u, v) ? 1 : bar(u, v) ? 0.4 : 0;
        }
      }
      px[(y * size + x) * 4 + 3] = Math.round((alpha / 16) * 255);
    }
  }
  return encodePng(size, size, px);
}
