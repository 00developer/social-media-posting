"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const dotenv_1 = __importDefault(require("dotenv"));
const path_1 = __importDefault(require("path"));
const multer_1 = __importDefault(require("multer"));
const sharp_1 = __importDefault(require("sharp"));
const supabase_js_1 = require("@supabase/supabase-js");
const crypto_1 = __importDefault(require("crypto"));
const fluent_ffmpeg_1 = __importDefault(require("fluent-ffmpeg"));
const ffmpeg_static_1 = __importDefault(require("ffmpeg-static"));
const ffprobe_static_1 = __importDefault(require("ffprobe-static"));
const videoFilter_1 = require("./videoFilter");
const fs_1 = __importDefault(require("fs"));
const os_1 = __importDefault(require("os"));
const shared_1 = require("@socialpush/shared");
fluent_ffmpeg_1.default.setFfmpegPath(ffmpeg_static_1.default);
fluent_ffmpeg_1.default.setFfprobePath(ffprobe_static_1.default.path);
dotenv_1.default.config({ path: path_1.default.join(__dirname, '../../../.env') });
const app = (0, express_1.default)();
app.use((0, cors_1.default)());
app.use(express_1.default.json());
const supabase = (0, supabase_js_1.createClient)(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const upload = (0, multer_1.default)({ storage: multer_1.default.memoryStorage() });
async function processVideo(inputBuffer, platform, contentType = 'post') {
    const tempInput = path_1.default.join(os_1.default.tmpdir(), `in_${crypto_1.default.randomUUID()}.mp4`);
    const tempOutput = path_1.default.join(os_1.default.tmpdir(), `out_${crypto_1.default.randomUUID()}.mp4`);
    await fs_1.default.promises.writeFile(tempInput, inputBuffer);
    const duration = await new Promise((resolve, reject) => {
        fluent_ffmpeg_1.default.ffprobe(tempInput, (err, metadata) => {
            if (err)
                return reject(err);
            resolve(metadata.format.duration || 0);
        });
    });
    if (contentType === 'reel') {
        if (platform === 'youtube' && duration > 180) {
            fs_1.default.promises.unlink(tempInput).catch(() => { });
            throw new Error('Video is too long for YouTube Shorts. Maximum allowed duration is 180 seconds.');
        }
        if (platform === 'instagram' && duration > 90) {
            fs_1.default.promises.unlink(tempInput).catch(() => { });
            throw new Error('Video is too long for Instagram Reels. Maximum allowed duration is 90 seconds.');
        }
        if (platform === 'facebook' && (duration < 3 || duration > 90)) {
            fs_1.default.promises.unlink(tempInput).catch(() => { });
            throw new Error('Video duration must be between 3 and 90 seconds for Facebook Reels.');
        }
    }
    if (platform === 'threads' && duration > 300) {
        fs_1.default.promises.unlink(tempInput).catch(() => { });
        throw new Error('Video is too long for Threads. Maximum allowed duration is 300 seconds.');
    }
    // Reels/Shorts are fitted onto a 9:16 canvas (padded), standard posts onto the platform canvas,
    // Threads keeps its own aspect ratio (see videoFilter.ts).
    const scaleFilter = (0, videoFilter_1.getVideoFilter)(platform, contentType);
    return new Promise((resolve, reject) => {
        (0, fluent_ffmpeg_1.default)(tempInput)
            .outputOptions([
            '-c:v libx264',
            '-preset ultrafast',
            '-crf 28',
            '-c:a aac',
            '-b:a 96k',
            `-vf ${scaleFilter}`,
            '-pix_fmt yuv420p'
        ])
            .save(tempOutput)
            .on('end', async () => {
            try {
                const outBuffer = await fs_1.default.promises.readFile(tempOutput);
                fs_1.default.promises.unlink(tempInput).catch(() => { });
                fs_1.default.promises.unlink(tempOutput).catch(() => { });
                resolve(outBuffer);
            }
            catch (e) {
                reject(e);
            }
        })
            .on('error', (err) => {
            fs_1.default.promises.unlink(tempInput).catch(() => { });
            reject(err);
        });
    });
}
app.post('/api/v1/media/upload', upload.single('file'), async (req, res) => {
    const { platforms, contentType } = req.body;
    const uploadedFile = req.file;
    if (!uploadedFile || !platforms)
        return res.status(400).json({ error: 'Missing parameters' });
    const authed = await (0, shared_1.requireUser)(req, supabase);
    if ('error' in authed)
        return res.status(authed.status).json({ error: authed.error });
    const userId = authed.userId;
    const platformList = platforms.split(',');
    const postId = crypto_1.default.randomUUID();
    const results = {};
    try {
        const isVideo = uploadedFile.mimetype.startsWith('video/');
        await Promise.all(platformList.map(async (platform) => {
            if (isVideo) {
                const ext = 'mp4';
                const fileName = `${userId}/${postId}/${platform}.${ext}`;
                const videoBuffer = await processVideo(uploadedFile.buffer, platform, contentType);
                let uploadError = null;
                for (let attempt = 1; attempt <= 3; attempt++) {
                    const { error } = await supabase.storage.from('post_media').upload(fileName, videoBuffer, { contentType: 'video/mp4', upsert: true });
                    if (!error) {
                        uploadError = null;
                        break;
                    }
                    uploadError = error;
                    console.warn(`Upload attempt ${attempt} failed for ${platform}:`, error.message);
                    await new Promise(r => setTimeout(r, 1000)); // wait 1s before retry
                }
                if (uploadError)
                    throw uploadError;
                const { data: { publicUrl } } = supabase.storage.from('post_media').getPublicUrl(fileName);
                results[platform] = publicUrl;
            }
            else {
                let imageBuffer = uploadedFile.buffer;
                const ext = 'jpg';
                const fileName = `${userId}/${postId}/${platform}.${ext}`;
                if (platform === 'instagram') {
                    imageBuffer = await (0, sharp_1.default)(uploadedFile.buffer).resize(1080, 1350, { fit: 'cover' }).jpeg().toBuffer();
                }
                else if (platform === 'twitter') {
                    imageBuffer = await (0, sharp_1.default)(uploadedFile.buffer).resize(1200, 675, { fit: 'cover' }).jpeg().toBuffer();
                }
                else if (platform === 'youtube') {
                    imageBuffer = await (0, sharp_1.default)(uploadedFile.buffer).resize(1920, 1080, { fit: 'cover' }).jpeg().toBuffer();
                }
                else if (platform === 'pinterest') {
                    imageBuffer = await (0, sharp_1.default)(uploadedFile.buffer).resize(1000, 1500, { fit: 'cover' }).jpeg().toBuffer();
                }
                else if (platform === 'threads') {
                    imageBuffer = await (0, sharp_1.default)(uploadedFile.buffer).resize({ width: 1440, withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
                }
                else {
                    imageBuffer = await (0, sharp_1.default)(uploadedFile.buffer).jpeg().toBuffer();
                }
                let uploadError = null;
                for (let attempt = 1; attempt <= 3; attempt++) {
                    const { error } = await supabase.storage.from('post_media').upload(fileName, imageBuffer, { contentType: 'image/jpeg', upsert: true });
                    if (!error) {
                        uploadError = null;
                        break;
                    }
                    uploadError = error;
                    console.warn(`Upload attempt ${attempt} failed for ${platform}:`, error.message);
                    await new Promise(r => setTimeout(r, 1000)); // wait 1s before retry
                }
                if (uploadError)
                    throw uploadError;
                const { data: { publicUrl } } = supabase.storage.from('post_media').getPublicUrl(fileName);
                results[platform] = publicUrl;
            }
        }));
        res.json({ success: true, mediaUrls: results });
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
});
app.post('/api/v1/media/transcode-preview', upload.single('file'), async (req, res) => {
    if (!req.file)
        return res.status(400).json({ error: 'Missing file' });
    const authed = await (0, shared_1.requireUser)(req, supabase);
    if ('error' in authed)
        return res.status(authed.status).json({ error: authed.error });
    const tempInput = path_1.default.join(os_1.default.tmpdir(), `in_${crypto_1.default.randomUUID()}.mp4`);
    const tempOutput = path_1.default.join(os_1.default.tmpdir(), `out_${crypto_1.default.randomUUID()}.mp4`);
    try {
        await fs_1.default.promises.writeFile(tempInput, req.file.buffer);
        // Fast transcode to web-safe 480p H.264
        (0, fluent_ffmpeg_1.default)(tempInput)
            .outputOptions([
            '-c:v libx264',
            '-preset ultrafast',
            '-crf 28',
            '-c:a aac',
            '-b:a 96k',
            // scale width to 480, height proportional, ensure height is even
            '-vf scale=480:trunc(ow/a/2)*2',
            '-pix_fmt yuv420p'
        ])
            .save(tempOutput)
            .on('end', async () => {
            try {
                res.sendFile(tempOutput, { headers: { 'Content-Type': 'video/mp4' } }, (err) => {
                    fs_1.default.promises.unlink(tempInput).catch(() => { });
                    fs_1.default.promises.unlink(tempOutput).catch(() => { });
                });
            }
            catch (e) {
                console.error(e);
                res.status(500).send('Error sending file');
            }
        })
            .on('error', (err) => {
            console.error('FFmpeg preview transcode error:', err);
            fs_1.default.promises.unlink(tempInput).catch(() => { });
            res.status(500).json({ error: 'Failed to transcode preview' });
        });
    }
    catch (err) {
        console.error(err);
        fs_1.default.promises.unlink(tempInput).catch(() => { });
        res.status(500).json({ error: err.message });
    }
});
// A small, throwaway public image the AI Assistant can look at while generating a caption: for an image, a
// downsized copy; for a video, a single frame grabbed a second in (the AI can't watch a video, only see a picture).
// Stored under ai-context/ in the same public bucket the post media uses - these accumulate over time with no
// cleanup job yet, which is fine at this scale but worth revisiting if storage usage becomes a concern.
app.post('/api/v1/media/ai-thumbnail', upload.single('file'), async (req, res) => {
    const uploadedFile = req.file;
    if (!uploadedFile)
        return res.status(400).json({ error: 'Missing parameters' });
    const authed = await (0, shared_1.requireUser)(req, supabase);
    if ('error' in authed)
        return res.status(authed.status).json({ error: authed.error });
    const userId = authed.userId;
    const fileName = `ai-context/${userId}/${crypto_1.default.randomUUID()}.jpg`;
    try {
        const isVideo = uploadedFile.mimetype.startsWith('video/');
        let jpeg;
        if (isVideo) {
            const tempInput = path_1.default.join(os_1.default.tmpdir(), `in_${crypto_1.default.randomUUID()}.mp4`);
            const tempFrame = path_1.default.join(os_1.default.tmpdir(), `frame_${crypto_1.default.randomUUID()}.jpg`);
            await fs_1.default.promises.writeFile(tempInput, uploadedFile.buffer);
            try {
                await new Promise((resolve, reject) => {
                    (0, fluent_ffmpeg_1.default)(tempInput)
                        .screenshots({ timestamps: ['1'], filename: path_1.default.basename(tempFrame), folder: path_1.default.dirname(tempFrame), size: '1024x?' })
                        .on('end', () => resolve())
                        .on('error', reject);
                });
                jpeg = await fs_1.default.promises.readFile(tempFrame);
            }
            finally {
                fs_1.default.promises.unlink(tempInput).catch(() => { });
                fs_1.default.promises.unlink(tempFrame).catch(() => { });
            }
        }
        else {
            jpeg = await (0, sharp_1.default)(uploadedFile.buffer).resize({ width: 1024, withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer();
        }
        const { error } = await supabase.storage.from('post_media').upload(fileName, jpeg, { contentType: 'image/jpeg', upsert: true });
        if (error)
            throw error;
        const { data: { publicUrl } } = supabase.storage.from('post_media').getPublicUrl(fileName);
        res.json({ success: true, url: publicUrl });
    }
    catch (error) {
        console.error('[Media] AI thumbnail failed:', error.message);
        res.status(500).json({ error: 'Could not prepare the media for the AI assistant.' });
    }
});
const PORT = process.env.PORT || 3006;
const server = app.listen(PORT, () => console.log(`Media Service listening on port ${PORT}`));
server.timeout = 10 * 60 * 1000; // 10 minutes timeout to allow long video processing
