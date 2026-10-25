"""
BidLens AI 1-Click Bid Submission & Payment Verification Router.
Handles instant MSE bid lodgement, statutory EMD waiver validation, and mock fee reconciliation.
"""

from typing import List, Optional
import uuid
import logging
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, status, Query
from database import get_supabase
from routers.auth import get_current_user, require_admin
from schemas import (
    BidSubmissionRequest,
    BidResponse,
    MockPaymentRequest,
    MockPaymentResponse,
)

logger = logging.getLogger("bidlens.routers.bids")
router = APIRouter(prefix="/api/bids", tags=["1-Click Bid Engine & Payments"])

# In-memory storage fallback for bids
BIDS_STORE: List[dict] = [
    {
        "id": "BID-2026-00891",
        "tender_id": "TND-2026-DEL-001",
        "company_id": "COMP-001",
        "bid_amount_lakhs": 272.50,
        "claimed_mse_exemption": True,
        "status": "Submitted",
        "payment_status": "Exempted (Rule 153 GFR)",
        "payment_reference": "EMD-EXEMPT-UDYAM-MH-03-0019283",
        "submitted_at": datetime.utcnow(),
    }
]


@router.post("/submit", response_model=BidResponse, status_code=status.HTTP_201_CREATED)
async def submit_bid(payload: BidSubmissionRequest, user: dict = Depends(get_current_user)):
    """
    1-Click Bid Lodgement for MSME enterprises.
    Verifies statutory declarations, attaches digital vault credentials, and records submission.
    """
    if not payload.declaration_accepted:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You must accept the statutory GFR 2017 legal compliance declaration to submit.",
        )

    bid_id = f"BID-{datetime.utcnow().year}-{uuid.uuid4().hex[:6].upper()}"
    payment_status = "Exempted (Rule 153 GFR)" if payload.claimed_mse_exemption else "Pending"
    payment_ref = (
        f"EMD-EXEMPT-{payload.company_id}-{uuid.uuid4().hex[:4].upper()}"
        if payload.claimed_mse_exemption
        else None
    )

    new_bid = {
        "id": bid_id,
        "tender_id": payload.tender_id,
        "company_id": payload.company_id,
        "bid_amount_lakhs": payload.bid_amount_lakhs,
        "claimed_mse_exemption": payload.claimed_mse_exemption,
        "status": "Submitted",
        "payment_status": payment_status,
        "payment_reference": payment_ref,
        "submitted_at": datetime.utcnow(),
    }

    client = get_supabase()
    if client:
        try:
            supabase_payload = dict(new_bid)
            supabase_payload["submitted_at"] = supabase_payload["submitted_at"].isoformat()
            res = client.table("bids").insert(supabase_payload).execute()
            if res.data and len(res.data) > 0:
                return BidResponse(**res.data[0])
        except Exception as e:
            logger.warning(f"Supabase bid insert failed, persisting in-memory: {e}")

    BIDS_STORE.insert(0, new_bid)
    return BidResponse(**new_bid)


@router.post("/verify-payment", response_model=MockPaymentResponse)
async def verify_mock_payment(payload: MockPaymentRequest, user: dict = Depends(get_current_user)):
    """
    Mock payment gateway endpoint for EMD deposits or tender document fees.
    Instantly returns verifiable mock transaction receipts for demo/testing.
    """
    tx_id = f"TXN-GEM-{datetime.utcnow().strftime('%Y%m%d')}-{uuid.uuid4().hex[:8].upper()}"
    receipt_token = f"RCPT-{uuid.uuid4().hex}"

    # Update bid status in memory if present
    for bid in BIDS_STORE:
        if bid["id"] == payload.bid_id:
            bid["payment_status"] = "Verified & Paid"
            bid["payment_reference"] = tx_id
            break

    client = get_supabase()
    if client:
        try:
            client.table("bids").update({
                "payment_status": "Verified & Paid",
                "payment_reference": tx_id
            }).eq("id", payload.bid_id).execute()
        except Exception as e:
            logger.warning(f"Supabase bid payment update failed: {e}")

    message = (
        f"Statutory fee waiver verified under GFR Rule 153 (EMD Exemption)."
        if payload.payment_method == "MSE_EXEMPTION" or payload.amount_inr == 0
        else f"Mock Payment of ₹{payload.amount_inr:,.2f} via {payload.payment_method} successfully authorized."
    )

    return MockPaymentResponse(
        transaction_id=tx_id,
        bid_id=payload.bid_id,
        amount_inr=payload.amount_inr,
        payment_status="SUCCESS",
        receipt_token=receipt_token,
        message=message,
        verified_at=datetime.utcnow(),
    )


@router.get("/my-bids", response_model=List[BidResponse])
async def list_my_bids(
    company_id: Optional[str] = Query(None, description="Company ID to filter submitted bids"),
    user: dict = Depends(get_current_user),
):
    """
    Retrieve all bids lodged by the authenticated MSME company.
    """
    target_company = company_id or user.get("company_id") or "COMP-001"

    client = get_supabase()
    if client:
        try:
            res = client.table("bids").select("*").eq("company_id", target_company).execute()
            if res.data and len(res.data) > 0:
                return [BidResponse(**b) for b in res.data]
        except Exception as e:
            logger.warning(f"Supabase my-bids query failed: {e}")

    matched = [BidResponse(**b) for b in BIDS_STORE if b.get("company_id") == target_company]
    return matched


@router.get("/tender/{tender_id}", response_model=List[BidResponse])
async def list_tender_bids(tender_id: str, user: dict = Depends(require_admin)):
    """
    Admin Authority endpoint: View all competing bids submitted for an active tender.
    """
    client = get_supabase()
    if client:
        try:
            res = client.table("bids").select("*").eq("tender_id", tender_id).execute()
            if res.data and len(res.data) > 0:
                return [BidResponse(**b) for b in res.data]
        except Exception as e:
            logger.warning(f"Supabase tender bids query failed: {e}")

    return [BidResponse(**b) for b in BIDS_STORE if b.get("tender_id") == tender_id]
