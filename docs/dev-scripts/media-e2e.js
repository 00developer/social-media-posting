// End-to-end check of media-service video processing (reels -> 9:16, standard posts -> platform canvas,
// Threads -> natural aspect). Generates sample clips with ffmpeg, uploads them to the running media-service
// (:3006, POST /api/v1/media/upload), measures every returned file with ffprobe, then deletes the scratch
// files it created in the `post_media` bucket. Writes only under a scratch folder name.
// Usage: node docs/dev-scripts/media-e2e.js
const root = require('path').resolve(__dirname, '..', '..') + '/';
require(root + 'node_modules/dotenv').config({ path: root + '.env', override: true });
const { createClient } = require(root + 'node_modules/@supabase/supabase-js');
const { execFileSync } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const ffmpeg = require(root + 'node_modules/ffmpeg-static');
const ffprobe = require(root + 'node_modules/ffprobe-static').path;
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const SCRATCH_USER = `media-e2e-${Date.now()}`;
const PLATFORMS = ['youtube', 'instagram', 'facebook', 'threads', 'twitter', 'pinterest'];
const CLIPS = { landscape: [1280, 720], vertical: [720, 1280], square: [720, 720] };
const STANDARD = { instagram: [1080, 1350], facebook: [1920, 1006], youtube: [1920, 1080], pinterest: [1000, 1500], twitter: [1920, 1080] };

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => { (ok ? pass++ : fail++); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  [' + detail + ']' : ''}`); };

const makeClip = (name, [w, h]) => {
  const file = path.join(os.tmpdir(), `e2e_${name}_${Date.now()}.mp4`);
  execFileSync(ffmpeg, ['-y', '-v', 'error', '-f', 'lavfi', '-i', `testsrc=size=${w}x${h}:rate=25:duration=4`, '-f', 'lavfi', '-i', 'sine=frequency=440:duration=4', '-t', '4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', file]);
  return file;
};
// recursively deletes every object below a bucket prefix; returns how many files were removed
async function purgeFolder(prefix) {
  const { data: items } = await sb.storage.from('post_media').list(prefix, { limit: 1000 });
  let n = 0;
  const files = [];
  for (const it of items || []) {
    if (it.id) files.push(`${prefix}/${it.name}`); // a file
    else n += await purgeFolder(`${prefix}/${it.name}`); // a folder
  }
  if (files.length) { await sb.storage.from('post_media').remove(files); n += files.length; }
  return n;
}
const probeFile = (file) => {
  const o = JSON.parse(execFileSync(ffprobe, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height:format=duration', '-of', 'json', file]).toString());
  return { w: o.streams[0].width, h: o.streams[0].height, dur: Number(o.format.duration) };
};
// bounding box of the non-black picture, to prove the video was padded (not stretched or cropped)
const cropDetect = (file) => {
  const { spawnSync } = require('child_process');
  const r = spawnSync(ffmpeg, ['-i', file, '-vf', 'cropdetect=limit=24:round=2', '-frames:v', '40', '-f', 'null', '-'], { encoding: 'utf8' });
  const m = [...(r.stderr || '').matchAll(/crop=(\d+):(\d+):(\d+):(\d+)/g)].pop();
  return m ? { w: +m[1], h: +m[2], x: +m[3], y: +m[4] } : null;
};

(async () => {
  const uploaded = [];
  try {
    for (const [clipName, size] of Object.entries(CLIPS)) {
      const clip = makeClip(clipName, size);
      for (const contentType of ['reel', 'post']) {
        const form = new FormData();
        form.append('file', new Blob([fs.readFileSync(clip)], { type: 'video/mp4' }), `${clipName}.mp4`);
        form.append('userId', SCRATCH_USER);
        form.append('platforms', PLATFORMS.join(','));
        form.append('contentType', contentType);
        const res = await fetch('http://localhost:3006/api/v1/media/upload', { method: 'POST', body: form });
        const body = await res.json();
        if (!body.success) { check(`${clipName}/${contentType}: upload`, false, JSON.stringify(body)); continue; }
        for (const platform of PLATFORMS) {
          const url = body.mediaUrls[platform];
          uploaded.push(new URL(url).pathname.split('/post_media/')[1]);
          const file = path.join(os.tmpdir(), `e2e_out_${platform}_${Date.now()}.mp4`);
          fs.writeFileSync(file, Buffer.from(await (await fetch(url)).arrayBuffer()));
          const { w, h, dur } = probeFile(file);
          let expected;
          if (platform === 'threads') expected = [Math.min(size[0], 1920), size[1] * Math.min(size[0], 1920) / size[0]]; // natural aspect
          else if (contentType === 'reel') expected = [1080, 1920];
          else expected = STANDARD[platform];
          const ok = w === Math.round(expected[0]) && Math.abs(h - expected[1]) <= 1 && dur > 3 && dur < 5;
          check(`${clipName.padEnd(9)} ${contentType.padEnd(4)} ${platform.padEnd(9)} -> ${w}x${h}`, ok, `expected ${Math.round(expected[0])}x${Math.round(expected[1])}, ${dur.toFixed(1)}s`);
          if (platform === 'youtube' && contentType === 'reel' && clipName === 'landscape') {
            const box = cropDetect(file);
            // 1280x720 fitted into 1080x1920 = a 1080x608 picture with (1920-608)/2 = 656 px black bars above and below.
            // Only the vertical geometry is checked: the testsrc pattern has dark left/right edges of its own.
            check('landscape reel is PADDED (picture ~608 px tall, centred with ~656 px black bars), not stretched or cropped', !!box && Math.abs(box.h - 608) <= 4 && Math.abs(box.y - 656) <= 4, JSON.stringify(box));
          }
          if (platform === 'youtube' && contentType === 'reel') check(`   ${clipName} reel for YouTube is vertical (a Short needs vertical or square)`, h > w, `${w}x${h}`);
          fs.unlinkSync(file);
        }
      }
      fs.unlinkSync(clip);
    }
  } catch (e) {
    fail++; console.log('FAIL  unexpected error: ' + (e.stack || e.message));
  } finally {
    // cleanup: remove everything under this run's scratch folder (also files of uploads that failed half-way)
    const removed = await purgeFolder(SCRATCH_USER);
    const { data: left } = await sb.storage.from('post_media').list(SCRATCH_USER);
    console.log(`\ncleanup: removed ${removed} scratch files under ${SCRATCH_USER}/; entries left: ${left ? left.length : '?'} (0 = clean)`);
    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
  }
})().catch((e) => { console.log('ERR', e.stack || e.message); process.exit(1); });
