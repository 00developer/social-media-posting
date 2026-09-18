import fs from 'fs';
import path from 'path';

const root = process.cwd();

// 1. Scaffold Shared Package
const sharedDir = path.join(root, 'packages', 'shared');
if (!fs.existsSync(sharedDir)) fs.mkdirSync(sharedDir, { recursive: true });

const sharedPkg = {
  name: "@socialpush/shared",
  version: "1.0.0",
  main: "dist/index.js",
  types: "dist/index.d.ts",
  scripts: { "build": "tsc" },
  dependencies: { "bullmq": "^4.14.3", "ioredis": "^5.3.2" },
  devDependencies: { "typescript": "^5.3.2", "@types/node": "^20.10.0" }
};
fs.writeFileSync(path.join(sharedDir, 'package.json'), JSON.stringify(sharedPkg, null, 2));

const sharedTsconfig = {
  "compilerOptions": {
    "target": "ES2022",
    "module": "CommonJS",
    "rootDir": "./src",
    "outDir": "./dist",
    "declaration": true,
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "include": ["src/**/*"]
};
fs.writeFileSync(path.join(sharedDir, 'tsconfig.json'), JSON.stringify(sharedTsconfig, null, 2));

const sharedSrcDir = path.join(sharedDir, 'src');
if (!fs.existsSync(sharedSrcDir)) fs.mkdirSync(sharedSrcDir);

const queueTs = `import { Queue, Worker, QueueEvents } from 'bullmq';
import IORedis from 'ioredis';

// Export connection to be shared
export const getRedisConnection = (url: string) => {
  return new IORedis(url, { maxRetriesPerRequest: null });
};

export const PUBLISH_QUEUE_NAME = 'publish-queue';

export const getQueue = (connection: IORedis) => {
  return new Queue(PUBLISH_QUEUE_NAME, { connection });
};
`;
fs.writeFileSync(path.join(sharedSrcDir, 'index.ts'), queueTs);


// 2. Scaffold Services
const services = ['scheduling-service', 'worker'];
for (const service of services) {
  const serviceDir = path.join(root, 'services', service);
  if (!fs.existsSync(serviceDir)) fs.mkdirSync(serviceDir, { recursive: true });
  
  const pkg = {
    name: `@socialpush/${service}`,
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
      "zod": "^3.22.4",
      "bullmq": "^4.14.3",
      "ioredis": "^5.3.2",
      "@socialpush/shared": "*"
    },
    devDependencies: {
      "@types/express": "^4.17.21",
      "@types/cors": "^2.8.17",
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
      "skipLibCheck": true,
      "forceConsistentCasingInFileNames": true,
      "resolveJsonModule": true
    },
    "include": ["src/**/*"]
  };
  fs.writeFileSync(path.join(serviceDir, 'tsconfig.json'), JSON.stringify(tsconfig, null, 2));
  
  const srcDir = path.join(serviceDir, 'src');
  if (!fs.existsSync(srcDir)) fs.mkdirSync(srcDir);
  
  const port = service === 'scheduling-service' ? 3004 : 3005;
  const indexTs = `import express from 'express';\nimport cors from 'cors';\nimport dotenv from 'dotenv';\nimport path from 'path';\n\ndotenv.config({ path: path.join(__dirname, '../../../.env') });\n\nconst app = express();\napp.use(cors());\napp.use(express.json());\n\napp.get('/health', (req, res) => {\n  res.json({ status: 'ok', service: '${service}' });\n});\n\nconst PORT = process.env.PORT || ${port};\napp.listen(PORT, () => {\n  console.log(\`${service} listening on port \${PORT}\`);\n});\n`;
  fs.writeFileSync(path.join(srcDir, 'index.ts'), indexTs);
}

// 3. Update root package.json dev:all script
const rootPkgPath = path.join(root, 'package.json');
const rootPkg = JSON.parse(fs.readFileSync(rootPkgPath, 'utf-8'));
rootPkg.scripts = rootPkg.scripts || {};
rootPkg.scripts['dev:scheduling'] = 'npm run dev -w @socialpush/scheduling-service';
rootPkg.scripts['dev:worker'] = 'npm run dev -w @socialpush/worker';
rootPkg.scripts['dev:all'] = 'concurrently "npm run dev -w apps/web" "npm run dev:account" "npm run dev:post" "npm run dev:publishing" "npm run dev:scheduling" "npm run dev:worker"';
fs.writeFileSync(rootPkgPath, JSON.stringify(rootPkg, null, 2));

console.log('Phase 2 packages scaffolded successfully.');
