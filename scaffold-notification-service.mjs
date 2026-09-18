import fs from 'fs';
import path from 'path';

const root = process.cwd();
const serviceDir = path.join(root, 'services', 'notification-service');
if (!fs.existsSync(serviceDir)) fs.mkdirSync(serviceDir, { recursive: true });

const pkg = {
  name: `@socialpush/notification-service`,
  version: "1.0.0",
  private: true,
  main: "dist/index.js",
  scripts: {
    "build": "tsc",
    "dev": "ts-node-dev --respawn --transpile-only src/index.ts",
    "start": "node dist/index.js"
  },
  dependencies: {
    "dotenv": "^16.3.1",
    "@supabase/supabase-js": "^2.39.0",
    "bullmq": "^4.14.0"
  },
  devDependencies: {
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

const indexTs = `import dotenv from 'dotenv';
import path from 'path';
import { Worker, Job } from 'bullmq';
import { getRedisConnection, NOTIFICATIONS_QUEUE_NAME } from '@socialpush/shared';
import { createClient } from '@supabase/supabase-js';

dotenv.config({ path: path.join(__dirname, '../../../.env') });

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const redisConnection = getRedisConnection(process.env.REDIS_URL || 'redis://localhost:6379');

console.log('Notification Service started. Listening to queue:', NOTIFICATIONS_QUEUE_NAME);

const worker = new Worker(NOTIFICATIONS_QUEUE_NAME, async (job: Job) => {
  const { userId, type, message } = job.data;
  console.log(\`[NotificationService] Processing notification for user \${userId} - Type: \${type}\`);

  try {
    await supabase.from('notifications').insert({
      user_id: userId,
      type,
      message,
      read: false
    });

    const { data: user } = await supabase.auth.admin.getUserById(userId);
    const email = user?.user?.email;
    
    console.log(\`[Email Mock] Sending email to \${email}:\`);
    console.log(\`Subject: SocialPush Update - \${type === 'success' ? 'Post Published' : 'Publishing Failed'}\`);
    console.log(\`Body: \${message}\`);
    console.log('----------------------------------------------------');

  } catch (error: any) {
    console.error(\`[NotificationService] Error:\`, error.message);
    throw error;
  }
}, { connection: redisConnection });

worker.on('failed', (job, err) => {
  console.log(\`[NotificationService] Job \${job?.id} failed with \${err.message}\`);
});
`;
fs.writeFileSync(path.join(srcDir, 'index.ts'), indexTs);

const rootPkgPath = path.join(root, 'package.json');
const rootPkg = JSON.parse(fs.readFileSync(rootPkgPath, 'utf-8'));
rootPkg.scripts = rootPkg.scripts || {};
rootPkg.scripts['dev:notification'] = 'npm run dev -w @socialpush/notification-service';
rootPkg.scripts['dev:all'] = 'concurrently "npm run dev -w apps/web" "npm run dev:account" "npm run dev:post" "npm run dev:publishing" "npm run dev:scheduling" "npm run dev:worker" "npm run dev:media" "npm run dev:notification"';
fs.writeFileSync(rootPkgPath, JSON.stringify(rootPkg, null, 2));

console.log('Notification Service scaffolded');
