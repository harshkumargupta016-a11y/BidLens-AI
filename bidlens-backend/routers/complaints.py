"""
BidLens AI Grievance & Dispute Redressal Router.
Enables MSMEs to challenge restrictive tender terms under GFR 153 and allows Admin Officers to resolve disputes.
"""

from typing import List, Optional
import uuid
import logging
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, status, Query
from database import get_supabase
from routers.auth import get_current_user, require_admin
from schemas import (
    ComplaintCreate,
    ComplaintUpdateStatus,
    ComplaintResponse,
    GrievanceStatus,
)

logger = logging.getLogger("bidlens.routers.complaints")
router = APIRouter(prefix="/api/complaints", tags=["Grievances & Dispute Redressal"])

# Realistic Indian Public Procurement Complaints
COMPLAINTS_STORE: List[dict] = [
    {
        "id": "GRV-2026-0041",
        "tender_id": "TND-2026-DEL-001",
        "company_id": "COMP-001",
        "title": "Exorbitant Annual Turnover Requirement Violates GFR 153(iii)",
        "category": "Restrictive Turnover Clause",
        "description": "The tender stipulates an average annual turnover of ₹85 Lakhs for a ₹285 Lakh work. Under DoE OM No. F.20/2/2014-PPD, MSE turnover criteria must not exceed 25% of estimated tender value for items manufactured by MSEs.",
        "violating_clause": "Section 4.2.1 - Eligibility Criteria (Turnover)",
        "status": GrievanceStatus.INVESTIGATION,
        "admin_remarks": "Noted. Procuring department asked to file corrigendum aligning turnover cap to 25% for MSE biddable portion.",
        "resolution_notes": None,
        "created_at": datetime.utcnow(),
        "updated_at": datetime.utcnow(),
    },
    {
        "id": "GRV-2026-0029",
        "tender_id": "TND-2026-CHN-005",
        "company_id": "COMP-014",
        "title": "Discriminatory Brand-Specific Specification for Ventilation Actuators",
        "category": "Discriminatory Specs",
        "description": "Tender explicitly demands Belimo or Honeywell model actuators without allowing 'or equivalent' technical compliance as mandated by Central Vigilance Commission (CVC) guidelines.",
        "violating_clause": "Technical Annexure B - Schedule of Makes",
        "status": GrievanceStatus.RESOLVED,
        "admin_remarks": "Corrigendum No. 2 issued on 22-Oct-2026 inserting 'or equivalent conforming to EN 1366' in schedule of makes.",
        "resolution_notes": "Corrigendum published on GeM portal. Dispute successfully closed.",
        "created_at": datetime.utcnow(),
        "updated_at": datetime.utcnow(),
    },
]


@router.post("", response_model=ComplaintResponse, status_code=status.HTTP_201_CREATED)
async def register_complaint(payload: ComplaintCreate, user: dict = Depends(get_current_user)):
    """
    File an official grievance against restrictive tender conditions or unfair disqualifications.
    """
    complaint_id = f"GRV-{datetime.utcnow().year}-{uuid.uuid4().hex[:4].upper()}"
    new_complaint = {
        "id": complaint_id,
        "tender_id": payload.tender_id,
        "company_id": payload.company_id,
        "title": payload.title,
        "category": payload.category,
        "description": payload.description,
        "violating_clause": payload.violating_clause,
        "status": GrievanceStatus.SUBMITTED,
        "admin_remarks": None,
        "resolution_notes": None,
        "created_at": datetime.utcnow(),
        "updated_at": datetime.utcnow(),
    }

    client = get_supabase()
    if client:
        try:
            supabase_payload = dict(new_complaint)
            supabase_payload["created_at"] = supabase_payload["created_at"].isoformat()
            supabase_payload["updated_at"] = supabase_payload["updated_at"].isoformat()
            supabase_payload["status"] = supabase_payload["status"].value
            res = client.table("complaints").insert(supabase_payload).execute()
            if res.data and len(res.data) > 0:
                return ComplaintResponse(**res.data[0])
        except Exception as e:
            logger.warning(f"Supabase complaint insert failed, using fallback: {e}")

    COMPLAINTS_STORE.insert(0, new_complaint)
    return ComplaintResponse(**new_complaint)


@router.get("", response_model=List[ComplaintResponse])
async def list_complaints(
    status_filter: Optional[GrievanceStatus] = Query(None, alias="status"),
    company_id: Optional[str] = Query(None),
    tender_id: Optional[str] = Query(None),
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
):
    """
    List registered grievances with parametric status and entity filtering.
    """
    client = get_supabase()
    if client:
        try:
            query = client.table("complaints").select("*")
            if status_filter:
                query = query.eq("status", status_filter.value)
            if company_id:
                query = query.eq("company_id", company_id)
            if tender_id:
                query = query.eq("tender_id", tender_id)

            res = query.order("created_at", desc=True).range(offset, offset + limit - 1).execute()
            if res.data and len(res.data) > 0:
                return [ComplaintResponse(**c) for c in res.data]
        except Exception as e:
            logger.warning(f"Supabase complaints fetch failed: {e}")

    filtered = []
    for c in COMPLAINTS_STORE:
        if status_filter and c["status"] != status_filter:
            continue
        if company_id and c["company_id"] != company_id:
            continue
        if tender_id and c["tender_id"] != tender_id:
            continue
        filtered.append(ComplaintResponse(**c))

    return filtered[offset : offset + limit]


@router.get("/{complaint_id}", response_model=ComplaintResponse)
async def get_complaint_detail(complaint_id: str):
    """
    Retrieve full evidentiary dossier for a specific grievance.
    """
    client = get_supabase()
    if client:
        try:
            res = client.table("complaints").select("*").eq("id", complaint_id).execute()
            if res.data and len(res.data) > 0:
                return ComplaintResponse(**res.data[0])
        except Exception as e:
            logger.warning(f"Supabase complaint lookup failed: {e}")

    matched = next((c for c in COMPLAINTS_STORE if c["id"] == complaint_id), None)
    if not matched:
        raise HTTPException(status_code=404, detail=f"Grievance dossier '{complaint_id}' not found.")
    return ComplaintResponse(**matched)


@router.patch("/{complaint_id}/status", response_model=ComplaintResponse)
async def update_complaint_status(
    complaint_id: str,
    payload: ComplaintUpdateStatus,
    user: dict = Depends(require_admin),
):
    """
    Admin Authority endpoint: Update grievance status (Investigation, Resolved, etc.) and append official remarks.
    """
    client = get_supabase()
    if client:
        try:
            update_data = {
                "status": payload.status.value,
                "updated_at": datetime.utcnow().isoformat(),
            }
            if payload.admin_remarks is not None:
                update_data["admin_remarks"] = payload.admin_remarks
            if payload.resolution_notes is not None:
                update_data["resolution_notes"] = payload.resolution_notes

            res = client.table("complaints").update(update_data).eq("id", complaint_id).execute()
            if res.data and len(res.data) > 0:
                return ComplaintResponse(**res.data[0])
        except Exception as e:
            logger.warning(f"Supabase complaint status update failed: {e}")

    matched = next((c for c in COMPLAINTS_STORE if c["id"] == complaint_id), None)
    if not matched:
        raise HTTPException(status_code=404, detail=f"Grievance dossier '{complaint_id}' not found.")

    matched["status"] = payload.status
    if payload.admin_remarks is not None:
        matched["admin_remarks"] = payload.admin_remarks
    if payload.resolution_notes is not None:
        matched["resolution_notes"] = payload.resolution_notes
    matched["updated_at"] = datetime.utcnow()

    return ComplaintResponse(**matched)
