/**
 * BidLens AI — MSME Data Seeding & Normalization Script (Node.js Executable)
 *
 * Normalizes flat 38-column CSV (bidlens_ai_60_msme_companies_seed.csv) into 3 relational tables:
 *   1. msme_profiles   (Company identity, demographics, audited 3-yr financials)
 *   2. work_orders     (Past similar contract awards & values)
 *   3. vault_documents (Regulatory certificates, ISO validity, affidavits, and lab reports)
 *
 * Usage:
 *   node scripts/seed-msmes.js
 */

const fs = require('fs');
const path = require('path');

// Optional dynamic imports
let createClient = null;
try {
  const supabaseModule = require('@supabase/supabase-js');
  createClient = supabaseModule.createClient;
} catch {}

let pg = null;
try {
  pg = require('pg');
} catch {}

function parseBool(val, fallback = false) {
  if (val === undefined || val === null) return fallback;
  const s = String(val).trim().toLowerCase();
  if (s === 'true' || s === '1' || s === 'yes') return true;
  if (s === 'false' || s === '0' || s === 'no') return false;
  return fallback;
}

function parseNum(val, fallback = 0.0) {
  if (!val) return fallback;
  const n = parseFloat(String(val).replace(/[^0-9.-]/g, ''));
  return isNaN(n) ? fallback : n;
}

function parseIntNum(val, fallback = null) {
  if (!val) return fallback;
  const n = parseInt(String(val).replace(/[^0-9-]/g, ''), 10);
  return isNaN(n) ? fallback : n;
}

function parseDateStr(val) {
  if (!val || typeof val !== 'string') return null;
  const trimmed = val.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const d = new Date(trimmed);
  if (!isNaN(d.getTime())) {
    return d.toISOString().split('T')[0];
  }
  return null;
}

function escapeSqlStr(val) {
  if (val === null || val === undefined) return 'NULL';
  return `'${String(val).replace(/'/g, "''")}'`;
}

function parseCsvLine(line) {
  const result = [];
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

function parseCsv(csvContent) {
  const lines = csvContent.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  if (lines.length < 2) return [];

  const headers = parseCsvLine(lines[0]);
  const rows = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const values = parseCsvLine(line);
    const rowObj = {};
    for (let h = 0; h < headers.length; h++) {
      rowObj[headers[h]] = values[h] !== undefined ? values[h].trim() : '';
    }
    rows.push(rowObj);
  }

  return rows;
}

function normalizeMsmeData(rows) {
  const profiles = [];
  const workOrders = [];
  const vaultDocuments = [];

  for (const row of rows) {
    if (!row.company_id || !row.legal_name) continue;

    const categoryRaw = row.enterprise_category?.trim() || 'Small';
    const category = ['Micro', 'Small', 'Medium'].includes(categoryRaw) ? categoryRaw : 'Small';

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

    // Work Orders 1 to 3
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

    // Vault Documents
    vaultDocuments.push({
      company_id: row.company_id.trim(),
      doc_type: 'UDYAM',
      document_name: 'Udyam Registration Certificate',
      status: (row.udyam_cert_status?.trim().toUpperCase() || 'VALID'),
      valid_until: null,
      details: { udyam_number: row.udyam_number?.trim(), enterprise_category: category },
    });

    vaultDocuments.push({
      company_id: row.company_id.trim(),
      doc_type: 'GST',
      document_name: 'GST Registration Certificate (Form REG-06)',
      status: (row.gst_cert_status?.trim().toUpperCase() || 'VALID'),
      valid_until: null,
      details: { gst_number: row.gst_number?.trim(), jurisdiction_state: row.state?.trim() },
    });

    const isoStatusRaw = row.iso_9001_status?.trim().toUpperCase();
    const isoStatus = ['VALID', 'EXPIRED', 'MISSING', 'UPLOADED'].includes(isoStatusRaw) ? isoStatusRaw : 'VALID';
    vaultDocuments.push({
      company_id: row.company_id.trim(),
      doc_type: 'ISO_9001',
      document_name: 'ISO 9001:2015 Quality Management Certificate',
      status: isoStatus,
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

function generateSqlSeedScript(dataset) {
  const parts = [];

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

async function main() {
  console.log(`🚀 Starting BidLens AI 60 MSME Company Dataset Normalizer & Seeder...`);

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

  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
  const databaseUrl = process.env.DATABASE_URL;

  if (supabaseUrl && supabaseKey && createClient) {
    console.log(`📡 Connecting to Supabase (${supabaseUrl})...`);
    const supabase = createClient(supabaseUrl, supabaseKey);
    const { error: pErr } = await supabase.from('msme_profiles').upsert(normalized.profiles, { onConflict: 'id' });
    if (pErr) console.error(`⚠️ Supabase profiles upsert error:`, pErr.message);

    const companyIds = normalized.profiles.map(p => p.id);
    await supabase.from('work_orders').delete().in('company_id', companyIds);
    await supabase.from('work_orders').insert(normalized.workOrders);

    await supabase.from('vault_documents').delete().in('company_id', companyIds);
    await supabase.from('vault_documents').insert(normalized.vaultDocuments);
    console.log(`✅ Supabase database successfully seeded!`);
  } else if (databaseUrl && pg) {
    console.log(`📡 Connecting directly to PostgreSQL via DATABASE_URL...`);
    const pool = new pg.Pool({ connectionString: databaseUrl, ssl: { rejectUnauthorized: false } });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sqlScript);
      await client.query('COMMIT');
      console.log(`✅ PostgreSQL database successfully seeded via transaction!`);
    } catch (e) {
      await client.query('ROLLBACK');
      console.error(`⚠️ PostgreSQL seed error:`, e.message);
    } finally {
      client.release();
      await pool.end();
    }
  } else {
    console.log(`ℹ️ To execute against live Supabase / PostgreSQL:`);
    console.log(`   - Run in Supabase SQL Editor: Paste 'database/seed_msme_normalized.sql'`);
    console.log(`   - OR provide SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env and run this script.`);
  }

  console.log(`\n🎉 Process completed successfully!`);
}

if (require.main === module) {
  main().catch(err => {
    console.error(`Fatal error:`, err);
    process.exit(1);
  });
}

module.exports = { parseCsv, normalizeMsmeData, generateSqlSeedScript };
