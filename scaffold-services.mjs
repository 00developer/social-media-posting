import fs from 'fs';
import path from 'path';

const services = ['account-service', 'post-service', 'publishing-service'];
const root = process.cwd();

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
      "twitter-api-v2": "^1.15.2"
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
  
  const port = service === 'account-service' ? 3001 : service === 'post-service' ? 3002 : 3003;
  
  const indexTs = `import express from 'express';\nimport cors from 'cors';\nimport dotenv from 'dotenv';\nimport path from 'path';\n\ndotenv.config({ path: path.join(__dirname, '../../../.env') });\n\nconst app = express();\napp.use(cors());\napp.use(express.json());\n\napp.get('/health', (req, res) => {\n  res.json({ status: 'ok', service: '${service}' });\n});\n\nconst PORT = process.env.PORT || ${port};\napp.listen(PORT, () => {\n  console.log(\`${service} listening on port \${PORT}\`);\n});\n`;

  fs.writeFileSync(path.join(srcDir, 'index.ts'), indexTs);
}
console.log('Services scaffolded successfully.');
