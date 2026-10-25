-- ==============================================================================
-- BidLens AI — PostgreSQL / Supabase Normalized Schema Migration
-- Normalization: Flat 38-column MSME CSV -> msme_profiles, work_orders, vault_documents
-- ==============================================================================

-- Enable UUID extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ------------------------------------------------------------------------------
-- 1. Table: msme_profiles
-- Represents normalized vendor company identity, demographics, and 3-yr financials
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.msme_profiles (
    id TEXT PRIMARY KEY, -- e.g., 'COMP-001', matching company_id
    legal_name TEXT NOT NULL,
    udyam_number TEXT NOT NULL UNIQUE,
    enterprise_category TEXT NOT NULL CHECK (enterprise_category IN ('Micro', 'Small', 'Medium')),
    mse_eligible BOOLEAN NOT NULL DEFAULT TRUE,
    sector TEXT NOT NULL,
    city TEXT NOT NULL,
    state TEXT NOT NULL,
    gst_number TEXT,
    pan_number TEXT,
    year_of_establishment INT CHECK (year_of_establishment >= 1900 AND year_of_establishment <= EXTRACT(YEAR FROM NOW())),
    
    -- Demographics & Startup Flags (Public Procurement Policy Order 2012 / GFR Rule 153)
    is_women_owned BOOLEAN NOT NULL DEFAULT FALSE,
    is_sc_st_owned BOOLEAN NOT NULL DEFAULT FALSE,
    is_dpiit_startup BOOLEAN NOT NULL DEFAULT FALSE,
    
    -- 3-Year Audited Financials (INR in Lakhs)
    turnover_fy21_22_lakhs NUMERIC(12, 2) DEFAULT 0.00,
    turnover_fy22_23_lakhs NUMERIC(12, 2) DEFAULT 0.00,
    turnover_fy23_24_lakhs NUMERIC(12, 2) DEFAULT 0.00,
    avg_3yr_turnover_lakhs NUMERIC(12, 2) DEFAULT 0.00,
    net_worth_lakhs NUMERIC(12, 2) DEFAULT 0.00,
    ca_turnover_udin TEXT, -- Unique Document Identification Number from Chartered Accountant
    
    -- Readiness & Metadata
    profile_completeness_pct INT NOT NULL DEFAULT 0 CHECK (profile_completeness_pct >= 0 AND profile_completeness_pct <= 100),
    is_demo_seed BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for msme_profiles
CREATE INDEX IF NOT EXISTS idx_msme_profiles_sector ON public.msme_profiles(sector);
CREATE INDEX IF NOT EXISTS idx_msme_profiles_location ON public.msme_profiles(state, city);
CREATE INDEX IF NOT EXISTS idx_msme_profiles_category ON public.msme_profiles(enterprise_category);
CREATE INDEX IF NOT EXISTS idx_msme_profiles_avg_turnover ON public.msme_profiles(avg_3yr_turnover_lakhs);
CREATE INDEX IF NOT EXISTS idx_msme_profiles_demo_seed ON public.msme_profiles(is_demo_seed);

-- ------------------------------------------------------------------------------
-- 2. Table: work_orders
-- Normalized 1:N relationship for past performance and similar work experience
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.work_orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id TEXT NOT NULL REFERENCES public.msme_profiles(id) ON DELETE CASCADE,
    work_order_num INT NOT NULL CHECK (work_order_num BETWEEN 1 AND 10),
    client_name TEXT NOT NULL,
    value_lakhs NUMERIC(10, 2) NOT NULL CHECK (value_lakhs >= 0),
    completion_year INT CHECK (completion_year >= 1990 AND completion_year <= EXTRACT(YEAR FROM NOW()) + 1),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for work_orders
CREATE INDEX IF NOT EXISTS idx_work_orders_company_id ON public.work_orders(company_id);
CREATE INDEX IF NOT EXISTS idx_work_orders_value ON public.work_orders(value_lakhs DESC);
CREATE INDEX IF NOT EXISTS idx_work_orders_year ON public.work_orders(completion_year);

-- ------------------------------------------------------------------------------
-- 3. Table: vault_documents
-- Normalized 1:N relationship for regulatory credentials and compliance evidence
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.vault_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id TEXT NOT NULL REFERENCES public.msme_profiles(id) ON DELETE CASCADE,
    doc_type TEXT NOT NULL CHECK (doc_type IN ('UDYAM', 'GST', 'ISO_9001', 'ANNEXURE_IV', 'TYPE_TEST', 'BALANCE_SHEET', 'NET_WORTH', 'PAN')),
    document_name TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('VALID', 'EXPIRED', 'MISSING', 'UPLOADED', 'PENDING_VERIFICATION')),
    valid_until DATE, -- Nullable (e.g., ISO certificate expiration date)
    details JSONB NOT NULL DEFAULT '{}'::jsonb, -- e.g. {"lab_name": "ERDA Vadodara", "ca_udin": "..."}
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for vault_documents
CREATE INDEX IF NOT EXISTS idx_vault_documents_company_id ON public.vault_documents(company_id);
CREATE INDEX IF NOT EXISTS idx_vault_documents_type_status ON public.vault_documents(doc_type, status);
CREATE INDEX IF NOT EXISTS idx_vault_documents_valid_until ON public.vault_documents(valid_until);

-- ------------------------------------------------------------------------------
-- 4. Enable Supabase Row Level Security (RLS) & Standard Read Policies
-- ------------------------------------------------------------------------------
ALTER TABLE public.msme_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vault_documents ENABLE ROW LEVEL SECURITY;

-- Allow public read access to demo seed data
CREATE POLICY "Allow public read access to msme_profiles" 
    ON public.msme_profiles FOR SELECT 
    USING (true);

CREATE POLICY "Allow public read access to work_orders" 
    ON public.work_orders FOR SELECT 
    USING (true);

CREATE POLICY "Allow public read access to vault_documents" 
    ON public.vault_documents FOR SELECT 
    USING (true);

-- Allow service role full access for seeding and administration
CREATE POLICY "Allow service role full access on msme_profiles" 
    ON public.msme_profiles FOR ALL 
    USING (auth.jwt() ->> 'role' = 'service_role' OR current_user = 'postgres');

CREATE POLICY "Allow service role full access on work_orders" 
    ON public.work_orders FOR ALL 
    USING (auth.jwt() ->> 'role' = 'service_role' OR current_user = 'postgres');

CREATE POLICY "Allow service role full access on vault_documents" 
    ON public.vault_documents FOR ALL 
    USING (auth.jwt() ->> 'role' = 'service_role' OR current_user = 'postgres');
