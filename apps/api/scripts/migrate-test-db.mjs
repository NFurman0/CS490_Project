import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import process from 'node:process';
import { resolve } from 'node:path';

if (existsSync('.env.test')) {
  delete process.env.DATABASE_URL;
  process.loadEnvFile('.env.test');
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  process.stderr.write(
    'DATABASE_URL in apps/api/.env.test is required to migrate the integration test database.\n',
  );
  process.exit(1);
}

const prismaCli = resolve(process.cwd(), '../../node_modules/prisma/build/index.js');
if (!existsSync(prismaCli)) throw new Error('Prisma CLI entry point was not found.');
const result = spawnSync(
  process.execPath,
  [prismaCli, 'migrate', 'deploy', '--schema', 'prisma/schema.prisma'],
  {
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: 'inherit',
  },
);

if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
