// Pack icon: a little raft with a cabin pushed by an outboard motor across a blue sea,
// leaving a white wake, under a summer sky. Drawn at 32x32 and scaled up.
import { PNG } from 'pngjs';
import { hex, mix } from './texture.mjs';

export function packIcon(scale = 8) {
  const N = 32;
  const px = Array.from({ length: N }, () => new Array(N));
  const sky = [hex('#5fa8e8'), hex('#bfe3fb')];
  const sea = [hex('#2a8fc0'), hex('#0b4f74')];
  for (let y = 0; y < N; y++) {
    const c = y < 17 ? mix(sky[0], sky[1], y / 16) : mix(sea[0], sea[1], (y - 17) / 14);
    for (let x = 0; x < N; x++) px[y][x] = c;
  }
  const put = (x, y, c) => { if (x >= 0 && x < N && y >= 0 && y < N) px[y][x] = hex(c); };
  const fill = (x0, y0, x1, y1, c) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) put(x, y, c); };

  // Sun and clouds
  fill(25, 3, 28, 6, '#ffe58a'); put(24, 4, '#ffe58a'); put(29, 5, '#ffe58a'); put(26, 2, '#ffe58a'); put(27, 7, '#ffe58a');
  fill(3, 5, 9, 6, '#ffffff'); fill(5, 4, 7, 4, '#ffffff');
  // Far shore with a lighthouse
  fill(0, 15, 6, 16, '#5c9a3f'); fill(2, 10, 3, 14, '#f4f1e8'); fill(2, 12, 3, 12, '#c8261b'); put(2, 9, '#ffd36b'); put(3, 9, '#ffd36b');
  // Waves
  for (const [x, y] of [[2, 20], [9, 24], [22, 22], [27, 27], [4, 28], [15, 29]]) { put(x, y, '#7fd3e0'); put(x + 1, y, '#7fd3e0'); put(x + 2, y - 1, '#7fd3e0'); }

  // Raft: plank deck, a little cabin with a red roof, a flag.
  fill(8, 18, 25, 19, '#a2834f');
  for (let x = 8; x <= 25; x += 3) put(x, 18, '#8a6a3c');
  fill(9, 20, 24, 20, '#6b4a2b'); // waterline shadow
  fill(15, 12, 22, 17, '#e9e6dc'); fill(14, 10, 23, 11, '#c8261b'); fill(16, 9, 21, 9, '#c8261b');
  fill(17, 14, 18, 15, '#7fc8f8'); fill(20, 14, 21, 17, '#6b4a2b');
  fill(10, 11, 10, 17, '#5a4632'); fill(11, 11, 13, 12, '#f2b705');
  // Outboard on the stern (left), and its wake.
  fill(5, 15, 7, 17, '#c8261b'); put(6, 16, '#e9e6dc'); fill(6, 18, 6, 21, '#3a3d40'); put(5, 21, '#b9c0c6'); put(7, 21, '#b9c0c6');
  for (let i = 0; i < 6; i++) { put(4 - i, 20 + (i % 2), '#ffffff'); put(4 - i, 21 + (i % 2), '#d8f1f8'); }
  fill(0, 22, 3, 22, '#ffffff');

  const png = new PNG({ width: N * scale, height: N * scale });
  for (let y = 0; y < N * scale; y++) for (let x = 0; x < N * scale; x++) {
    png.data.set(px[Math.floor(y / scale)][Math.floor(x / scale)], (y * N * scale + x) * 4);
  }
  return PNG.sync.write(png);
}
