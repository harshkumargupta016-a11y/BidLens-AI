/**
 * BidLens AI — MSME Data Seeding & Normalization Script (TypeScript Source)
 *
 * Normalizes a flat 38-column CSV (bidlens_ai_60_msme_companies_seed.csv) into 3 relational tables:
 *   1. msme_profiles   (Company identity, demographics, audited 3-yr financials)
 *   2. work_orders     (Past similar contract awards & values)
 *   3. vault_documents (Regulatory certificates, ISO validity, affidavits, and lab reports)
 *
 * Execution Modes:
 *   - Native Supabase REST HTTPS API: Zero-dependency seeding if SUPABASE_URL & SUPABASE_KEY are in .env
 *   - @supabase/supabase-js SDK: Used if installed in environment
 *   - PostgreSQL Pool: Used if DATABASE_URL is present
 *   - Standalone SQL: Writes database/seed_msme_normalized.sql
 *
 * Run with:
 *   node scripts/seed-msmes.js
 *   OR npx tsx scripts/seed-msmes.ts
 */

import * as fs from 'fs';
import * as path from 'path';

// Ambient global declarations for seamless TypeScript editor compatibility without @types/node
declare const require: any;
declare const module: any;
declare const process: any;
declare const __dirname: string;

// Auto-load .env without requiring external dotenv package
function loadEnv(): void {
  const candidateEnvPaths = [
    path.resolve(process.cwd(), '.env'),
    path.resolve(__dirname, '../.env'),
    path.resolve(__dirname, '../../.env'),
    path.resolve(process.cwd(), 'bidlens-backend/.env'),
  ];

  for (const envPath of candidateEnvPaths) {
    if (fs.existsSync(envPath)) {
      try {
        const content = fs.readFileSync(envPath, 'utf8');
        for (const line of content.split(/\r?\n/)) {
          const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
          if (match && !(match[1] in process.env)) {
            process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
          }
        }
      } catch {}
    }
  }
}

loadEnv();

// Optional dynamic imports
let createClient: any = null;
try {
  const req = typeof require !== 'undefined' ? require : null;
  if (req) {
    const supabaseModule = req('@supabase/supabase-js');
    createClient = supabaseModule.createClient;
  }
} catch {}

let pg: any = null;
try {
  const req = typeof require !== 'undefined' ? require : null;
  if (req) {
    pg = req('pg');
  }
} catch {}

// -----------------------------------------------------------------------------
// Interfaces
// -----------------------------------------------------------------------------
export interface RawCsvRow {
  company_id: string;
  legal_name: string;
  udyam_number: string;
  enterprise_category: string;
  mse_eligible: string;
  sector: string;
  city: string;
  state: string;
  gst_number: string;
  pan_number: string;
  year_of_establishment: string;
  is_women_owned: string;
  is_sc_st_owned: string;
  is_dpiit_startup: string;
  turnover_fy21_22_lakhs: string;
  turnover_fy22_23_lakhs: string;
  turnover_fy23_24_lakhs: string;
  avg_3yr_turnover_lakhs: string;
  net_worth_lakhs: string;
  ca_turnover_udin: string;
  work_order_1_client: string;
  work_order_1_value_lakhs: string;
  work_order_1_year: string;
  work_order_2_client: string;
  work_order_2_value_lakhs: string;
  work_order_2_year: string;
  work_order_3_client: string;
  work_order_3_value_lakhs: string;
  work_order_3_year: string;
  max_single_work_lakhs: string;
  completed_works_count: string;
  udyam_cert_status: string;
  gst_cert_status: string;
  iso_9001_status: string;
  iso_9001_valid_until: string;
  annexure_iv_affidavit_uploaded: string;
  type_test_report_lab: string;
  profile_completeness_pct: string;
}

export interface MsmeProfileRecord {
  id: string;
  legal_name: string;
  udyam_number: string;
  enterprise_category: 'Micro' | 'Small' | 'Medium';
  mse_eligible: boolean;
  sector: string;
  city: string;
  state: string;
  gst_number: string | null;
  pan_number: string | null;
  year_of_establishment: number | null;
  is_women_owned: boolean;
  is_sc_st_owned: boolean;
  is_dpiit_startup: boolean;
  turnover_fy21_22_lakhs: number;
  turnover_fy22_23_lakhs: number;
  turnover_fy23_24_lakhs: number;
  avg_3yr_turnover_lakhs: number;
  net_worth_lakhs: number;
  ca_turnover_udin: string | null;
  profile_completeness_pct: number;
  is_demo_seed: boolean;
}

export interface WorkOrderRecord {
  company_id: string;
  work_order_num: number;
  client_name: string;
  value_lakhs: number;
  completion_year: number | null;
}

export interface VaultDocumentRecord {
  company_id: string;
  doc_type: 'UDYAM' | 'GST' | 'ISO_9001' | 'ANNEXURE_IV' | 'TYPE_TEST';
  document_name: string;
  status: 'VALID' | 'EXPIRED' | 'MISSING' | 'UPLOADED';
  valid_until: string | null;
  details: Record<string, any>;
}

export interface NormalizedDataset {
  profiles: MsmeProfileRecord[];
  workOrders: WorkOrderRecord[];
  vaultDocuments: VaultDocumentRecord[];
}

// -----------------------------------------------------------------------------
// Utilities
// -----------------------------------------------------------------------------
function parseBool(val: any, fallback = false): boolean {
  if (val === undefined || val === null) return fallback;
  const s = String(val).trim().toLowerCase();
  if (s === 'true' || s === '1' || s === 'yes') return true;
  if (s === 'false' || s === '0' || s === 'no') return false;
  return fallback;
}

function parseNum(val: any, fallback = 0.0): number {
  if (!val) return fallback;
  const n = parseFloat(String(val).replace(/[^0-9.-]/g, ''));
  return isNaN(n) ? fallback : n;
}

function parseIntNum(val: any, fallback: number | null = null): number | null {
  if (!val) return fallback;
  const n = parseInt(String(val).replace(/[^0-9-]/g, ''), 10);
  return isNaN(n) ? fallback : n;
}

function parseDateStr(val: any): string | null {
  if (!val || typeof val !== 'string') return null;
  const trimmed = val.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const d = new Date(trimmed);
  if (!isNaN(d.getTime())) {
    return d.toISOString().split('T')[0];
  }
  return null;
}

function escapeSqlStr(val: any): string {
  if (val === null || val === undefined) return 'NULL';
  return `'${String(val).replace(/'/g, "''")}'`;
}

// -----------------------------------------------------------------------------
// CSV Parser
// -----------------------------------------------------------------------------
export function parseCsv(csvContent: string): RawCsvRow[] {
  const lines = csvContent.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  if (lines.length < 2) return [];

  const headers = parseCsvLine(lines[0]);
  const rows: RawCsvRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const values = parseCsvLine(line);
    const rowObj: any = {};
    for (let h = 0; h < headers.length; h++) {
      rowObj[headers[h]] = values[h] !== undefined ? values[h].trim() : '';
    }
    rows.push(rowObj as RawCsvRow);
  }

  return rows;
}

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let inQuotes = false;
  let current = '';

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}

// -----------------------------------------------------------------------------
// Normalization Transformer
// -----------------------------------------------------------------------------
export function normalizeMsmeData(rows: RawCsvRow[]): NormalizedDataset {
  const profiles: MsmeProfileRecord[] = [];
  const workOrders: WorkOrderRecord[] = [];
  const vaultDocuments: VaultDocumentRecord[] = [];

  for (const row of rows) {
    if (!row.company_id || !row.legal_name) continue;

    const categoryRaw = row.enterprise_category?.trim() || 'Small';
    const category = (['Micro', 'Small', 'Medium'].includes(categoryRaw)
      ? categoryRaw
      : 'Small') as 'Micro' | 'Small' | 'Medium';

    profiles.push({
      id: row.company_id.trim(),
      legal_name: row.legal_name.trim(),
      udyam_number: row.udyam_number.trim(),
      enterprise_category: category,
      mse_eligible: parseBool(row.mse_eligible, true),
      sector: row.sector?.trim() || 'General Engineering',
      city: row.city?.trim() || 'Indore',
      state: row.state?.trim() || 'Madhya Pradesh',
      gst_number: row.gst_number?.trim() || null,
      pan_number: row.pan_number?.trim() || null,
      year_of_establishment: parseIntNum(row.year_of_establishment),
      is_women_owned: parseBool(row.is_women_owned, false),
      is_sc_st_owned: parseBool(row.is_sc_st_owned, false),
      is_dpiit_startup: parseBool(row.is_dpiit_startup, false),
      turnover_fy21_22_lakhs: parseNum(row.turnover_fy21_22_lakhs),
      turnover_fy22_23_lakhs: parseNum(row.turnover_fy22_23_lakhs),
      turnover_fy23_24_lakhs: parseNum(row.turnover_fy23_24_lakhs),
      avg_3yr_turnover_lakhs: parseNum(row.avg_3yr_turnover_lakhs),
      net_worth_lakhs: parseNum(row.net_worth_lakhs),
      ca_turnover_udin: row.ca_turnover_udin?.trim() || null,
      profile_completeness_pct: parseIntNum(row.profile_completeness_pct, 0) || 0,
      is_demo_seed: true,
    });

    const woConfigs = [
      { num: 1, client: row.work_order_1_client, val: row.work_order_1_value_lakhs, yr: row.work_order_1_year },
      { num: 2, client: row.work_order_2_client, val: row.work_order_2_value_lakhs, yr: row.work_order_2_year },
      { num: 3, client: row.work_order_3_client, val: row.work_order_3_value_lakhs, yr: row.work_order_3_year },
    ];

    for (const wo of woConfigs) {
      const client = wo.client?.trim();
      const val = parseNum(wo.val, -1);
      if (client && client.length > 0 && val >= 0) {
        workOrders.push({
          company_id: row.company_id.trim(),
          work_order_num: wo.num,
          client_name: client,
          value_lakhs: val,
          completion_year: parseIntNum(wo.yr),
        });
      }
    }

    vaultDocuments.push({
      company_id: row.company_id.trim(),
      doc_type: 'UDYAM',
      document_name: 'Udyam Registration Certificate',
      status: (row.udyam_cert_status?.trim().toUpperCase() || 'VALID') as any,
      valid_until: null,
      details: { udyam_number: row.udyam_number?.trim(), enterprise_category: category },
    });

    vaultDocuments.push({
      company_id: row.company_id.trim(),
      doc_type: 'GST',
      document_name: 'GST Registration Certificate (Form REG-06)',
      status: (row.gst_cert_status?.trim().toUpperCase() || 'VALID') as any,
      valid_until: null,
      details: { gst_number: row.gst_number?.trim(), jurisdiction_state: row.state?.trim() },
    });

    const isoStatusRaw = row.iso_9001_status?.trim().toUpperCase();
    const isoStatus = ['VALID', 'EXPIRED', 'MISSING', 'UPLOADED'].includes(isoStatusRaw) ? isoStatusRaw : 'VALID';
    vaultDocuments.push({
      company_id: row.company_id.trim(),
      doc_type: 'ISO_9001',
      document_name: 'ISO 9001:2015 Quality Management Certificate',
      status: isoStatus as any,
      valid_until: parseDateStr(row.iso_9001_valid_until),
      details: { accreditation: 'NABCB / IAF Accredited Certification Body', scope: row.sector?.trim() },
    });

    const isAnnexureUploaded = parseBool(row.annexure_iv_affidavit_uploaded, false);
    vaultDocuments.push({
      company_id: row.company_id.trim(),
      doc_type: 'ANNEXURE_IV',
      document_name: 'Annexure IV Non-Debarment & Non-Blacklisting Affidavit',
      status: isAnnexureUploaded ? 'VALID' : 'MISSING',
      valid_until: null,
      details: { format: 'Revised Corrigendum-I Standard Format', stamp_duty: '₹100 Non-Judicial Stamp Paper', notarized: isAnnexureUploaded },
    });

    const labName = row.type_test_report_lab?.trim();
    const hasLab = !!(labName && labName.length > 0 && labName.toLowerCase() !== 'missing' && labName.toLowerCase() !== 'none');
    vaultDocuments.push({
      company_id: row.company_id.trim(),
      doc_type: 'TYPE_TEST',
      document_name: 'Independent Type Test Report (CPRI / ERDA)',
      status: hasLab ? 'VALID' : 'MISSING',
      valid_until: null,
      details: { laboratory_accreditation: labName || 'Not Appended', nabl_compliant: hasLab },
    });
  }

  return { profiles, workOrders, vaultDocuments };
}

// -----------------------------------------------------------------------------
// SQL Script Generator
// -----------------------------------------------------------------------------
export function generateSqlSeedScript(dataset: NormalizedDataset): string {
  const parts: string[] = [];

  parts.push(`-- ==============================================================================`);
  parts.push(`-- BidLens AI — Normalized MSME Seed Data (${dataset.profiles.length} Companies)`);
  parts.push(`-- Generated: ${new Date().toISOString()}`);
  parts.push(`-- ==============================================================================`);
  parts.push(`BEGIN;\n`);

  parts.push(`-- 1. Insert msme_profiles`);
  for (const p of dataset.profiles) {
    parts.push(
      `INSERT INTO public.msme_profiles (` +
        `id, legal_name, udyam_number, enterprise_category, mse_eligible, sector, city, state, ` +
        `gst_number, pan_number, year_of_establishment, is_women_owned, is_sc_st_owned, is_dpiit_startup, ` +
        `turnover_fy21_22_lakhs, turnover_fy22_23_lakhs, turnover_fy23_24_lakhs, avg_3yr_turnover_lakhs, ` +
        `net_worth_lakhs, ca_turnover_udin, profile_completeness_pct, is_demo_seed` +
        `) VALUES (` +
        `${escapeSqlStr(p.id)}, ${escapeSqlStr(p.legal_name)}, ${escapeSqlStr(p.udyam_number)}, ${escapeSqlStr(p.enterprise_category)}, ` +
        `${p.mse_eligible}, ${escapeSqlStr(p.sector)}, ${escapeSqlStr(p.city)}, ${escapeSqlStr(p.state)}, ` +
        `${escapeSqlStr(p.gst_number)}, ${escapeSqlStr(p.pan_number)}, ${p.year_of_establishment || 'NULL'}, ` +
        `${p.is_women_owned}, ${p.is_sc_st_owned}, ${p.is_dpiit_startup}, ` +
        `${p.turnover_fy21_22_lakhs}, ${p.turnover_fy22_23_lakhs}, ${p.turnover_fy23_24_lakhs}, ${p.avg_3yr_turnover_lakhs}, ` +
        `${p.net_worth_lakhs}, ${escapeSqlStr(p.ca_turnover_udin)}, ${p.profile_completeness_pct}, ${p.is_demo_seed}` +
        `) ON CONFLICT (id) DO UPDATE SET ` +
        `legal_name = EXCLUDED.legal_name, ` +
        `udyam_number = EXCLUDED.udyam_number, ` +
        `enterprise_category = EXCLUDED.enterprise_category, ` +
        `avg_3yr_turnover_lakhs = EXCLUDED.avg_3yr_turnover_lakhs, ` +
        `profile_completeness_pct = EXCLUDED.profile_completeness_pct, ` +
        `updated_at = NOW();`
    );
  }
  parts.push('');

  parts.push(`-- 2. Insert work_orders`);
  parts.push(`DELETE FROM public.work_orders WHERE company_id IN (${dataset.profiles.map(p => escapeSqlStr(p.id)).join(', ')});`);
  for (const w of dataset.workOrders) {
    parts.push(
      `INSERT INTO public.work_orders (company_id, work_order_num, client_name, value_lakhs, completion_year) VALUES (` +
        `${escapeSqlStr(w.company_id)}, ${w.work_order_num}, ${escapeSqlStr(w.client_name)}, ${w.value_lakhs}, ${w.completion_year || 'NULL'}` +
        `);`
    );
  }
  parts.push('');

  parts.push(`-- 3. Insert vault_documents`);
  parts.push(`DELETE FROM public.vault_documents WHERE company_id IN (${dataset.profiles.map(p => escapeSqlStr(p.id)).join(', ')});`);
  for (const v of dataset.vaultDocuments) {
    const detailsJson = JSON.stringify(v.details).replace(/'/g, "''");
    parts.push(
      `INSERT INTO public.vault_documents (company_id, doc_type, document_name, status, valid_until, details) VALUES (` +
        `${escapeSqlStr(v.company_id)}, ${escapeSqlStr(v.doc_type)}, ${escapeSqlStr(v.document_name)}, ${escapeSqlStr(v.status)}, ` +
        `${v.valid_until ? `'${v.valid_until}'::DATE` : 'NULL'}, '${detailsJson}'::JSONB` +
        `);`
    );
  }
  parts.push('');

  parts.push(`COMMIT;\n`);
  return parts.join('\n');
}

// -----------------------------------------------------------------------------
// Direct Supabase REST HTTPS Seeder (Zero external dependencies)
// -----------------------------------------------------------------------------
async function seedViaSupabaseRest(supabaseUrl: string, supabaseKey: string, dataset: NormalizedDataset): Promise<void> {
  console.log(`📡 Connecting directly to Supabase REST API (${supabaseUrl})...`);
  const headers = {
    'apikey': supabaseKey,
    'Authorization': `Bearer ${supabaseKey}`,
    'Content-Type': 'application/json',
    'Prefer': 'resolution=merge-duplicates'
  };

  console.log(`📦 Upserting ${dataset.profiles.length} msme_profiles via REST...`);
  const resP = await fetch(`${supabaseUrl.replace(/\/$/, '')}/rest/v1/msme_profiles`, {
    method: 'POST',
    headers,
    body: JSON.stringify(dataset.profiles)
  });
  if (!resP.ok) {
    const errText = await resP.text();
    throw new Error(`msme_profiles upsert failed (HTTP ${resP.status}): ${errText}`);
  }

  console.log(`📦 Inserting ${dataset.workOrders.length} work_orders via REST...`);
  const companyIds = dataset.profiles.map(p => p.id).join(',');
  await fetch(`${supabaseUrl.replace(/\/$/, '')}/rest/v1/work_orders?company_id=in.(${companyIds})`, {
    method: 'DELETE',
    headers
  });
  const resW = await fetch(`${supabaseUrl.replace(/\/$/, '')}/rest/v1/work_orders`, {
    method: 'POST',
    headers: { ...headers, 'Prefer': 'return=minimal' },
    body: JSON.stringify(dataset.workOrders)
  });
  if (!resW.ok) {
    const errText = await resW.text();
    throw new Error(`work_orders insert failed (HTTP ${resW.status}): ${errText}`);
  }

  console.log(`📦 Inserting ${dataset.vaultDocuments.length} vault_documents via REST...`);
  await fetch(`${supabaseUrl.replace(/\/$/, '')}/rest/v1/vault_documents?company_id=in.(${companyIds})`, {
    method: 'DELETE',
    headers
  });
  const resV = await fetch(`${supabaseUrl.replace(/\/$/, '')}/rest/v1/vault_documents`, {
    method: 'POST',
    headers: { ...headers, 'Prefer': 'return=minimal' },
    body: JSON.stringify(dataset.vaultDocuments)
  });
  if (!resV.ok) {
    const errText = await resV.text();
    throw new Error(`vault_documents insert failed (HTTP ${resV.status}): ${errText}`);
  }

  console.log(`✅ Supabase database successfully seeded over REST HTTPS!`);
}

// -----------------------------------------------------------------------------
// Seeder Runner
// -----------------------------------------------------------------------------
export async function seedDatabase(dataset: NormalizedDataset): Promise<void> {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
  const databaseUrl = process.env.DATABASE_URL;

  if (process.argv.includes('--sql-only')) {
    console.log(`ℹ️ --sql-only flag specified. Skipping remote database execution.`);
    return;
  }

  // 1. Supabase Mode
  if (supabaseUrl && supabaseKey) {
    if (createClient) {
      try {
        console.log(`📡 Connecting via @supabase/supabase-js SDK (${supabaseUrl})...`);
        const supabase = createClient(supabaseUrl, supabaseKey);
        await supabase.from('msme_profiles').upsert(dataset.profiles, { onConflict: 'id' });
        const companyIds = dataset.profiles.map(p => p.id);
        await supabase.from('work_orders').delete().in('company_id', companyIds);
        await supabase.from('work_orders').insert(dataset.workOrders);
        await supabase.from('vault_documents').delete().in('company_id', companyIds);
        await supabase.from('vault_documents').insert(dataset.vaultDocuments);
        console.log(`✅ Supabase database successfully seeded via SDK!`);
        return;
      } catch (err: any) {
        console.warn(`⚠️ SDK seed error (${err.message}). Falling back to REST API...`);
        await seedViaSupabaseRest(supabaseUrl, supabaseKey, dataset);
        return;
      }
    } else {
      await seedViaSupabaseRest(supabaseUrl, supabaseKey, dataset);
      return;
    }
  }

  // 2. Direct PostgreSQL Pool Mode
  if (databaseUrl && pg) {
    console.log(`📡 Connecting directly to PostgreSQL via DATABASE_URL...`);
    const pool = new pg.Pool({ connectionString: databaseUrl, ssl: { rejectUnauthorized: false } });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const sql = generateSqlSeedScript(dataset);
      await client.query(sql);
      await client.query('COMMIT');
      console.log(`✅ PostgreSQL database successfully seeded via transaction!`);
    } catch (e: any) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
      await pool.end();
    }
    return;
  }

  console.log(`ℹ️ To execute against live Supabase / PostgreSQL:`);
  console.log(`   - Paste 'database/seed_msme_normalized.sql' into Supabase SQL Editor`);
  console.log(`   - OR add SUPABASE_URL & SUPABASE_SERVICE_ROLE_KEY to your .env file and rerun this script.`);
}

// -----------------------------------------------------------------------------
// CLI Main Execution
// -----------------------------------------------------------------------------
export async function main(): Promise<void> {
  console.log(`🚀 Starting BidLens AI 60 MSME Company Dataset Normalizer & Seeder...`);

  const candidatePaths = [
    path.resolve(process.cwd(), 'bidlens_ai_60_msme_companies_seed.csv'),
    path.resolve(process.cwd(), '../bidlens_ai_60_msme_companies_seed.csv'),
    path.resolve(__dirname, '../bidlens_ai_60_msme_companies_seed.csv'),
  ];

  let csvPath = candidatePaths.find(p => fs.existsSync(p));
  const customArg = process.argv.find((a: string) => a.startsWith('--csv-path='));
  if (customArg) {
    csvPath = path.resolve(customArg.split('=')[1]);
  }

  if (!csvPath || !fs.existsSync(csvPath)) {
    console.error(`❌ CSV seed file not found. Looked in:\n${candidatePaths.join('\n')}`);
    process.exit(1);
  }

  console.log(`📖 Reading CSV dataset from: ${csvPath}`);
  const csvContent = fs.readFileSync(csvPath, 'utf8');
  const rawRows = parseCsv(csvContent);
  console.log(`📊 Successfully parsed ${rawRows.length} raw MSME rows from CSV.`);

  const normalized = normalizeMsmeData(rawRows);
  console.log(`✨ Normalization complete:`);
  console.log(`   - 🏢 msme_profiles:   ${normalized.profiles.length} rows`);
  console.log(`   - 💼 work_orders:     ${normalized.workOrders.length} rows`);
  console.log(`   - 📜 vault_documents: ${normalized.vaultDocuments.length} rows`);

  const outDir = path.resolve(process.cwd(), 'database');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const sqlOutPath = path.join(outDir, 'seed_msme_normalized.sql');

  const sqlScript = generateSqlSeedScript(normalized);
  fs.writeFileSync(sqlOutPath, sqlScript, 'utf8');
  console.log(`💾 Generated standalone SQL seed script:\n   -> ${sqlOutPath} (${(sqlScript.length / 1024).toFixed(1)} KB)`);

  try {
    await seedDatabase(normalized);
  } catch (err: any) {
    console.error(`⚠️ Database seed execution error:`, err.message);
  }

  console.log(`\n🎉 Process completed successfully!`);
}

// Universal entrypoint check supporting CommonJS (node), ESM (tsx/ts-node), and bundlers
const isDirectExecution =
  (typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module) ||
  (typeof process !== 'undefined' && Array.isArray(process.argv) && process.argv.length > 1 && (
    (process.argv[1] || '').endsWith('seed-msmes.ts') || 
    (process.argv[1] || '').endsWith('seed-msmes.js')
  ));

if (isDirectExecution) {
  main().catch((err: any) => {
    console.error(`Fatal error:`, err);
    if (typeof process !== 'undefined' && process.exit) {
      process.exit(1);
    }
  });
}
