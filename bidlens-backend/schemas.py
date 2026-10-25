"""
Pydantic Schemas and Data Models for BidLens AI.
Provides strict request validation and response serialization across all platform domains.
"""

from typing import List, Optional, Dict, Any
from enum import Enum
from datetime import datetime, date
from pydantic import BaseModel, Field, EmailStr


# ==========================================
# 1. ENUMS & CORE TYPES
# ==========================================

class UserRole(str, Enum):
    BIDDER = "bidder"
    ADMIN = "admin"


class GrievanceStatus(str, Enum):
    SUBMITTED = "Submitted"
    UNDER_REVIEW = "Under Review"
    INVESTIGATION = "Investigation"
    RESOLVED = "Resolved"
    ESCALATED = "Escalated"


class EnterpriseCategory(str, Enum):
    MICRO = "Micro"
    SMALL = "Small"
    MEDIUM = "Medium"


class DocumentStatus(str, Enum):
    VALID = "VALID"
    EXPIRED = "EXPIRED"
    MISSING = "MISSING"
    UPLOADED = "UPLOADED"


# ==========================================
# 2. AUTH & USER PROFILE SCHEMAS
# ==========================================

class LoginRequest(BaseModel):
    email: EmailStr
    password: str
    role: UserRole = UserRole.BIDDER
    company_id: Optional[str] = None


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str
    full_name: str
    role: UserRole = UserRole.BIDDER
    company_id: Optional[str] = None
    designation: Optional[str] = None


class AuthResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    role: UserRole
    user_id: str
    email: str
    company_id: Optional[str] = None
    full_name: Optional[str] = None


class WorkOrderSchema(BaseModel):
    id: Optional[str] = None
    work_order_num: Optional[int] = 1
    client_name: str
    value_lakhs: float
    completion_year: Optional[int] = None


class VaultDocumentSchema(BaseModel):
    id: Optional[str] = None
    doc_type: str
    document_name: str
    status: DocumentStatus
    valid_until: Optional[date] = None
    details: Optional[Dict[str, Any]] = None


class MSMEProfileResponse(BaseModel):
    id: str
    legal_name: str
    udyam_number: Optional[str] = None
    enterprise_category: Optional[str] = None
    mse_eligible: bool = True
    sector: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    gst_number: Optional[str] = None
    pan_number: Optional[str] = None
    year_of_establishment: Optional[int] = None
    is_women_owned: bool = False
    is_sc_st_owned: bool = False
    is_dpiit_startup: bool = False
    turnover_fy21_22_lakhs: Optional[float] = 0.0
    turnover_fy22_23_lakhs: Optional[float] = 0.0
    turnover_fy23_24_lakhs: Optional[float] = 0.0
    avg_3yr_turnover_lakhs: Optional[float] = 0.0
    net_worth_lakhs: Optional[float] = 0.0
    ca_turnover_udin: Optional[str] = None
    profile_completeness_pct: Optional[int] = 80
    created_at: Optional[datetime] = None


class MSMEProfileDetailResponse(MSMEProfileResponse):
    work_orders: List[WorkOrderSchema] = []
    vault_documents: List[VaultDocumentSchema] = []


# ==========================================
# 3. TENDER SCHEMAS
# ==========================================

class TenderBase(BaseModel):
    tender_ref_no: str
    title: str
    issuing_authority: str
    department: Optional[str] = None
    sector: str
    estimated_value_lakhs: float
    location_city: str
    location_state: str
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    closing_date: datetime
    mse_reserved: bool = True
    emd_amount_lakhs: float = 0.0
    emd_exemption_for_mse: bool = True
    min_3yr_turnover_lakhs: Optional[float] = 0.0
    min_past_work_order_lakhs: Optional[float] = 0.0
    mandatory_certifications: List[str] = []
    description: Optional[str] = None
    gemini_feasibility_score: Optional[int] = 85


class TenderCreate(TenderBase):
    pass


class TenderUpdate(BaseModel):
    title: Optional[str] = None
    issuing_authority: Optional[str] = None
    estimated_value_lakhs: Optional[float] = None
    closing_date: Optional[datetime] = None
    mse_reserved: Optional[bool] = None
    status: Optional[str] = None


class TenderResponse(TenderBase):
    id: str
    status: str = "Active"
    created_at: Optional[datetime] = None


class TenderNearMeRequest(BaseModel):
    latitude: float = Field(..., ge=-90.0, le=90.0)
    longitude: float = Field(..., ge=-180.0, le=180.0)
    radius_km: float = Field(default=250.0, gt=0, le=3000.0)
    sector: Optional[str] = None


class TenderNearMeResponse(TenderResponse):
    distance_km: float


# ==========================================
# 4. BID SUBMISSION & PAYMENT SCHEMAS
# ==========================================

class BidSubmissionRequest(BaseModel):
    tender_id: str
    company_id: str
    bid_amount_lakhs: float = Field(..., gt=0)
    technical_proposal_summary: Optional[str] = None
    claimed_mse_exemption: bool = True
    vault_document_ids: List[str] = []
    declaration_accepted: bool = Field(..., description="Legal declaration under GFR 2017")


class BidResponse(BaseModel):
    id: str
    tender_id: str
    company_id: str
    bid_amount_lakhs: float
    claimed_mse_exemption: bool
    status: str = "Submitted"
    payment_status: str = "Exempted"
    payment_reference: Optional[str] = None
    submitted_at: datetime


class MockPaymentRequest(BaseModel):
    bid_id: str
    tender_id: str
    company_id: str
    amount_inr: float = 0.0
    payment_method: str = "UPI"  # "UPI", "NetBanking", "MSE_EXEMPTION"


class MockPaymentResponse(BaseModel):
    transaction_id: str
    bid_id: str
    amount_inr: float
    payment_status: str
    receipt_token: str
    message: str
    verified_at: datetime


# ==========================================
# 5. GRIEVANCE & COMPLAINTS SCHEMAS
# ==========================================

class ComplaintCreate(BaseModel):
    tender_id: str
    company_id: str
    title: str
    category: str = Field(..., description="e.g. Restrictive Turnover, Delayed EMD, Discriminatory Specs")
    description: str
    violating_clause: Optional[str] = None
    evidence_url: Optional[str] = None


class ComplaintUpdateStatus(BaseModel):
    status: GrievanceStatus
    admin_remarks: Optional[str] = None
    resolution_notes: Optional[str] = None


class ComplaintResponse(BaseModel):
    id: str
    tender_id: str
    company_id: str
    title: str
    category: str
    description: str
    violating_clause: Optional[str] = None
    status: GrievanceStatus
    admin_remarks: Optional[str] = None
    resolution_notes: Optional[str] = None
    created_at: datetime
    updated_at: Optional[datetime] = None


# ==========================================
# 6. GEMINI 5-PILLAR AI SCORING SCHEMAS
# ==========================================

class AIScoreRequest(BaseModel):
    tender_id: str
    company_id: str
    custom_bid_amount_lakhs: Optional[float] = None
    custom_proposal_notes: Optional[str] = None


class PillarScore(BaseModel):
    score: float = Field(..., ge=0.0, le=100.0)
    weight: float = Field(..., ge=0.0, le=1.0)
    assessment: str
    key_findings: List[str]


class PillarBreakdown(BaseModel):
    technical_competence: PillarScore
    financial_solvency: PillarScore
    past_performance: PillarScore
    compliance_and_vault: PillarScore
    mse_policy_advantage: PillarScore


class AIScoreResponse(BaseModel):
    company_id: str
    tender_id: str
    overall_score: float = Field(..., ge=0.0, le=100.0)
    rating_tier: str  # "A+ - Elite Bidder", "A - Highly Competitive", "B - Moderate", "C - High Risk"
    win_probability_pct: float = Field(..., ge=0.0, le=100.0)
    pillars: PillarBreakdown
    strengths: List[str]
    risks_and_red_flags: List[str]
    gfr_compliance_audit: str
    actionable_recommendations: List[str]
    gemini_model_used: str
    generated_at: datetime


# ==========================================
# 7. HEALTH & SYSTEM DIAGNOSTICS
# ==========================================

class HealthResponse(BaseModel):
    status: str
    version: str
    environment: str
    supabase: Dict[str, Any]
    gemini_configured: bool
    timestamp: datetime
