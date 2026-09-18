import fs from 'fs';
import path from 'path';

const root = process.cwd();
const serviceDir = path.join(root, 'services', 'team-service');
if (!fs.existsSync(serviceDir)) fs.mkdirSync(serviceDir, { recursive: true });

const pkg = {
  name: `@socialpush/team-service`,
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
    "express": "^4.18.2",
    "cors": "^2.8.5",
    "@supabase/supabase-js": "^2.39.0"
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
    "skipLibCheck": true
  },
  "include": ["src/**/*"]
};
fs.writeFileSync(path.join(serviceDir, 'tsconfig.json'), JSON.stringify(tsconfig, null, 2));

const srcDir = path.join(serviceDir, 'src');
if (!fs.existsSync(srcDir)) fs.mkdirSync(srcDir);

const indexTs = `import dotenv from 'dotenv';
import path from 'path';
import express from 'express';
import cors from 'cors';
import { createClient } from '@supabase/supabase-js';

dotenv.config({ path: path.join(__dirname, '../../../.env') });

const app = express();
app.use(cors());
app.use(express.json());

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

app.get('/api/v1/teams', async (req, res) => {
  const { userId } = req.query;
  if (!userId) return res.status(400).json({ error: 'userId is required' });
  
  const { data, error } = await supabase
    .from('team_members')
    .select('team_id, role, teams(id, name, plan)')
    .eq('user_id', userId);
    
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true, teams: data.map((d: any) => ({ ...d.teams, role: d.role })) });
});

app.post('/api/v1/teams/:teamId/invite', async (req, res) => {
  const { teamId } = req.params;
  const { email, role, inviterId } = req.body;
  
  const { data: inviter } = await supabase.from('team_members').select('role').eq('team_id', teamId).eq('user_id', inviterId).single();
  if (!inviter || !['owner', 'admin'].includes(inviter.role)) {
    return res.status(403).json({ error: 'Only admins can invite' });
  }

  const { data: { users }, error: fetchErr } = await supabase.auth.admin.listUsers();
  const targetUser = users.find((u: any) => u.email === email);
  
  if (!targetUser) return res.status(404).json({ error: 'User not found' });
  
  const { error } = await supabase.from('team_members').insert({
    team_id: teamId,
    user_id: targetUser.id,
    role
  });
  
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true, message: 'Invited successfully' });
});

app.post('/api/v1/teams/:teamId/billing', async (req, res) => {
  const { teamId } = req.params;
  const { plan, requesterId } = req.body;
  
  const { data: requester } = await supabase.from('team_members').select('role').eq('team_id', teamId).eq('user_id', requesterId).single();
  if (!requester || requester.role !== 'owner') return res.status(403).json({ error: 'Only owners can manage billing' });

  const { error } = await supabase.from('teams').update({ plan }).eq('id', teamId);
  if (error) return res.status(500).json({ error: error.message });
  
  res.json({ success: true });
});

const PORT = process.env.PORT || 3009;
app.listen(PORT, () => {
  console.log(\`Team Service running on port \${PORT}\`);
});
`;
fs.writeFileSync(path.join(srcDir, 'index.ts'), indexTs);

const rootPkgPath = path.join(root, 'package.json');
const rootPkg = JSON.parse(fs.readFileSync(rootPkgPath, 'utf-8'));
rootPkg.scripts = rootPkg.scripts || {};
rootPkg.scripts['dev:team'] = 'npm run dev -w @socialpush/team-service';
rootPkg.scripts['dev:all'] = 'concurrently "npm run dev -w apps/web" "npm run dev:account" "npm run dev:post" "npm run dev:publishing" "npm run dev:scheduling" "npm run dev:worker" "npm run dev:media" "npm run dev:notification" "npm run dev:analytics" "npm run dev:team"';
fs.writeFileSync(rootPkgPath, JSON.stringify(rootPkg, null, 2));

console.log('Team Service scaffolded');
