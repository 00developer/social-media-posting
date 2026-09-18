import fs from 'fs';
import path from 'path';

const root = process.cwd();
const serviceDir = path.join(root, 'services', 'analytics-service');
if (!fs.existsSync(serviceDir)) fs.mkdirSync(serviceDir, { recursive: true });

const pkg = {
  name: `@socialpush/analytics-service`,
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
import { Queue, Worker, Job } from 'bullmq';
import { getRedisConnection } from '@socialpush/shared';
import { createClient } from '@supabase/supabase-js';

dotenv.config({ path: path.join(__dirname, '../../../.env') });

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const redisConnection = getRedisConnection(process.env.REDIS_URL || 'redis://localhost:6379');

const ANALYTICS_QUEUE_NAME = 'analytics-queue';
const analyticsQueue = new Queue(ANALYTICS_QUEUE_NAME, { connection: redisConnection });

async function setupCron() {
  await analyticsQueue.add('fetch-analytics', {}, {
    repeat: { pattern: '*/5 * * * *' } // Every 5 minutes
  });
  console.log('Analytics Service started. Scheduled to run every 5 minutes.');
}

const worker = new Worker(ANALYTICS_QUEUE_NAME, async (job: Job) => {
  console.log(\`[AnalyticsService] Running analytics pull...\`);
  
  try {
    const { data: jobs, error } = await supabase.from('publish_jobs')
      .select('post_id, user_id, platform')
      .eq('status', 'completed');
      
    if (error) throw error;
    if (!jobs || jobs.length === 0) return;

    for (const j of jobs) {
      const { data: existing } = await supabase.from('analytics')
        .select('*')
        .eq('post_id', j.post_id)
        .eq('platform', j.platform)
        .single();
        
      const mockLikes = Math.floor(Math.random() * 5);
      const mockShares = Math.floor(Math.random() * 2);
      const mockViews = Math.floor(Math.random() * 20) + 5;
      
      if (existing) {
        await supabase.from('analytics')
          .update({
            likes: existing.likes + mockLikes,
            shares: existing.shares + mockShares,
            views: existing.views + mockViews,
            recorded_at: new Date().toISOString()
          })
          .eq('id', existing.id);
      } else {
        await supabase.from('analytics')
          .insert({
            post_id: j.post_id,
            user_id: j.user_id,
            platform: j.platform,
            likes: mockLikes,
            shares: mockShares,
            views: mockViews,
            recorded_at: new Date().toISOString()
          });
      }
    }
    
    console.log(\`[AnalyticsService] Successfully updated analytics for \${jobs.length} published posts.\`);
  } catch (err: any) {
    console.error(\`[AnalyticsService] Error:\`, err.message);
  }
}, { connection: redisConnection });

setupCron();
`;
fs.writeFileSync(path.join(srcDir, 'index.ts'), indexTs);

const rootPkgPath = path.join(root, 'package.json');
const rootPkg = JSON.parse(fs.readFileSync(rootPkgPath, 'utf-8'));
rootPkg.scripts = rootPkg.scripts || {};
rootPkg.scripts['dev:analytics'] = 'npm run dev -w @socialpush/analytics-service';
rootPkg.scripts['dev:all'] = 'concurrently "npm run dev -w apps/web" "npm run dev:account" "npm run dev:post" "npm run dev:publishing" "npm run dev:scheduling" "npm run dev:worker" "npm run dev:media" "npm run dev:notification" "npm run dev:analytics"';
fs.writeFileSync(rootPkgPath, JSON.stringify(rootPkg, null, 2));

console.log('Analytics Service scaffolded');
