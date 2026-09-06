// One-off generator for the animated BINA logo (a radar-style sweep detecting a
// sale "blip" — matches the "BINA. The Art of Smart Selling" brand concept).
// Run manually with `node scripts/generate-logo-gif.js`; the output is a static
// asset committed to public/img/logo.gif, not generated at request time.
const fs = require('fs');
const path = require('path');
const { createCanvas } = require('canvas');
const { GIFEncoder, quantize, applyPalette } = require('gifenc');

const SIZE = 128;
const FRAMES = 30;
const DELAY_MS = 45;
const ACCENT = '#3D5CF5';
const ACCENT_STRONG = '#2C48D8';
const CENTER = SIZE / 2;
const OUTER_R = 42;
const INNER_R = 16;
const BLIP_ANGLE = (200 * Math.PI) / 180;
const BLIP_R = 27;

function roundedRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function angleDiff(a, b) {
  let d = Math.abs(a - b) % (Math.PI * 2);
  if (d > Math.PI) d = Math.PI * 2 - d;
  return d;
}

function drawFrame(ctx, sweepAngle) {
  ctx.clearRect(0, 0, SIZE, SIZE);

  const bg = ctx.createLinearGradient(0, 0, SIZE, SIZE);
  bg.addColorStop(0, ACCENT);
  bg.addColorStop(1, ACCENT_STRONG);
  ctx.fillStyle = bg;
  roundedRectPath(ctx, 0, 0, SIZE, SIZE, 34);
  ctx.fill();

  ctx.strokeStyle = 'rgba(255,255,255,0.92)';
  ctx.lineCap = 'round';

  ctx.lineWidth = 5;
  ctx.beginPath(); ctx.arc(CENTER, CENTER, OUTER_R, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.arc(CENTER, CENTER, INNER_R, 0, Math.PI * 2); ctx.stroke();

  [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2].forEach((a) => {
    const x1 = CENTER + Math.cos(a) * (OUTER_R + 5);
    const y1 = CENTER + Math.sin(a) * (OUTER_R + 5);
    const x2 = CENTER + Math.cos(a) * (OUTER_R + 13);
    const y2 = CENTER + Math.sin(a) * (OUTER_R + 13);
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  });

  // Radar sweep trail: a fading wedge behind the leading edge.
  const trailSpan = 1.15;
  const trailSteps = 26;
  for (let i = 0; i < trailSteps; i++) {
    const t = i / trailSteps;
    const a = sweepAngle - t * trailSpan;
    ctx.strokeStyle = `rgba(255,255,255,${0.28 * (1 - t)})`;
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.moveTo(CENTER, CENTER);
    ctx.lineTo(CENTER + Math.cos(a) * OUTER_R, CENTER + Math.sin(a) * OUTER_R);
    ctx.stroke();
  }

  // Leading sweep edge.
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 3.4;
  ctx.beginPath();
  ctx.moveTo(CENTER, CENTER);
  ctx.lineTo(CENTER + Math.cos(sweepAngle) * OUTER_R, CENTER + Math.sin(sweepAngle) * OUTER_R);
  ctx.stroke();

  // "Detected sale" blip — brightens as the sweep passes over it.
  const closeness = Math.max(0, 1 - angleDiff(sweepAngle, BLIP_ANGLE) / 0.9);
  const blipR = 3.2 + closeness * 2.6;
  const bx = CENTER + Math.cos(BLIP_ANGLE) * BLIP_R;
  const by = CENTER + Math.sin(BLIP_ANGLE) * BLIP_R;
  if (closeness > 0.02) {
    ctx.fillStyle = `rgba(255,255,255,${0.25 + closeness * 0.7})`;
    ctx.beginPath(); ctx.arc(bx, by, blipR + 4, 0, Math.PI * 2); ctx.fill();
  }
  ctx.fillStyle = '#ffffff';
  ctx.beginPath(); ctx.arc(bx, by, blipR, 0, Math.PI * 2); ctx.fill();

  ctx.fillStyle = ACCENT_STRONG;
  ctx.beginPath(); ctx.arc(CENTER, CENTER, 4.5, 0, Math.PI * 2); ctx.fill();
}

function main() {
  const canvas = createCanvas(SIZE, SIZE);
  const ctx = canvas.getContext('2d');
  const gif = GIFEncoder();

  for (let f = 0; f < FRAMES; f++) {
    const angle = (f / FRAMES) * Math.PI * 2;
    drawFrame(ctx, angle);
    const { data } = ctx.getImageData(0, 0, SIZE, SIZE);
    const palette = quantize(data, 256);
    const index = applyPalette(data, palette);
    gif.writeFrame(index, SIZE, SIZE, { palette, delay: DELAY_MS, repeat: 0 });
  }
  gif.finish();

  const outPath = path.join(__dirname, '..', 'public', 'img', 'logo.gif');
  fs.writeFileSync(outPath, Buffer.from(gif.bytes()));
  console.log('wrote', outPath, fs.statSync(outPath).size, 'bytes');
}

main();
