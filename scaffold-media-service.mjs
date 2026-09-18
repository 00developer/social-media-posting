import fs from 'fs';
import path from 'path';

const root = process.cwd();
const serviceDir = path.join(root, 'services', 'media-service');
if (!fs.existsSync(serviceDir)) fs.mkdirSync(serviceDir, { recursive: true });

const pkg = {
  name: `@socialpush/media-service`,
  version: "1.0.0",
  private: true,
  main: "dist/index.js",
  scripts: {
    "build": "tsc",
    "dev": "ts-node-dev --respawn --transpile-only src/index.ts",
    "start": "node dist/index.js"
  },
  dependencies: {
    "express": "^4.18.2",
    "cors": "^2.8.5",
    "dotenv": "^16.3.1",
    "@supabase/supabase-js": "^2.39.0",
    "multer": "^1.4.5-lts.1",
    "sharp": "^0.33.2"
  },
  devDependencies: {
    "@types/express": "^4.17.21",
    "@types/cors": "^2.8.17",
    "@types/multer": "^1.4.11",
    "@types/node": "^20.10.0",
    "typescript": "^5.3.2",
    "ts-node-dev": "^2.0.0"
  }
};
fs.writeFileSync(path.join(serviceDir, 'package.json'), JSON.stringify(pkg, null, 2));

const tsconfig = {
  "compilerOptions": {
    "target": "ES2022",
    "module": "CommonJS",
    "rootDir": "./src",
    "outDir": "./dist",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "include": ["src/**/*"]
};
fs.writeFileSync(path.join(serviceDir, 'tsconfig.json'), JSON.stringify(tsconfig, null, 2));

const srcDir = path.join(serviceDir, 'src');
if (!fs.existsSync(srcDir)) fs.mkdirSync(srcDir);

const indexTs = `import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import multer from 'multer';
import sharp from 'sharp';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

dotenv.config({ path: path.join(__dirname, '../../../.env') });
const app = express();
app.use(cors());
app.use(express.json());

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const upload = multer({ storage: multer.memoryStorage() });

app.post('/api/v1/media/upload', upload.single('file'), async (req, res) => {
  const { userId, platforms } = req.body; 
  if (!req.file || !userId || !platforms) return res.status(400).json({ error: 'Missing parameters' });

  const platformList = platforms.split(',');
  const postId = crypto.randomUUID(); 
  const results: Record<string, string> = {};

  try {
    for (const platform of platformList) {
      let imageBuffer = req.file.buffer;
      const ext = 'jpg';
      const fileName = \`\${userId}/\${postId}/\${platform}.\${ext}\`;

      if (platform === 'instagram') {
        imageBuffer = await sharp(req.file.buffer).resize(1080, 1350, { fit: 'cover' }).jpeg().toBuffer();
      } else if (platform === 'twitter') {
        imageBuffer = await sharp(req.file.buffer).resize(1200, 675, { fit: 'cover' }).jpeg().toBuffer();
      } else if (platform === 'youtube') {
        imageBuffer = await sharp(req.file.buffer).resize(1920, 1080, { fit: 'cover' }).jpeg().toBuffer();
      } else {
        imageBuffer = await sharp(req.file.buffer).jpeg().toBuffer();
      }

      const { data, error } = await supabase.storage.from('post_media').upload(fileName, imageBuffer, { contentType: 'image/jpeg' });
      
      if (error) throw error;
      
      const { data: { publicUrl } } = supabase.storage.from('post_media').getPublicUrl(fileName);
      results[platform] = publicUrl;
    }

    res.json({ success: true, mediaUrls: results });
  } catch (error: any) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 3006;
app.listen(PORT, () => console.log(\`Media Service listening on port \${PORT}\`));
`;
fs.writeFileSync(path.join(srcDir, 'index.ts'), indexTs);

const rootPkgPath = path.join(root, 'package.json');
const rootPkg = JSON.parse(fs.readFileSync(rootPkgPath, 'utf-8'));
rootPkg.scripts = rootPkg.scripts || {};
rootPkg.scripts['dev:media'] = 'npm run dev -w @socialpush/media-service';
rootPkg.scripts['dev:all'] = 'concurrently "npm run dev -w apps/web" "npm run dev:account" "npm run dev:post" "npm run dev:publishing" "npm run dev:scheduling" "npm run dev:worker" "npm run dev:media"';
fs.writeFileSync(rootPkgPath, JSON.stringify(rootPkg, null, 2));

console.log('Media Service scaffolded');
