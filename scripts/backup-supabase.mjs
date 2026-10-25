import dotenv from 'dotenv';
 dotenv.config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs/promises';
import path from 'node:path';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error('Missing Supabase URL or service-role key.');
  process.exit(1);
}

const supabase = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false }
});

const { data: tables, error } = await supabase.rpc(
  '__temporary_backup_table_list'
);

if (error) throw new Error(error.message);

const dir = path.resolve(
  'backups',
  `supabase-${new Date().toISOString().replace(/[:.]/g, '-')}`
);
await fs.mkdir(dir, { recursive: true });

const manifest = { createdAt: new Date().toISOString(), tables: [] };

for (const { table_name: table } of tables) {
  console.log(`Exporting ${table}...`);
  const rows = [];
  let offset = 0;
  let failed = false;

  while (true) {
    const { data, error } = await supabase
      .from(table)
      .select('*')
      .range(offset, offset + 499);

    if (error) {
      console.error(`FAILED ${table}: ${error.message}`);
      manifest.tables.push({
        table, status: 'FAILED', exportedRows: rows.length,
        error: error.message
      });
      failed = true;
      break;
    }

    rows.push(...data);
    if (data.length < 500) break;
    offset += 500;
  }

  if (!failed) {
    await fs.writeFile(
      path.join(dir, `${table}.json`),
      JSON.stringify(rows, null, 2),
      'utf8'
    );
    manifest.tables.push({
      table, status: 'EXPORTED', exportedRows: rows.length
    });
    console.log(`  Saved ${rows.length} rows`);
  }
}

await fs.writeFile(
  path.join(dir, 'manifest.json'),
  JSON.stringify(manifest, null, 2),
  'utf8'
);

console.log(`Backup files saved in: ${dir}`);
console.log(`Failed tables: ${manifest.tables.filter(t => t.status === 'FAILED').length}`);

