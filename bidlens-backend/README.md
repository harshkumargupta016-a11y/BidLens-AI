# BidLens AI - Python (FastAPI) Backend

Production-ready asynchronous Python backend for **BidLens AI**, integrated with **Supabase PostgreSQL** and **Google Gemini AI**. Designed for zero-configuration local runs and instant 1-click deployments on **PyHost**, **Render**, **Railway**, and **Heroku**.

---

## 🏛️ Architecture & Highlights

- **FastAPI (ASGI)**: High-performance asynchronous REST endpoints with automated OpenAPI (`/docs` & `/redoc`).
- **Official Supabase Client (`supabase-py`)**: Seamless integration with normalized PostgreSQL tables (`msme_profiles`, `work_orders`, `vault_documents`, `tenders`, `bids`, `complaints`).
- **Zero-Config Resilient Fallback**: Automatically serves local seed dataset from `bidlens_ai_60_msme_companies_seed.csv` and realistic tender data when Supabase is not yet configured or during initial boot.
- **Gemini 5-Pillar Evaluation Engine**:
  1. *Technical Competence* (weight 0.25)
  2. *Financial Solvency* (weight 0.20)
  3. *Past Performance* (weight 0.20)
  4. *Compliance & Vault* (weight 0.20)
  5. *MSE Policy Advantage under GFR 153* (weight 0.15)
- **Spatial Geo-Search**: Haversine distance algorithm calculating proximity to public tenders for MSMEs ("Tenders Near Me").
- **1-Click Statutory Bidding**: Instant lodgement with automated MSE statutory EMD waiver under GFR Rule 153 and mock payment verification.
- **GFR 153 Grievance Desk**: Allows MSMEs to file complaints against restrictive turnover clauses or discriminatory specifications, with Admin status updates.

---

## 📂 Project Structure

```text
bidlens-backend/
├── main.py                  # FastAPI application entrypoint, CORS & error handling
├── database.py              # Supabase client provider & connection health checks
├── config.py                # Pydantic Settings v2 environment configuration
├── schemas.py               # Pydantic models for validation and serialization
├── requirements.txt         # Production-locked Python dependencies
├── Procfile                 # Production process file for Railway / Render
├── runtime.txt              # Python runtime version (python-3.11)
├── .env.example             # Template environment variables
└── routers/
    ├── auth.py              # MSME Profiles & role management (Bidder vs Admin)
    ├── tenders.py           # Tender CRUD, parametric filters & "Tenders Near Me"
    ├── bids.py              # 1-Click Bid submission & Mock Payment verification
    ├── complaints.py        # Grievance registration & administrative workflow
    └── ai_score.py          # Gemini 5-Pillar tender evaluation engine
```

---

## 🚀 Quickstart & Local Setup

### 1. Create Virtual Environment & Install Dependencies

```bash
cd bidlens-backend
python -m venv venv

# On Linux / macOS:
source venv/bin/activate

# On Windows (PowerShell):
.\venv\Scripts\Activate.ps1

pip install -r requirements.txt
```

### 2. Configure Environment Variables

Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```
Fill in your keys:
- `SUPABASE_URL`: Your Supabase Project URL (`https://xyzcompany.supabase.co`)
- `SUPABASE_KEY`: Your Supabase `anon` or `service_role` key
- `GEMINI_API_KEY`: Your Google Gemini API key

*(Note: If you run without keys, BidLens AI will automatically activate its internal deterministic rule engine and fallback MSME dataset!)*

### 3. Run the Backend

```bash
uvicorn main:app --reload --port 8000
```
Open **[http://localhost:8000/docs](http://localhost:8000/docs)** to explore and test the interactive Swagger API documentation.

---

## 🌐 API Route Directory

| Method | Endpoint | Description | Role / Auth |
|---|---|---|---|
| `GET` | `/health` | Complete system health & Supabase connectivity check | Public |
| `POST` | `/api/auth/register` | Register Bidder or Government Authority user | Public |
| `POST` | `/api/auth/login` | Login and obtain scoped bearer token | Public |
| `GET` | `/api/auth/msmes` | List registered MSME companies with filters | Public |
| `GET` | `/api/auth/msmes/{id}` | Normalized company profile with work orders & vault | Public |
| `GET` | `/api/tenders` | Search & filter active public tenders | Public |
| `GET` | `/api/tenders/{id}` | Detailed procurement specifications | Public |
| `POST` | `/api/tenders` | Publish new public tender | Admin only |
| `POST` | `/api/tenders/near-me` | Haversine spatial radius search | Public |
| `POST` | `/api/bids/submit` | 1-Click MSE Bid submission | Bidder |
| `POST` | `/api/bids/verify-payment`| Mock EMD fee & waiver receipt generator | Bidder |
| `GET` | `/api/bids/my-bids` | View lodged bids for company | Bidder |
| `POST` | `/api/complaints` | File GFR 153 tender dispute or grievance | Bidder |
| `GET` | `/api/complaints` | List active grievances with filters | Public |
| `PATCH`| `/api/complaints/{id}/status` | Admin updates status (`Resolved`, `Investigation`) | Admin only |
| `POST` | `/api/ai-score/evaluate` | Run Gemini 5-Pillar tender feasibility analysis | Public |

---

## ☁️ Deployment Guide

### Deploy to Render / Railway / PyHost
1. Push this repository to GitHub.
2. In your cloud provider dashboard, select **Deploy from GitHub repo**.
3. Set **Root Directory** to `bidlens-backend` (or deploy from repository root with `Procfile`).
4. Set Build Command: `pip install -r requirements.txt`.
5. Set Start Command: `uvicorn main:app --host 0.0.0.0 --port $PORT`.
6. Add environment variables (`SUPABASE_URL`, `SUPABASE_KEY`, `GEMINI_API_KEY`).
