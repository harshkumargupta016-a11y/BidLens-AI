"""
BidLens AI Authentication & Profile Router.
Manages user authentication, role verification (Bidder vs Admin), and MSME company profiles.
"""

from typing import List, Optional
import os
import csv
import logging
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, status, Query, Header
from database import get_supabase
from schemas import (
    LoginRequest,
    RegisterRequest,
    AuthResponse,
    UserRole,
    MSMEProfileResponse,
    MSMEProfileDetailResponse,
    WorkOrderSchema,
    VaultDocumentSchema,
    DocumentStatus,
)

logger = logging.getLogger("bidlens.routers.auth")
router = APIRouter(prefix="/api/auth", tags=["Authentication & MSME Profiles"])

# Path to the CSV seed file for zero-config fallback
CSV_PATH = os.path.join(os.path.dirname(__file__), "..", "..", "bidlens_ai_60_msme_companies_seed.csv")


def load_fallback_csv_companies() -> List[dict]:
    """Parse local CSV if Supabase is unconfigured or empty."""
    resolved_path = os.path.abspath(CSV_PATH)
    if not os.path.exists(resolved_path):
        # Alternative path relative to backend dir
        alt_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "bidlens_ai_60_msme_companies_seed.csv"))
        if os.path.exists(alt_path):
            resolved_path = alt_path
        else:
            return []

    companies = []
    try:
        with open(resolved_path, mode="r", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            for row in reader:
                companies.append(row)
    except Exception as e:
        logger.error(f"Error loading CSV fallback: {e}")
    return companies


# In-memory session token store for simple lightweight auth
ACTIVE_SESSIONS = {
    "admin-token-bidlens-2026": {
        "user_id": "usr-admin-gov-01",
        "email": "director.procurement@msme.gov.in",
        "role": UserRole.ADMIN,
        "full_name": "Shri Rajiv Ranjan (IAS)",
        "designation": "Director General of Public Procurement",
    },
    "bidder-token-bidlens-2026": {
        "user_id": "usr-msme-01",
        "email": "contact@apexinfotech.in",
        "role": UserRole.BIDDER,
        "company_id": "COMP-001",
        "full_name": "Rajesh Sharma",
        "designation": "Managing Director",
    },
}


def get_current_user(authorization: Optional[str] = Header(None)) -> dict:
    """Dependency to extract user identity from Bearer token."""
    if not authorization:
        # Default anonymous bidder identity for seamless dev/testing
        return {
            "user_id": "usr-anon-bidder",
            "email": "guest.bidder@bidlens.ai",
            "role": UserRole.BIDDER,
            "company_id": "COMP-001",
            "full_name": "Demo MSME Bidder",
        }

    token = authorization.replace("Bearer ", "").strip()
    if token in ACTIVE_SESSIONS:
        return ACTIVE_SESSIONS[token]

    # Return decoded token payload or raise 401 if strict validation
    return {
        "user_id": f"usr-{token[:8]}",
        "email": "user@bidlens.ai",
        "role": UserRole.BIDDER,
        "company_id": "COMP-001",
        "full_name": "BidLens Registered User",
    }


def require_admin(user: dict = Depends(get_current_user)) -> dict:
    """Dependency requiring Government Authority / Admin privileges."""
    if user.get("role") != UserRole.ADMIN:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Administrative privileges required to access this authority endpoint.",
        )
    return user


@router.post("/register", response_model=AuthResponse, status_code=status.HTTP_201_CREATED)
async def register_user(payload: RegisterRequest):
    """
    Register a new MSME Bidder or Government Authority Admin user.
    """
    token = f"token-{payload.role.value}-{int(datetime.utcnow().timestamp())}"
    user_id = f"usr-{int(datetime.utcnow().timestamp())}"

    ACTIVE_SESSIONS[token] = {
        "user_id": user_id,
        "email": payload.email,
        "role": payload.role,
        "company_id": payload.company_id,
        "full_name": payload.full_name,
        "designation": payload.designation,
    }

    return AuthResponse(
        access_token=token,
        token_type="bearer",
        role=payload.role,
        user_id=user_id,
        email=payload.email,
        company_id=payload.company_id,
        full_name=payload.full_name,
    )


@router.post("/login", response_model=AuthResponse)
async def login_user(payload: LoginRequest):
    """
    Authenticate user and return role-scoped access token.
    Supports both MSME Bidders and Government Admin Officers.
    """
    # Demo credentials handling
    if payload.role == UserRole.ADMIN:
        token = "admin-token-bidlens-2026"
        return AuthResponse(
            access_token=token,
            token_type="bearer",
            role=UserRole.ADMIN,
            user_id="usr-admin-gov-01",
            email=payload.email or "director.procurement@msme.gov.in",
            company_id=None,
            full_name="Shri Rajiv Ranjan (IAS)",
        )
    else:
        company_id = payload.company_id or "COMP-001"
        token = "bidder-token-bidlens-2026"
        return AuthResponse(
            access_token=token,
            token_type="bearer",
            role=UserRole.BIDDER,
            user_id="usr-msme-01",
            email=payload.email or "contact@apexinfotech.in",
            company_id=company_id,
            full_name="Rajesh Sharma (Apex InfoTech)",
        )


@router.get("/me", response_model=dict)
async def get_current_profile(user: dict = Depends(get_current_user)):
    """
    Retrieve profile details for the currently authenticated session.
    """
    return user


@router.get("/msmes", response_model=List[MSMEProfileResponse])
async def list_msme_companies(
    sector: Optional[str] = Query(None, description="Filter by industrial sector"),
    state: Optional[str] = Query(None, description="Filter by Indian State"),
    search: Optional[str] = Query(None, description="Search company name or Udyam number"),
    limit: int = Query(60, ge=1, le=100),
    offset: int = Query(0, ge=0),
):
    """
    List registered MSME enterprises.
    Fetches from Supabase msme_profiles table with automatic fallback to seed CSV.
    """
    client = get_supabase()
    if client:
        try:
            query = client.table("msme_profiles").select("*")
            if sector:
                query = query.ilike("sector", f"%{sector}%")
            if state:
                query = query.ilike("state", f"%{state}%")
            if search:
                query = query.or_(f"legal_name.ilike.%{search}%,udyam_number.ilike.%{search}%")
            
            res = query.range(offset, offset + limit - 1).execute()
            if res.data and len(res.data) > 0:
                return [MSMEProfileResponse(**row) for row in res.data]
        except Exception as e:
            logger.warning(f"Supabase query failed, falling back to CSV: {e}")

    # Fallback to local 60 MSME CSV
    csv_rows = load_fallback_csv_companies()
    results = []
    for r in csv_rows:
        if sector and sector.lower() not in r.get("sector", "").lower():
            continue
        if state and state.lower() not in r.get("state", "").lower():
            continue
        if search:
            s_low = search.lower()
            if s_low not in r.get("legal_name", "").lower() and s_low not in r.get("udyam_number", "").lower():
                continue

        profile = MSMEProfileResponse(
            id=r.get("company_id", "COMP-UNKNOWN"),
            legal_name=r.get("legal_name", ""),
            udyam_number=r.get("udyam_number"),
            enterprise_category=r.get("enterprise_category"),
            mse_eligible=r.get("mse_eligible", "").lower() == "true",
            sector=r.get("sector"),
            city=r.get("city"),
            state=r.get("state"),
            gst_number=r.get("gst_number"),
            pan_number=r.get("pan_number"),
            year_of_establishment=int(r.get("year_of_establishment", 2018)) if r.get("year_of_establishment") else 2018,
            is_women_owned=r.get("is_women_owned", "").lower() == "true",
            is_sc_st_owned=r.get("is_sc_st_owned", "").lower() == "true",
            is_dpiit_startup=r.get("is_dpiit_startup", "").lower() == "true",
            turnover_fy21_22_lakhs=float(r.get("turnover_fy21_22_lakhs") or 0.0),
            turnover_fy22_23_lakhs=float(r.get("turnover_fy22_23_lakhs") or 0.0),
            turnover_fy23_24_lakhs=float(r.get("turnover_fy23_24_lakhs") or 0.0),
            avg_3yr_turnover_lakhs=float(r.get("avg_3yr_turnover_lakhs") or 0.0),
            net_worth_lakhs=float(r.get("net_worth_lakhs") or 0.0),
            ca_turnover_udin=r.get("ca_turnover_udin"),
            profile_completeness_pct=int(r.get("profile_completeness_pct") or 85),
            created_at=datetime.utcnow(),
        )
        results.append(profile)

    return results[offset : offset + limit]


@router.get("/msmes/{company_id}", response_model=MSMEProfileDetailResponse)
async def get_msme_company_detail(company_id: str):
    """
    Retrieve normalized MSME company profile with work orders and vault documents.
    """
    client = get_supabase()
    if client:
        try:
            profile_res = client.table("msme_profiles").select("*").eq("id", company_id).execute()
            if profile_res.data and len(profile_res.data) > 0:
                p_data = profile_res.data[0]
                wo_res = client.table("work_orders").select("*").eq("company_id", company_id).execute()
                vault_res = client.table("vault_documents").select("*").eq("company_id", company_id).execute()

                work_orders = [
                    WorkOrderSchema(
                        id=w.get("id"),
                        work_order_num=w.get("work_order_num", 1),
                        client_name=w.get("client_name"),
                        value_lakhs=float(w.get("value_lakhs", 0.0)),
                        completion_year=w.get("completion_year"),
                    )
                    for w in (wo_res.data or [])
                ]

                vault_documents = [
                    VaultDocumentSchema(
                        id=v.get("id"),
                        doc_type=v.get("doc_type"),
                        document_name=v.get("document_name"),
                        status=DocumentStatus(v.get("status", "VALID")),
                        valid_until=v.get("valid_until"),
                        details=v.get("details"),
                    )
                    for v in (vault_res.data or [])
                ]

                return MSMEProfileDetailResponse(
                    **p_data,
                    work_orders=work_orders,
                    vault_documents=vault_documents,
                )
        except Exception as e:
            logger.warning(f"Supabase lookup failed for {company_id}: {e}")

    # Fallback from CSV
    csv_rows = load_fallback_csv_companies()
    matched_row = next((r for r in csv_rows if r.get("company_id") == company_id), None)
    if not matched_row:
        raise HTTPException(status_code=404, detail=f"MSME Company '{company_id}' not found.")

    # Synthesize normalized work orders and vault documents from flat CSV
    work_orders = []
    for i in (1, 2, 3):
        client = matched_row.get(f"work_order_{i}_client")
        val = matched_row.get(f"work_order_{i}_value_lakhs")
        yr = matched_row.get(f"work_order_{i}_year")
        if client and client.strip():
            work_orders.append(
                WorkOrderSchema(
                    work_order_num=i,
                    client_name=client.strip(),
                    value_lakhs=float(val or 0.0),
                    completion_year=int(yr) if yr and yr.isdigit() else 2023,
                )
            )

    iso_valid = matched_row.get("iso_9001_valid_until")
    vault_documents = [
        VaultDocumentSchema(
            doc_type="UDYAM",
            document_name="Udyam Registration Certificate",
            status=DocumentStatus(matched_row.get("udyam_cert_status", "VALID").upper()),
            details={"udyam_number": matched_row.get("udyam_number")},
        ),
        VaultDocumentSchema(
            doc_type="GST",
            document_name="GST Registration Certificate (REG-06)",
            status=DocumentStatus(matched_row.get("gst_cert_status", "VALID").upper()),
            details={"gst_number": matched_row.get("gst_number")},
        ),
        VaultDocumentSchema(
            doc_type="ISO_9001",
            document_name="ISO 9001:2015 Quality Management System",
            status=DocumentStatus(matched_row.get("iso_9001_status", "VALID").upper()),
            valid_until=datetime.strptime(iso_valid, "%Y-%m-%d").date() if iso_valid else None,
        ),
        VaultDocumentSchema(
            doc_type="ANNEXURE_IV",
            document_name="GFR 153 Annexure-IV Local Content Affidavit",
            status=DocumentStatus.VALID if matched_row.get("annexure_iv_affidavit_uploaded", "").lower() == "true" else DocumentStatus.MISSING,
        ),
        VaultDocumentSchema(
            doc_type="TYPE_TEST",
            document_name="NABL / CPRI Accredited Type Test Report",
            status=DocumentStatus.VALID if matched_row.get("type_test_report_lab") else DocumentStatus.MISSING,
            details={"accredited_lab": matched_row.get("type_test_report_lab")},
        ),
    ]

    return MSMEProfileDetailResponse(
        id=matched_row.get("company_id"),
        legal_name=matched_row.get("legal_name"),
        udyam_number=matched_row.get("udyam_number"),
        enterprise_category=matched_row.get("enterprise_category"),
        mse_eligible=matched_row.get("mse_eligible", "").lower() == "true",
        sector=matched_row.get("sector"),
        city=matched_row.get("city"),
        state=matched_row.get("state"),
        gst_number=matched_row.get("gst_number"),
        pan_number=matched_row.get("pan_number"),
        year_of_establishment=int(matched_row.get("year_of_establishment", 2018)),
        is_women_owned=matched_row.get("is_women_owned", "").lower() == "true",
        is_sc_st_owned=matched_row.get("is_sc_st_owned", "").lower() == "true",
        is_dpiit_startup=matched_row.get("is_dpiit_startup", "").lower() == "true",
        turnover_fy21_22_lakhs=float(matched_row.get("turnover_fy21_22_lakhs") or 0.0),
        turnover_fy22_23_lakhs=float(matched_row.get("turnover_fy22_23_lakhs") or 0.0),
        turnover_fy23_24_lakhs=float(matched_row.get("turnover_fy23_24_lakhs") or 0.0),
        avg_3yr_turnover_lakhs=float(matched_row.get("avg_3yr_turnover_lakhs") or 0.0),
        net_worth_lakhs=float(matched_row.get("net_worth_lakhs") or 0.0),
        ca_turnover_udin=matched_row.get("ca_turnover_udin"),
        profile_completeness_pct=int(matched_row.get("profile_completeness_pct") or 85),
        created_at=datetime.utcnow(),
        work_orders=work_orders,
        vault_documents=vault_documents,
    )
