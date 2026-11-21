// THE WORLD IN ONE DAY — front page for Friday 20 November 2026.
// Draws a one-page newspaper (1024x1024) with its own bitmap font and
// its own PNG encoder. Node 22 standard library only, no network, no
// clock, no randomness: two runs write byte-identical output.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const W = 1024;
const H = 1024;

// ---------------------------------------------------------------- palette
type RGB = [number, number, number];
const PAPER: RGB = [247, 242, 228];
const INK: RGB = [24, 24, 24];
const NAVY: RGB = [27, 42, 74];
const RED: RGB = [158, 27, 27];
const GREY: RGB = [96, 96, 92];
const FAINT: RGB = [120, 116, 104];
const SKY: RGB = [206, 224, 234];
const RIVER: RGB = [111, 156, 192];
const RIVER_D: RGB = [84, 128, 168];
const STEEL: RGB = [70, 84, 96];
const ORANGE: RGB = [224, 122, 26];
const GOLD: RGB = [214, 164, 32];
const GREEN: RGB = [46, 110, 62];

// ------------------------------------------------------------------ canvas
class Canvas {
  data = new Uint8Array(W * H * 3);
  constructor() {
    this.fill(PAPER);
  }
  fill(c: RGB) {
    for (let i = 0; i < W * H; i++) {
      this.data[i * 3] = c[0];
      this.data[i * 3 + 1] = c[1];
      this.data[i * 3 + 2] = c[2];
    }
  }
  set(x: number, y: number, c: RGB) {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const i = (y * W + x) * 3;
    this.data[i] = c[0];
    this.data[i + 1] = c[1];
    this.data[i + 2] = c[2];
  }
  blend(x: number, y: number, c: RGB, a: number) {
    if (x < 0 || y < 0 || x >= W || y >= H || a <= 0) return;
    const i = (y * W + x) * 3;
    const inv = 255 - a;
    this.data[i] = (c[0] * a + this.data[i] * inv) >> 8;
    this.data[i + 1] = (c[1] * a + this.data[i + 1] * inv) >> 8;
    this.data[i + 2] = (c[2] * a + this.data[i + 2] * inv) >> 8;
  }
  rect(x: number, y: number, w: number, h: number, c: RGB) {
    x = Math.round(x); y = Math.round(y); w = Math.round(w); h = Math.round(h);
    for (let yy = Math.max(0, y); yy < Math.min(H, y + h); yy++) {
      for (let xx = Math.max(0, x); xx < Math.min(W, x + w); xx++) {
        this.set(xx, yy, c);
      }
    }
  }
  hline(x: number, y: number, w: number, c: RGB, t = 1) {
    this.rect(x, y, w, t, c);
  }
  vline(x: number, y: number, h: number, c: RGB, t = 1) {
    this.rect(x, y, t, h, c);
  }
  // Thick segment between two points.
  line(x0: number, y0: number, x1: number, y1: number, c: RGB, t = 1) {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const steps = Math.max(Math.abs(dx), Math.abs(dy), 1);
    const r = Math.max(1, Math.floor(t / 2));
    for (let s = 0; s <= steps; s++) {
      const cx = Math.round(x0 + (dx * s) / steps);
      const cy = Math.round(y0 + (dy * s) / steps);
      this.rect(cx - r, cy - r, r * 2 + 1, r * 2 + 1, c);
    }
  }
  circle(cx: number, cy: number, r: number, c: RGB) {
    for (let y = -r; y <= r; y++) {
      const half = Math.floor(Math.sqrt(r * r - y * y));
      for (let x = -half; x <= half; x++) this.set(cx + x, cy + y, c);
    }
  }
  ring(cx: number, cy: number, r: number, c: RGB, t = 2) {
    for (let a = 0; a < 360; a += 2) {
      const rad = (a * Math.PI) / 180;
      const x = Math.round(cx + r * Math.cos(rad));
      const y = Math.round(cy + r * Math.sin(rad));
      this.rect(x - Math.floor(t / 2), y - Math.floor(t / 2), t, t, c);
    }
  }
  poly(points: Array<[number, number]>, c: RGB) {
    let minY = Infinity;
    let maxY = -Infinity;
    for (const [, y] of points) {
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
    for (let y = Math.ceil(minY); y <= Math.floor(maxY); y++) {
      const xs: number[] = [];
      for (let i = 0; i < points.length; i++) {
        const [x0, y0] = points[i];
        const [x1, y1] = points[(i + 1) % points.length];
        if ((y0 <= y && y1 > y) || (y1 <= y && y0 > y)) {
          xs.push(x0 + ((y - y0) * (x1 - x0)) / (y1 - y0));
        }
      }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        for (let x = Math.ceil(xs[k]); x <= Math.floor(xs[k + 1]); x++) {
          this.set(x, y, c);
        }
      }
    }
  }
  // Small four-point star used for blasts and bursts.
  star(cx: number, cy: number, r: number, c: RGB) {
    this.poly(
      [
        [cx, cy - r],
        [cx + r * 0.28, cy - r * 0.28],
        [cx + r, cy],
        [cx + r * 0.28, cy + r * 0.28],
        [cx, cy + r],
        [cx - r * 0.28, cy + r * 0.28],
        [cx - r, cy],
        [cx - r * 0.28, cy - r * 0.28],
      ],
      c,
    );
  }
}

// -------------------------------------------------------------------- font
type Glyph = { adv: number; x: number; y: number; w: number; h: number; d: string };
type FontFace = { ascent: number; descent: number; glyphs: Record<string, Glyph> };

const FONT = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "font.json"), "utf8"),
) as { sizes: Record<string, FontFace> };

const glyphCache = new Map<string, { g: Glyph; px: Buffer }>();
function glyph(face: string, ch: string): { g: Glyph; px: Buffer } {
  const key = face + "|" + ch;
  const hit = glyphCache.get(key);
  if (hit) return hit;
  const f = FONT.sizes[face];
  const g = f.glyphs[ch] ?? f.glyphs["?"];
  const px = Buffer.from(g.d, "base64");
  const val = { g, px };
  glyphCache.set(key, val);
  return val;
}

function textWidth(text: string, face: string): number {
  let w = 0;
  for (const ch of text) w += glyph(face, ch).g.adv;
  return w;
}

function drawText(cv: Canvas, x: number, baseline: number, text: string, face: string, c: RGB) {
  let pen = Math.round(x);
  const by = Math.round(baseline);
  for (const ch of text) {
    const { g, px } = glyph(face, ch);
    if (g.w > 0 && g.h > 0) {
      for (let yy = 0; yy < g.h; yy++) {
        for (let xx = 0; xx < g.w; xx++) {
          const a = px[yy * g.w + xx];
          if (a > 0) cv.blend(pen + g.x + xx, by + g.y + yy, c, a);
        }
      }
    }
    pen += g.adv;
  }
  return pen;
}

function drawTextCentered(cv: Canvas, cx: number, baseline: number, text: string, face: string, c: RGB) {
  drawText(cv, cx - textWidth(text, face) / 2, baseline, text, face, c);
}

function wrap(text: string, face: string, maxW: number): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let cur = "";
  for (const word of words) {
    const trial = cur ? cur + " " + word : word;
    if (textWidth(trial, face) <= maxW || !cur) {
      cur = trial;
    } else {
      lines.push(cur);
      cur = word;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

function drawPara(cv: Canvas, x: number, y: number, text: string, face: string, maxW: number, lh: number, c: RGB): number {
  const lines = wrap(text, face, maxW);
  let yy = y;
  for (const line of lines) {
    drawText(cv, x, yy, line, face, c);
    yy += lh;
  }
  return yy;
}

// --------------------------------------------------------------------- png
function crc32(buf: Buffer): number {
  let table = (crc32 as unknown as { t?: Int32Array }).t;
  if (!table) {
    table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let v = n;
      for (let k = 0; k < 8; k++) v = v & 1 ? 0xedb88320 ^ (v >>> 1) : v >>> 1;
      table[n] = v;
    }
    (crc32 as unknown as { t: Int32Array }).t = table;
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, "ascii"), data])), 8 + data.length);
  return out;
}

function encodePng(cv: Canvas): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const raw = Buffer.alloc(H * (1 + W * 3));
  for (let y = 0; y < H; y++) {
    raw[y * (1 + W * 3)] = 0; // filter: none
    raw.set(cv.data.subarray(y * W * 3, (y + 1) * W * 3), y * (1 + W * 3) + 1);
  }
  const idat = deflateSync(raw, { level: 9 });
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}

// -------------------------------------------------------------- illustrations
function drawKyivScene(cv: Canvas, x: number, y: number, w: number, h: number) {
  // Geometry inside the scene box: sky, far bank, river, caption bar.
  const groundY = y + h - 56; // far bank line
  const riverTop = groundY + 4;
  const captionTop = y + h - 20;
  cv.rect(x, y, w, h, SKY);
  // Pale sun, low in a grey November sky.
  cv.circle(x + w - 70, y + 26, 15, [232, 214, 150]);
  // Far bank skyline: blocky towers.
  const towers: Array<[number, number, number]> = [
    [0, 52, 34], [36, 44, 26], [64, 58, 30], [96, 40, 24], [122, 54, 36],
    [160, 46, 28], [190, 60, 30], [222, 42, 26], [250, 56, 34], [286, 48, 28],
    [316, 58, 30], [348, 44, 26], [376, 54, 32], [410, 46, 28], [440, 56, 30],
    [472, 48, 26], [500, 58, 32], [534, 44, 28], [564, 54, 30],
  ];
  for (const [tx, th, tw] of towers) {
    cv.rect(x + tx, groundY - th, tw, th, [148, 158, 168]);
  }
  cv.rect(x, groundY, w, 4, [96, 106, 114]); // far bank line
  // River.
  cv.rect(x, riverTop, w, captionTop - riverTop, RIVER);
  cv.rect(x, riverTop, w, 3, RIVER_D);
  for (let i = 0; i < 3; i++) {
    cv.hline(x + 20 + i * 110, riverTop + 8 + i * 6, 60, [190, 214, 230], 2);
  }
  // Three bridges crossing the river, left to right.
  const deckY = riverTop + 6;
  const bridges: Array<{ bx: number; bw: number; broken: boolean }> = [
    { bx: 12, bw: 150, broken: false },
    { bx: 225, bw: 170, broken: true },
    { bx: 445, bw: 140, broken: false },
  ];
  for (const b of bridges) {
    const bx = x + b.bx;
    // Piers in the water, ending at the caption bar.
    cv.rect(bx + 8, deckY + 5, 8, captionTop - deckY - 5, STEEL);
    cv.rect(bx + b.bw - 16, deckY + 5, 8, captionTop - deckY - 5, STEEL);
    // Arch under the deck.
    for (let a = 0; a <= 180; a += 6) {
      const rad = (a * Math.PI) / 180;
      const ax = bx + 12 + ((b.bw - 24) * a) / 180;
      const ay = deckY + 4 + Math.sin(rad) * 10;
      cv.rect(Math.round(ax), Math.round(ay), 4, 4, STEEL);
    }
    // Deck, with a gap in the middle bridge where the missile hit.
    if (b.broken) {
      cv.rect(bx, deckY, Math.floor(b.bw * 0.42), 5, NAVY);
      cv.rect(bx + Math.floor(b.bw * 0.58), deckY, Math.ceil(b.bw * 0.42), 5, NAVY);
      cv.line(bx + Math.floor(b.bw * 0.42), deckY, bx + Math.floor(b.bw * 0.5), deckY + 12, NAVY, 3);
      cv.line(bx + Math.floor(b.bw * 0.58), deckY, bx + Math.floor(b.bw * 0.5), deckY + 12, NAVY, 3);
    } else {
      cv.rect(bx, deckY, b.bw, 5, NAVY);
    }
    // Railings.
    cv.hline(bx, deckY - 8, b.bw, STEEL, 2);
  }
  // Blast and smoke over the broken middle bridge.
  const sx = x + 310;
  const sy = deckY;
  cv.star(sx, sy - 6, 16, ORANGE);
  cv.star(sx, sy - 6, 9, GOLD);
  cv.circle(sx - 8, sy - 30, 12, [120, 118, 112]);
  cv.circle(sx + 6, sy - 46, 16, [140, 138, 130]);
  cv.circle(sx + 16, sy - 62, 12, [160, 158, 150]);
  // Small boats on the river.
  cv.poly([[x + 60, riverTop + 16], [x + 92, riverTop + 16], [x + 84, riverTop + 23], [x + 68, riverTop + 23]], NAVY);
  cv.poly([[x + 470, riverTop + 20], [x + 500, riverTop + 20], [x + 492, riverTop + 26], [x + 478, riverTop + 26]], NAVY);
  // Caption bar.
  cv.rect(x, captionTop, w, 20, NAVY);
  drawText(cv, x + 10, captionTop + 14, "THE DNIPRO AT KYIV: THREE BRIDGES HIT OVERNIGHT", "bold-13", [247, 242, 228]);
}

function drawChart(cv: Canvas, x: number, y: number, w: number, h: number) {
  cv.rect(x, y, w, h, [255, 255, 255]);
  cv.rect(x, y, w, h, INK); // placeholder replaced by border below
  cv.rect(x + 1, y + 1, w - 2, h - 2, [255, 255, 255]);
  // Grid.
  for (let i = 1; i <= 3; i++) {
    cv.hline(x + 8, y + (h * i) / 4, w - 16, [226, 222, 210], 1);
  }
  // Falling line: high left, low right, with a small bounce.
  const pts: Array<[number, number]> = [
    [x + 10, y + 14],
    [x + w * 0.25, y + 22],
    [x + w * 0.42, y + 20],
    [x + w * 0.58, y + 44],
    [x + w * 0.74, y + 52],
    [x + w - 12, y + h - 14],
  ];
  for (let i = 0; i + 1 < pts.length; i++) {
    cv.line(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], RED, 4);
  }
  // Arrowhead at the end, pointing down.
  const ex = x + w - 12;
  const ey = y + h - 14;
  cv.poly([[ex, ey + 12], [ex - 10, ey - 2], [ex + 2, ey - 4]], RED);
}

function drawCyclone(cv: Canvas, cx: number, cy: number, r: number) {
  // Spiral arms.
  for (let a = 0; a < 540; a += 4) {
    const rad = (a * Math.PI) / 180;
    const rr = (r * a) / 540;
    const px = Math.round(cx + rr * Math.cos(rad));
    const py = Math.round(cy + rr * Math.sin(rad));
    cv.rect(px - 2, py - 2, 4, 4, NAVY);
  }
  cv.circle(cx, cy, 5, PAPER);
  cv.circle(cx, cy, 5, NAVY);
  cv.circle(cx, cy, 2, PAPER);
}

function drawTanker(cv: Canvas, cx: number, cy: number) {
  // Hull and deck.
  cv.poly([[cx - 26, cy + 2], [cx + 26, cy + 2], [cx + 20, cy + 14], [cx - 20, cy + 14]], [58, 58, 58]);
  cv.rect(cx - 18, cy - 8, 10, 10, [120, 120, 116]);
  cv.rect(cx + 6, cy - 8, 10, 10, [120, 120, 116]);
  cv.line(cx - 20, cy - 8, cx - 20, cy - 20, STEEL, 3);
  // Flame above the midship hit.
  cv.poly([[cx - 8, cy - 8], [cx, cy - 30], [cx + 8, cy - 8]], ORANGE);
  cv.poly([[cx - 4, cy - 8], [cx, cy - 20], [cx + 4, cy - 8]], GOLD);
  // Smoke.
  cv.circle(cx + 2, cy - 36, 6, [140, 138, 130]);
  cv.circle(cx + 10, cy - 46, 8, [160, 158, 150]);
  // Water line.
  cv.hline(cx - 30, cy + 18, 60, RIVER_D, 3);
}

function drawVirus(cv: Canvas, cx: number, cy: number, r: number) {
  for (let a = 0; a < 360; a += 30) {
    const rad = (a * Math.PI) / 180;
    cv.line(cx, cy, Math.round(cx + (r + 8) * Math.cos(rad)), Math.round(cy + (r + 8) * Math.sin(rad)), GREEN, 3);
    cv.circle(Math.round(cx + (r + 8) * Math.cos(rad)), Math.round(cy + (r + 8) * Math.sin(rad)), 3, GREEN);
  }
  cv.circle(cx, cy, r, GREEN);
  cv.circle(cx - 5, cy - 4, 3, [255, 255, 255]);
  cv.circle(cx + 6, cy + 5, 3, [255, 255, 255]);
  cv.circle(cx + 4, cy - 7, 2, [255, 255, 255]);
}

function drawMissile(cv: Canvas, cx: number, cy: number) {
  // Rising arc and interceptor burst.
  for (let t = 0; t <= 20; t++) {
    const px = cx - 26 + (t * 52) / 20;
    const py = cy + 18 - Math.sin((t / 20) * Math.PI) * 40;
    cv.rect(Math.round(px), Math.round(py), 3, 3, RED);
  }
  cv.poly([[cx - 6, cy - 26], [cx + 2, cy - 34], [cx + 10, cy - 26], [cx + 2, cy - 18]], INK);
  cv.star(cx + 20, cy - 30, 9, GOLD);
  cv.star(cx + 20, cy - 30, 5, ORANGE);
}

// -------------------------------------------------------------------- page
function build(): Canvas {
  const cv = new Canvas();

  // Outer double border.
  cv.rect(6, 6, W - 12, H - 12, INK);
  cv.rect(9, 9, W - 18, H - 18, PAPER);
  cv.rect(12, 12, W - 24, H - 24, INK);
  cv.rect(14, 14, W - 28, H - 28, PAPER);

  // Masthead.
  drawTextCentered(cv, W / 2, 82, "THE WORLD IN ONE DAY", "bold-52", NAVY);
  cv.hline(30, 96, W - 60, RED, 4);
  drawTextCentered(cv, W / 2, 122, "FRIDAY  •  20 NOVEMBER 2026", "bold-24", RED);
  drawText(cv, 30, 122, "No. 325", "bold-15", GREY);
  drawText(cv, W - 30 - textWidth("PRICE: ONE DAY", "bold-15"), 122, "PRICE: ONE DAY", "bold-15", GREY);
  cv.hline(30, 132, W - 60, INK, 3);

  // ---------------- lead story (left) + markets (right)
  const leadX = 30;
  const leadW = 612;
  const sideX = 666;
  const sideW = 328;
  drawText(cv, leadX, 159, "UKRAINE  —  LEAD STORY", "bold-15", RED);
  drawText(cv, leadX, 197, "MISSILES STRIKE KYIV'S", "bold-38", INK);
  drawText(cv, leadX, 239, "DNIPRO BRIDGES", "bold-38", INK);
  drawPara(
    cv, leadX, 263,
    "Russian ballistic missiles hit three bridges over the Dnipro river overnight, killing at least three people and wounding more than a dozen. Crossings were closed or restricted, and power failed in parts of the city.",
    "regular-17", leadW, 21, INK,
  );
  drawKyivScene(cv, leadX, 330, leadW, 140);

  // Markets box, right column.
  const boxY = 144;
  const boxH = 326;
  cv.rect(sideX, boxY, sideW, boxH, INK);
  cv.rect(sideX + 2, boxY + 2, sideW - 4, boxH - 4, [255, 255, 255]);
  drawText(cv, sideX + 14, boxY + 26, "MARKETS", "bold-20", RED);
  drawText(cv, sideX + sideW - 14 - textWidth("FRIDAY", "bold-15"), boxY + 24, "FRIDAY", "bold-15", GREY);
  cv.hline(sideX + 14, boxY + 36, sideW - 28, INK, 2);
  drawChart(cv, sideX + 14, boxY + 48, sideW - 28, 92);
  drawText(cv, sideX + 14, boxY + 164, "STOCKS SLIDE AS", "bold-24", INK);
  drawText(cv, sideX + 14, boxY + 192, "ANTHROPIC SINKS", "bold-24", INK);
  drawPara(
    cv, sideX + 14, boxY + 214,
    "Anthropic shares fell a second day after their record Nasdaq debut. The S&P 500 dropped about 2% on Thursday, its sixth straight fall; Tokyo's Nikkei slid 4.8%.",
    "regular-17", sideW - 28, 21, INK,
  );

  // ---------------- middle row: four stories
  const midRuleY = 478;
  cv.hline(30, midRuleY, W - 60, INK, 3);
  const cols = [
    {
      kick: "INDIA",
      head: "CYCLONE AKVAN",
      body: "Cyclone Akvan came ashore in Odisha, on India's east coast, bringing heavy rain and high winds.",
      icon: "cyclone",
    },
    {
      kick: "STRAIT OF HORMUZ",
      head: "TANKER ABLAZE",
      body: "An oil tanker burned in the Strait of Hormuz after striking a mine, as attacks on shipping intensify.",
      icon: "tanker",
    },
    {
      kick: "KENYA",
      head: "LAST EBOLA PATIENT HOME",
      body: "Kenya sent home its last Ebola patient, 37 days after the first case, as a 42-day Ebola-free countdown began.",
      icon: "virus",
    },
    {
      kick: "SAUDI ARABIA",
      head: "MISSILE INTERCEPTED",
      body: "Saudi Arabia intercepted another Houthi missile and five drones on Friday, targets including Riyadh; a PIF tower was hit the day before.",
      icon: "missile",
    },
  ];
  const colW = 235;
  const gap = 8;
  const iconY = 488;
  cols.forEach((c, i) => {
    const cx0 = 30 + i * (colW + gap);
    if (c.icon === "cyclone") drawCyclone(cv, cx0 + 28, iconY + 24, 18);
    if (c.icon === "tanker") drawTanker(cv, cx0 + 30, iconY + 24);
    if (c.icon === "virus") drawVirus(cv, cx0 + 28, iconY + 24, 15);
    if (c.icon === "missile") drawMissile(cv, cx0 + 30, iconY + 24);
    drawText(cv, cx0 + 62, iconY + 18, c.kick, "bold-13", RED);
    cv.vline(cx0 + 54, iconY + 4, 42, [200, 196, 184], 1);
    const headLines = wrap(c.head, "bold-20", colW);
    let cy = iconY + 62;
    for (const line of headLines) {
      drawText(cv, cx0, cy + 20, line, "bold-20", INK);
      cy += 26;
    }
    drawPara(cv, cx0, cy + 15, c.body, "regular-15", colW, 18, INK);
    if (i < 3) cv.vline(cx0 + colW + 4, midRuleY + 12, 176, [200, 196, 184], 1);
  });

  // ---------------- also today
  const alsoRuleY = 696;
  cv.hline(30, alsoRuleY, W - 60, INK, 3);
  drawText(cv, 30, alsoRuleY + 24, "ALSO TODAY", "bold-20", NAVY);
  drawText(cv, W - 30 - textWidth("FRIDAY 20 NOVEMBER 2026", "bold-15"), alsoRuleY + 22, "FRIDAY 20 NOVEMBER 2026", "bold-15", GREY);
  const items: Array<[string, string]> = [
    ["WASHINGTON", "The Senate blocked an Iran war resolution, 51-48, and passed an energy bill, 62-33."],
    ["ANTALYA", "A COP31 draft dropped the call to phase out fossil fuels."],
    ["BRUSSELS", "At the EU-UK summit, Germany's Merz warned against a Yalta-style deal over Europe."],
    ["SENEGAL", "A migrant boat capsized off Senegal; dozens are missing."],
    ["SUDAN", "A drone strike killed 10 at a gold mine in South Kordofan."],
    ["SAN SALVADOR", "Bukele filed to run for a third term in El Salvador."],
    ["CARACAS", "The US and Venezuela signed a military cooperation deal."],
    ["WASHINGTON", "Trump will not decide his next Iran move until the new year."],
    ["NEW YORK", "A judge let Trump's $15bn defamation suit against the Times go ahead."],
    ["WASHINGTON", "Cyber chief Cairncross was removed after a week of outages; an FAA stop stranded 1.5m."],
    ["ROME", "Italy fined Meta \u20ac805m over Android photo access."],
    ["TALLINN", "Estonia closed its border with Russia over GRU-linked sabotage."],
  ];
  const colW2 = 468;
  const leftX = 30;
  const rightX = 526;
  let ly = alsoRuleY + 40;
  let ry = alsoRuleY + 40;
  items.forEach(([label, text], i) => {
    const x = i % 2 === 0 ? leftX : rightX;
    let yy = i % 2 === 0 ? ly : ry;
    // Wrap the item with the label measured in its bold face.
    const labelW = textWidth(label + " — ", "bold-15");
    const words = text.split(" ");
    const lines: string[] = [];
    let cur = "";
    for (const word of words) {
      const trial = cur ? cur + " " + word : word;
      const avail = lines.length === 0 ? colW2 - labelW : colW2;
      if (textWidth(trial, "regular-15") <= avail || !cur) cur = trial;
      else { lines.push(cur); cur = word; }
    }
    if (cur) lines.push(cur);
    lines.forEach((line, li) => {
      if (li === 0) {
        drawText(cv, x, yy + 15, label + " — ", "bold-15", RED);
        drawText(cv, x + labelW, yy + 15, line, "regular-15", INK);
      } else {
        drawText(cv, x, yy + 15, line, "regular-15", INK);
      }
      yy += 18;
    });
    yy += 2;
    if (i % 2 === 0) ly = yy; else ry = yy;
  });

  // Footer.
  const footY = 986;
  cv.hline(30, footY - 14, W - 60, INK, 2);
  drawTextCentered(cv, W / 2, footY + 4, "THE WORLD IN ONE DAY  •  FRIDAY 20 NOVEMBER 2026  •  ONE DAY, ONE PAGE, THE WORLD", "regular-13", GREY);
  return cv;
}

function main() {
  const outDir = process.env.MAKEFUN_OUTPUT_DIR || "/output";
  mkdirSync(outDir, { recursive: true });
  const png = encodePng(build());
  writeFileSync(join(outDir, "entry.png"), png);
}

main();
