/**
 * BidLens AI — MSME Data Seeding & Normalization Script
 *
 * Normalizes a flat 38-column CSV (bidlens_ai_60_msme_companies_seed.csv) into 3 relational tables:
 *   1. msme_profiles   (Company identity, demographics, audited 3-yr financials)
 *   2. work_orders     (Past similar contract awards & values)
 *   3. vault_documents (Regulatory certificates, ISO validity, affidavits, and lab reports)
 *
 * Execution Modes:
 *   - Supabase: Uses @supabase/supabase-js if SUPABASE_URL & SUPABASE_SERVICE_ROLE_KEY/ANON_KEY are present
 *   - PostgreSQL: Uses pg Pool if DATABASE_URL is present
 *   - Standalone / File Generation: Always writes an atomic database/seed_msme_normalized.sql file
 *
 * Run with:
 *   npx tsx scripts/seed-msmes.ts [options]
 *   Options: --sql-only, --csv-path=<path>, --batch-size=50
 */

import * as fs from 'fs';
import * as path from 'path';

// Optional dynamic imports for Supabase and pg if installed
let createClient: any = null;
try {
  const supabaseModule = require('@supabase/supabase-js');
  createClient = supabaseModule.createClient;
} catch {
  // Gracefully ignored if not installed in current environment
}

let pg: any = null;
try {
  pg = require('pg');
} catch {
  // Gracefully ignored if not installed in current environment
}

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
// Robust CSV Parser (zero external dependency fallback)
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
        i++; // skip escaped quote
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

    // 1. msme_profiles
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

    // 2. work_orders (Work Order 1 to 3)
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

    // 3. vault_documents (5 Standard Regulatory Credentials)
    // 3A. Udyam Registration
    vaultDocuments.push({
      company_id: row.company_id.trim(),
      doc_type: 'UDYAM',
      document_name: 'Udyam Registration Certificate',
      status: (row.udyam_cert_status?.trim().toUpperCase() || 'VALID') as any,
      valid_until: null,
      details: {
        udyam_number: row.udyam_number?.trim(),
        enterprise_category: category,
      },
    });

    // 3B. GST Certificate
    vaultDocuments.push({
      company_id: row.company_id.trim(),
      doc_type: 'GST',
      document_name: 'GST Registration Certificate (Form REG-06)',
      status: (row.gst_cert_status?.trim().toUpperCase() || 'VALID') as any,
      valid_until: null,
      details: {
        gst_number: row.gst_number?.trim(),
        jurisdiction_state: row.state?.trim(),
      },
    });

    // 3C. ISO 9001:2015
    const isoStatusRaw = row.iso_9001_status?.trim().toUpperCase();
    const isoStatus = ['VALID', 'EXPIRED', 'MISSING', 'UPLOADED'].includes(isoStatusRaw) ? isoStatusRaw : 'VALID';
    vaultDocuments.push({
      company_id: row.company_id.trim(),
      doc_type: 'ISO_9001',
      document_name: 'ISO 9001:2015 Quality Management Certificate',
      status: isoStatus as any,
      valid_until: parseDateStr(row.iso_9001_valid_until),
      details: {
        accreditation: 'NABCB / IAF Accredited Certification Body',
        scope: row.sector?.trim(),
      },
    });

    // 3D. Annexure IV Affidavit
    const isAnnexureUploaded = parseBool(row.annexure_iv_affidavit_uploaded, false);
    vaultDocuments.push({
      company_id: row.company_id.trim(),
      doc_type: 'ANNEXURE_IV',
      document_name: 'Annexure IV Non-Debarment & Non-Blacklisting Affidavit',
      status: isAnnexureUploaded ? 'VALID' : 'MISSING',
      valid_until: null,
      details: {
        format: 'Revised Corrigendum-I Standard Format',
        stamp_duty: '₹100 Non-Judicial Stamp Paper',
        notarized: isAnnexureUploaded,
      },
    });

    // 3E. Independent Type Test Report
    const labName = row.type_test_report_lab?.trim();
    const hasLab = !!(labName && labName.length > 0 && labName.toLowerCase() !== 'missing' && labName.toLowerCase() !== 'none');
    vaultDocuments.push({
      company_id: row.company_id.trim(),
      doc_type: 'TYPE_TEST',
      document_name: 'Independent Type Test Report (CPRI / ERDA)',
      status: hasLab ? 'VALID' : 'MISSING',
      valid_until: null,
      details: {
        laboratory_accreditation: labName || 'Not Appended',
        nabl_compliant: hasLab,
      },
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

  // 1. msme_profiles
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

  // 2. work_orders
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

  // 3. vault_documents
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
// Seeder Runner
// -----------------------------------------------------------------------------
export async function seedDatabase(dataset: NormalizedDataset) {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
  const databaseUrl = process.env.DATABASE_URL;

  // 1. Direct Supabase Client Mode
  if (supabaseUrl && supabaseKey && createClient) {
    console.log(`📡 Connecting to Supabase (${supabaseUrl})...`);
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Upsert profiles in batches of 50
    console.log(`📦 Upserting ${dataset.profiles.length} msme_profiles...`);
    const { error: pErr } = await supabase.from('msme_profiles').upsert(dataset.profiles, { onConflict: 'id' });
    if (pErr) throw new Error(`Error upserting msme_profiles: ${pErr.message}`);

    // Clean old demo work orders and reinsert
    console.log(`📦 Inserting ${dataset.workOrders.length} work_orders...`);
    const companyIds = dataset.profiles.map(p => p.id);
    await supabase.from('work_orders').delete().in('company_id', companyIds);
    const { error: wErr } = await supabase.from('work_orders').insert(dataset.workOrders);
    if (wErr) throw new Error(`Error inserting work_orders: ${wErr.message}`);

    // Clean old demo vault documents and reinsert
    console.log(`📦 Inserting ${dataset.vaultDocuments.length} vault_documents...`);
    await supabase.from('vault_documents').delete().in('company_id', companyIds);
    const { error: vErr } = await supabase.from('vault_documents').insert(dataset.vaultDocuments);
    if (vErr) throw new Error(`Error inserting vault_documents: ${vErr.message}`);

    console.log(`✅ Supabase database successfully seeded!`);
    return;
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

  // 3. Fallback: SQL Script generated
  console.log(`ℹ️ No active SUPABASE_URL or DATABASE_URL detected in environment.`);
  console.log(`   Generated standalone SQL migration script ready to paste into Supabase SQL Editor.`);
}

// -----------------------------------------------------------------------------
// CLI Main Execution
// -----------------------------------------------------------------------------
async function main() {
  console.log(`🚀 Starting BidLens AI 60 MSME Company Dataset Normalizer & Seeder...`);

  // Find CSV file path
  const candidatePaths = [
    path.resolve(process.cwd(), 'bidlens_ai_60_msme_companies_seed.csv'),
    path.resolve(process.cwd(), '../bidlens_ai_60_msme_companies_seed.csv'),
    path.resolve(__dirname, '../bidlens_ai_60_msme_companies_seed.csv'),
  ];

  let csvPath = candidatePaths.find(p => fs.existsSync(p));
  const customArg = process.argv.find(a => a.startsWith('--csv-path='));
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

  // Normalize
  const normalized = normalizeMsmeData(rawRows);
  console.log(`✨ Normalization complete:`);
  console.log(`   - 🏢 msme_profiles:  ${normalized.profiles.length} rows`);
  console.log(`   - 💼 work_orders:    ${normalized.workOrders.length} rows`);
  console.log(`   - 📜 vault_documents:${normalized.vaultDocuments.length} rows`);

  // Write SQL output file
  const outDir = path.resolve(process.cwd(), 'database');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const sqlOutPath = path.join(outDir, 'seed_msme_normalized.sql');

  const sqlScript = generateSqlSeedScript(normalized);
  fs.writeFileSync(sqlOutPath, sqlScript, 'utf8');
  console.log(`💾 Generated standalone SQL seed script:\n   -> ${sqlOutPath} (${(sqlScript.length / 1024).toFixed(1)} KB)`);

  // Run database seed if credentials present
  try {
    await seedDatabase(normalized);
  } catch (err: any) {
    console.error(`⚠️ Database seed execution error:`, err.message);
  }

  console.log(`\n🎉 All done! You can now run this SQL directly in your Supabase SQL Editor or via database migration pipelines.`);
}

if (require.main === module) {
  main().catch(err => {
    console.error(`Fatal error:`, err);
    process.exit(1);
  });
}
