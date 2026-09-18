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
dotenv_1.default.config({ path: path_1.default.join(__dirname, '../../../.env') });
const app = (0, express_1.default)();
app.use((0, cors_1.default)());
app.use(express_1.default.json());
const supabase = (0, supabase_js_1.createClient)(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const upload = (0, multer_1.default)({ storage: multer_1.default.memoryStorage() });
app.post('/api/v1/media/upload', upload.single('file'), async (req, res) => {
    const { userId, platforms } = req.body;
    if (!req.file || !userId || !platforms)
        return res.status(400).json({ error: 'Missing parameters' });
    const platformList = platforms.split(',');
    const postId = crypto_1.default.randomUUID();
    const results = {};
    try {
        for (const platform of platformList) {
            let imageBuffer = req.file.buffer;
            const ext = 'jpg';
            const fileName = `${userId}/${postId}/${platform}.${ext}`;
            if (platform === 'instagram') {
                imageBuffer = await (0, sharp_1.default)(req.file.buffer).resize(1080, 1350, { fit: 'cover' }).jpeg().toBuffer();
            }
            else if (platform === 'twitter') {
                imageBuffer = await (0, sharp_1.default)(req.file.buffer).resize(1200, 675, { fit: 'cover' }).jpeg().toBuffer();
            }
            else if (platform === 'youtube') {
                imageBuffer = await (0, sharp_1.default)(req.file.buffer).resize(1920, 1080, { fit: 'cover' }).jpeg().toBuffer();
            }
            else {
                imageBuffer = await (0, sharp_1.default)(req.file.buffer).jpeg().toBuffer();
            }
            const { data, error } = await supabase.storage.from('post_media').upload(fileName, imageBuffer, { contentType: 'image/jpeg' });
            if (error)
                throw error;
            const { data: { publicUrl } } = supabase.storage.from('post_media').getPublicUrl(fileName);
            results[platform] = publicUrl;
        }
        res.json({ success: true, mediaUrls: results });
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
});
const PORT = process.env.PORT || 3006;
app.listen(PORT, () => console.log(`Media Service listening on port ${PORT}`));
