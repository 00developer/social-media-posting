import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import multer from 'multer';
import sharp from 'sharp';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegPath from 'ffmpeg-static';
import ffprobePath from 'ffprobe-static';
import fs from 'fs';
import os from 'os';

ffmpeg.setFfmpegPath(ffmpegPath as string);
ffmpeg.setFfprobePath(ffprobePath.path);

dotenv.config({ path: path.join(__dirname, '../../../.env') });
const app = express();
app.use(cors());
app.use(express.json());

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const upload = multer({ storage: multer.memoryStorage() });

async function processVideo(inputBuffer: Buffer, platform: string, contentType: string = 'post'): Promise<Buffer> {
  const tempInput = path.join(os.tmpdir(), `in_${crypto.randomUUID()}.mp4`);
  const tempOutput = path.join(os.tmpdir(), `out_${crypto.randomUUID()}.mp4`);
  
  await fs.promises.writeFile(tempInput, inputBuffer);

  const duration = await new Promise<number>((resolve, reject) => {
    ffmpeg.ffprobe(tempInput, (err, metadata) => {
      if (err) return reject(err);
      resolve(metadata.format.duration || 0);
    });
  });

  if (contentType === 'reel') {
    if (platform === 'youtube' && duration > 180) {
      fs.promises.unlink(tempInput).catch(() => {});
      throw new Error('Video is too long for YouTube Shorts. Maximum allowed duration is 180 seconds.');
    }
    if (platform === 'instagram' && duration > 90) {
      fs.promises.unlink(tempInput).catch(() => {});
      throw new Error('Video is too long for Instagram Reels. Maximum allowed duration is 90 seconds.');
    }
    if (platform === 'facebook' && (duration < 3 || duration > 90)) {
      fs.promises.unlink(tempInput).catch(() => {});
      throw new Error('Video duration must be between 3 and 90 seconds for Facebook Reels.');
    }
  }

  let scale = '1920:1080';
  if (contentType === 'reel') {
    scale = '1080:1920'; // 9:16
  } else {
    if (platform === 'instagram') scale = '1080:1350';
    else if (platform === 'facebook') scale = '1920:1005';
    else if (platform === 'youtube') scale = '1920:1080';
    else if (platform === 'pinterest') scale = '1000:1500';
  }
  
  return new Promise((resolve, reject) => {
    ffmpeg(tempInput)
      .outputOptions([
        '-c:v libx264',
        '-preset fast',
        '-crf 22',
        '-c:a aac',
        '-b:a 128k',
        `-vf scale=${scale}:force_original_aspect_ratio=decrease,pad=${scale}:(ow-iw)/2:(oh-ih)/2`
      ])
      .save(tempOutput)
      .on('end', async () => {
        try {
          const outBuffer = await fs.promises.readFile(tempOutput);
          fs.promises.unlink(tempInput).catch(() => {});
          fs.promises.unlink(tempOutput).catch(() => {});
          resolve(outBuffer);
        } catch (e) {
          reject(e);
        }
      })
      .on('error', (err) => {
        fs.promises.unlink(tempInput).catch(() => {});
        reject(err);
      });
  });
}

app.post('/api/v1/media/upload', upload.single('file'), async (req, res) => {
  const { userId, platforms, contentType } = req.body; 
  if (!req.file || !userId || !platforms) return res.status(400).json({ error: 'Missing parameters' });

  const platformList = platforms.split(',');
  const postId = crypto.randomUUID(); 
  const results: Record<string, string> = {};

  try {
    const isVideo = req.file.mimetype.startsWith('video/');

    for (const platform of platformList) {
      if (isVideo) {
        let videoBuffer = req.file.buffer;
        const ext = 'mp4';
        const fileName = `${userId}/${postId}/${platform}.${ext}`;

        videoBuffer = await processVideo(req.file.buffer, platform, contentType);

        const { data, error } = await supabase.storage.from('post_media').upload(fileName, videoBuffer, { contentType: 'video/mp4' });
        if (error) throw error;
        
        const { data: { publicUrl } } = supabase.storage.from('post_media').getPublicUrl(fileName);
        results[platform] = publicUrl;
      } else {
        let imageBuffer = req.file.buffer;
        const ext = 'jpg';
        const fileName = `${userId}/${postId}/${platform}.${ext}`;

        if (platform === 'instagram') {
          imageBuffer = await sharp(req.file.buffer).resize(1080, 1350, { fit: 'cover' }).jpeg().toBuffer();
        } else if (platform === 'twitter') {
          imageBuffer = await sharp(req.file.buffer).resize(1200, 675, { fit: 'cover' }).jpeg().toBuffer();
        } else if (platform === 'youtube') {
          imageBuffer = await sharp(req.file.buffer).resize(1920, 1080, { fit: 'cover' }).jpeg().toBuffer();
        } else if (platform === 'pinterest') {
          imageBuffer = await sharp(req.file.buffer).resize(1000, 1500, { fit: 'cover' }).jpeg().toBuffer();
        } else {
          imageBuffer = await sharp(req.file.buffer).jpeg().toBuffer();
        }

        const { data, error } = await supabase.storage.from('post_media').upload(fileName, imageBuffer, { contentType: 'image/jpeg' });
        if (error) throw error;
        
        const { data: { publicUrl } } = supabase.storage.from('post_media').getPublicUrl(fileName);
        results[platform] = publicUrl;
      }
    }

    res.json({ success: true, mediaUrls: results });
  } catch (error: any) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 3006;
app.listen(PORT, () => console.log(`Media Service listening on port ${PORT}`));
