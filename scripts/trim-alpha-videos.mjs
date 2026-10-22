// Trims the transparent margins of the Spine animation videos (VP9 .webm with alpha) and writes the HEVC-with-alpha
// .mov twin that Safari / iOS needs.
//
// Spine exports every animation on its own canvas, so the character stands at a different place in every
// video. Trimming each video to the character (the union of all its frames) makes the character fill its box,
// so videos line up when they are stacked on narrow screens.
//
//   npm run videos:trim                      all .webm in public/gallery-grabber/videos
//   npm run videos:trim -- public/some/dir   another folder
//
// Safe to run again: a video that is already trimmed is left alone. The .mov is rebuilt when it is missing or
// older than its .webm (needs macOS: the encoder is scripts/rgba2hevc.swift, compiled with swiftc).
// The result is printed as JSON: crop = what was cut off (px of the original), size = the new size.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, renameSync, statSync, rmSync } from 'node:fs';
import { tmpdir, platform } from 'node:os';
import path from 'node:path';
import ffmpegPath from 'ffmpeg-static';

const PAD = 2; // px kept around the character (anti-aliased edges)
const ALPHA = 8; // pixels with alpha above this count as character
const dir = path.resolve(process.argv[2] ?? 'public/gallery-grabber/videos');
const encoderSrc = path.resolve('scripts/rgba2hevc.swift');
const encoderBin = path.join(tmpdir(), 'rgba2hevc');

const probe = file => {
  const r = spawnSync(ffmpegPath, ['-hide_banner', '-c:v', 'libvpx-vp9', '-i', file], { encoding: 'utf8' });
  const m = r.stderr.match(/Video: .*?, (\d{2,5})x(\d{2,5})/);
  const fps = r.stderr.match(/(\d+(?:\.\d+)?) fps/);
  if (!m) throw new Error(`cannot read ${file}`);
  return { w: +m[1], h: +m[2], fps: fps ? +fps[1] : 30 };
};

// union of the character over all frames
const measure = (file, w, h) =>
  new Promise((resolve, reject) => {
    const p = spawn(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-c:v', 'libvpx-vp9', '-i', file, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-']);
    const frame = w * h * 4;
    let rest = Buffer.alloc(0);
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    p.stdout.on('data', chunk => {
      rest = Buffer.concat([rest, chunk]);
      while (rest.length >= frame) {
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
          if (rest[(y * w + x) * 4 + 3] > ALPHA) {
            if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
          }
        }
        rest = rest.subarray(frame);
      }
    });
    p.on('error', reject);
    p.on('close', () => (x1 < 0 ? reject(new Error(`${file}: empty video`)) : resolve({ x0, y0, x1, y1 })));
  });

const run = (cmd, args) => {
  const r = spawnSync(cmd, args, { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`${cmd} failed:\n${r.stderr}`);
};

const buildMov = (webm, mov) => {
  if (platform() !== 'darwin') return console.warn(`skip ${path.basename(mov)}: .mov needs macOS`);
  if (!existsSync(encoderBin)) run('swiftc', ['-O', '-o', encoderBin, encoderSrc]);
  const { w, h, fps } = probe(webm);
  const w2 = Math.ceil(w / 2) * 2; // HEVC needs even sizes
  const h2 = Math.ceil(h / 2) * 2;
  const sh = `"${ffmpegPath}" -hide_banner -loglevel error -c:v libvpx-vp9 -i "${webm}" -vf "format=rgba,pad=${w2}:${h2}:0:0:color=black@0,format=bgra" -f rawvideo -pix_fmt bgra - | "${encoderBin}" "${mov}" ${w2} ${h2} ${fps} 0.75`;
  run('sh', ['-c', sh]);
};

const report = [];
for (const name of readdirSync(dir).filter(f => f.endsWith('.webm')).sort()) {
  const file = path.join(dir, name);
  const { w, h } = probe(file);
  const b = await measure(file, w, h);
  const cx0 = Math.max(0, b.x0 - PAD);
  const cy0 = Math.max(0, b.y0 - PAD);
  const cx1 = Math.min(w - 1, b.x1 + PAD);
  const cy1 = Math.min(h - 1, b.y1 + PAD);
  const nw = cx1 - cx0 + 1;
  const nh = cy1 - cy0 + 1;
  const trimmed = nw < w || nh < h;
  if (trimmed) {
    mkdirSync(path.join(tmpdir(), 'trim-videos'), { recursive: true });
    const tmp = path.join(tmpdir(), 'trim-videos', name);
    run(ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error', '-c:v', 'libvpx-vp9', '-i', file, '-vf', `crop=${nw}:${nh}:${cx0}:${cy0}`,
      '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-auto-alt-ref', '0', '-b:v', '0', '-crf', '28', '-an', tmp]);
    renameSync(tmp, file);
  }
  const mov = file.replace(/\.webm$/, '.mov');
  if (trimmed || !existsSync(mov) || statSync(mov).mtimeMs < statSync(file).mtimeMs) buildMov(file, mov);
  report.push({ name, trimmed, from: `${w}x${h}`, size: `${nw}x${nh}`, crop: { left: cx0, top: cy0, right: w - 1 - cx1, bottom: h - 1 - cy1 } });
}
console.log(JSON.stringify(report, null, 1));
