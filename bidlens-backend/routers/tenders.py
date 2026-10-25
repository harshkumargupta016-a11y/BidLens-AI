"""
BidLens AI Tenders Router.
Provides Tender CRUD, advanced parametric filtering, and "Tenders Near Me" Haversine geo-spatial querying.
"""

from typing import List, Optional
import math
import uuid
import logging
from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, HTTPException, status, Query
from database import get_supabase
from routers.auth import require_admin, get_current_user
from schemas import (
    TenderResponse,
    TenderCreate,
    TenderUpdate,
    TenderNearMeRequest,
    TenderNearMeResponse,
)

logger = logging.getLogger("bidlens.routers.tenders")
router = APIRouter(prefix="/api/tenders", tags=["Tenders & Geo-Discovery"])

# Realistic Indian Public Procurement Tenders with Geo Coordinates
DEMO_TENDERS = [
    {
        "id": "TND-2026-DEL-001",
        "tender_ref_no": "NR/SIG/2026/044",
        "title": "Supply and Installation of Microprocessor Based Electronic Interlocking Systems",
        "issuing_authority": "Northern Railway Headquarter",
        "department": "Signal & Telecommunication",
        "sector": "Railways & Transit",
        "estimated_value_lakhs": 285.50,
        "location_city": "New Delhi",
        "location_state": "Delhi",
        "latitude": 28.6139,
        "longitude": 77.2090,
        "closing_date": datetime.utcnow() + timedelta(days=18),
        "mse_reserved": True,
        "emd_amount_lakhs": 5.71,
        "emd_exemption_for_mse": True,
        "min_3yr_turnover_lakhs": 85.0,
        "min_past_work_order_lakhs": 140.0,
        "mandatory_certifications": ["RDSO Approved", "ISO 9001:2015"],
        "description": "Design, manufacture, supply, testing, and commissioning of Electronic Interlocking at 4 rail junctions conforming to RDSO/SPN/192/2005.",
        "gemini_feasibility_score": 94,
        "status": "Active",
        "created_at": datetime.utcnow() - timedelta(days=4),
    },
    {
        "id": "TND-2026-BOM-002",
        "tender_ref_no": "MCGM/SWM/2026/109",
        "title": "Procurement of IoT-Enabled Smart Waste Compactor Bins & Telematics",
        "issuing_authority": "Brihanmumbai Municipal Corporation (BMC)",
        "department": "Solid Waste Management",
        "sector": "Smart City & Waste Management",
        "estimated_value_lakhs": 142.00,
        "location_city": "Mumbai",
        "location_state": "Maharashtra",
        "latitude": 18.9400,
        "longitude": 72.8350,
        "closing_date": datetime.utcnow() + timedelta(days=12),
        "mse_reserved": True,
        "emd_amount_lakhs": 2.84,
        "emd_exemption_for_mse": True,
        "min_3yr_turnover_lakhs": 42.6,
        "min_past_work_order_lakhs": 71.0,
        "mandatory_certifications": ["ISO 14001:2015", "CE / RoHS"],
        "description": "Supply of 350 smart IoT fill-level ultrasonic sensor compactors with real-time cloud telemetry integration for BMC Ward F-North.",
        "gemini_feasibility_score": 88,
        "status": "Active",
        "created_at": datetime.utcnow() - timedelta(days=2),
    },
    {
        "id": "TND-2026-BLR-003",
        "tender_ref_no": "BESCOM/DSM/2026/89",
        "title": "Rooftop Solar PV Grid-Tied Inverters & Bi-Directional Net-Meters",
        "issuing_authority": "Bangalore Electricity Supply Company Limited (BESCOM)",
        "department": "Renewable Energy Cell",
        "sector": "Renewable Energy",
        "estimated_value_lakhs": 195.00,
        "location_city": "Bengaluru",
        "location_state": "Karnataka",
        "latitude": 12.9716,
        "longitude": 77.5946,
        "closing_date": datetime.utcnow() + timedelta(days=21),
        "mse_reserved": True,
        "emd_amount_lakhs": 3.90,
        "emd_exemption_for_mse": True,
        "min_3yr_turnover_lakhs": 58.5,
        "min_past_work_order_lakhs": 97.5,
        "mandatory_certifications": ["BIS / MNRE Approved", "IEC 61215"],
        "description": "Supply, testing, and delivery of 1,200 grid-tied smart string solar inverters for PM-Surya Ghar residential grid ties across Bangalore Urban.",
        "gemini_feasibility_score": 91,
        "status": "Active",
        "created_at": datetime.utcnow() - timedelta(days=6),
    },
    {
        "id": "TND-2026-HYD-004",
        "tender_ref_no": "TG-MSIDC/MED/2026/012",
        "title": "Supply of Portable Multi-Para Patient Vital Monitors for Primary Health Centers",
        "issuing_authority": "Telangana Medical Services & Infrastructure Dev Corp",
        "department": "Health & Family Welfare",
        "sector": "Healthcare & Medical Devices",
        "estimated_value_lakhs": 84.00,
        "location_city": "Hyderabad",
        "location_state": "Telangana",
        "latitude": 17.3850,
        "longitude": 78.4867,
        "closing_date": datetime.utcnow() + timedelta(days=9),
        "mse_reserved": True,
        "emd_amount_lakhs": 1.68,
        "emd_exemption_for_mse": True,
        "min_3yr_turnover_lakhs": 25.2,
        "min_past_work_order_lakhs": 42.0,
        "mandatory_certifications": ["ISO 13485:2016", "CDSCO Registered"],
        "description": "Procurement of 120 units of 7-parameter medical grade vital sign monitors with battery backup for 45 rural community dispensaries.",
        "gemini_feasibility_score": 82,
        "status": "Active",
        "created_at": datetime.utcnow() - timedelta(days=5),
    },
    {
        "id": "TND-2026-CHN-005",
        "tender_ref_no": "CMRL/E&M/2026/512",
        "title": "Fire Suppression & Smoke Exhaust HVAC Ducting Systems for Phase-2 Underground Stations",
        "issuing_authority": "Chennai Metro Rail Limited (CMRL)",
        "department": "Electrical & Mechanical",
        "sector": "Industrial Engineering",
        "estimated_value_lakhs": 340.00,
        "location_city": "Chennai",
        "location_state": "Tamil Nadu",
        "latitude": 13.0827,
        "longitude": 80.2707,
        "closing_date": datetime.utcnow() + timedelta(days=26),
        "mse_reserved": False,
        "emd_amount_lakhs": 6.80,
        "emd_exemption_for_mse": True,
        "min_3yr_turnover_lakhs": 102.0,
        "min_past_work_order_lakhs": 170.0,
        "mandatory_certifications": ["UL / FM Approved", "ISO 9001:2015"],
        "description": "Fabrication, fire-rated insulation, acoustic lining, and installation of heavy-duty ventilation ducts across 3 underground metro stations.",
        "gemini_feasibility_score": 79,
        "status": "Active",
        "created_at": datetime.utcnow() - timedelta(days=7),
    },
    {
        "id": "TND-2026-AMD-006",
        "tender_ref_no": "GACL/POW/2026/304",
        "title": "Supply of Energy-Efficient High-Tension Induction Motors & VFD Panels",
        "issuing_authority": "Gujarat Alkalies and Chemicals Limited (GACL)",
        "department": "Power Distribution",
        "sector": "Electrical Equipment",
        "estimated_value_lakhs": 115.00,
        "location_city": "Ahmedabad",
        "location_state": "Gujarat",
        "latitude": 23.0225,
        "longitude": 72.5714,
        "closing_date": datetime.utcnow() + timedelta(days=15),
        "mse_reserved": True,
        "emd_amount_lakhs": 2.30,
        "emd_exemption_for_mse": True,
        "min_3yr_turnover_lakhs": 34.5,
        "min_past_work_order_lakhs": 57.5,
        "mandatory_certifications": ["IS 12615 (IE3/IE4)", "CPRI Type Tested"],
        "description": "Supply and testing of 45 numbers IE3 premium efficiency 3-phase induction motors with variable frequency drives.",
        "gemini_feasibility_score": 93,
        "status": "Active",
        "created_at": datetime.utcnow() - timedelta(days=1),
    },
]


def haversine_distance_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Calculate great-circle distance between two geo-coordinates in kilometers."""
    radius = 6371.0  # Earth's radius in kilometers
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = (
        math.sin(dlat / 2.0) ** 2
        + math.cos(math.radians(lat1))
        * math.cos(math.radians(lat2))
        * math.sin(dlon / 2.0) ** 2
    )
    c = 2.0 * math.atan2(math.sqrt(a), math.sqrt(1.0 - a))
    return round(radius * c, 2)


@router.get("", response_model=List[TenderResponse])
async def list_tenders(
    sector: Optional[str] = Query(None, description="Filter by industrial sector"),
    state: Optional[str] = Query(None, description="Filter by location state"),
    min_value: Optional[float] = Query(None, description="Minimum estimated value in Lakhs"),
    max_value: Optional[float] = Query(None, description="Maximum estimated value in Lakhs"),
    mse_reserved: Optional[bool] = Query(None, description="Filter 100% MSE reserved tenders"),
    search: Optional[str] = Query(None, description="Search keywords in title or ref no"),
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
):
    """
    Search and filter public tenders.
    Pulls from Supabase 'tenders' table with fallback to DEMO_TENDERS.
    """
    client = get_supabase()
    if client:
        try:
            query = client.table("tenders").select("*")
            if sector:
                query = query.ilike("sector", f"%{sector}%")
            if state:
                query = query.ilike("location_state", f"%{state}%")
            if min_value is not None:
                query = query.gte("estimated_value_lakhs", min_value)
            if max_value is not None:
                query = query.lte("estimated_value_lakhs", max_value)
            if mse_reserved is not None:
                query = query.eq("mse_reserved", mse_reserved)
            if search:
                query = query.or_(f"title.ilike.%{search}%,tender_ref_no.ilike.%{search}%")

            res = query.range(offset, offset + limit - 1).execute()
            if res.data and len(res.data) > 0:
                return [TenderResponse(**t) for t in res.data]
        except Exception as e:
            logger.warning(f"Supabase tenders query failed, using demo tenders: {e}")

    # Fallback to local high-fidelity tenders
    filtered = []
    for t in DEMO_TENDERS:
        if sector and sector.lower() not in t["sector"].lower():
            continue
        if state and state.lower() not in t["location_state"].lower():
            continue
        if min_value is not None and t["estimated_value_lakhs"] < min_value:
            continue
        if max_value is not None and t["estimated_value_lakhs"] > max_value:
            continue
        if mse_reserved is not None and t["mse_reserved"] != mse_reserved:
            continue
        if search:
            s_low = search.lower()
            if s_low not in t["title"].lower() and s_low not in t["tender_ref_no"].lower():
                continue
        filtered.append(TenderResponse(**t))

    return filtered[offset : offset + limit]


@router.get("/{tender_id}", response_model=TenderResponse)
async def get_tender_detail(tender_id: str):
    """
    Retrieve full procurement specifications for a single tender.
    """
    client = get_supabase()
    if client:
        try:
            res = client.table("tenders").select("*").eq("id", tender_id).execute()
            if res.data and len(res.data) > 0:
                return TenderResponse(**res.data[0])
        except Exception as e:
            logger.warning(f"Supabase tender get failed: {e}")

    matched = next((t for t in DEMO_TENDERS if t["id"] == tender_id or t["tender_ref_no"] == tender_id), None)
    if not matched:
        raise HTTPException(status_code=404, detail=f"Tender '{tender_id}' not found.")
    return TenderResponse(**matched)


@router.post("", response_model=TenderResponse, status_code=status.HTTP_201_CREATED)
async def create_tender(payload: TenderCreate, user: dict = Depends(require_admin)):
    """
    Publish a new public tender. Restricted to Government Procurement Officers.
    """
    tender_id = f"TND-{datetime.utcnow().year}-{uuid.uuid4().hex[:6].upper()}"
    new_tender = payload.model_dump()
    new_tender["id"] = tender_id
    new_tender["status"] = "Active"
    new_tender["created_at"] = datetime.utcnow()

    client = get_supabase()
    if client:
        try:
            # Convert datetime to ISO string for Supabase
            supabase_payload = dict(new_tender)
            supabase_payload["closing_date"] = supabase_payload["closing_date"].isoformat()
            supabase_payload["created_at"] = supabase_payload["created_at"].isoformat()
            res = client.table("tenders").insert(supabase_payload).execute()
            if res.data and len(res.data) > 0:
                return TenderResponse(**res.data[0])
        except Exception as e:
            logger.warning(f"Supabase tender insert failed: {e}")

    DEMO_TENDERS.insert(0, new_tender)
    return TenderResponse(**new_tender)


@router.put("/{tender_id}", response_model=TenderResponse)
async def update_tender(tender_id: str, payload: TenderUpdate, user: dict = Depends(require_admin)):
    """
    Update tender specifications, corrigendum, or status.
    """
    client = get_supabase()
    if client:
        try:
            update_data = {k: v for k, v in payload.model_dump(exclude_unset=True).items() if v is not None}
            if "closing_date" in update_data and isinstance(update_data["closing_date"], datetime):
                update_data["closing_date"] = update_data["closing_date"].isoformat()
            res = client.table("tenders").update(update_data).eq("id", tender_id).execute()
            if res.data and len(res.data) > 0:
                return TenderResponse(**res.data[0])
        except Exception as e:
            logger.warning(f"Supabase tender update failed: {e}")

    matched = next((t for t in DEMO_TENDERS if t["id"] == tender_id), None)
    if not matched:
        raise HTTPException(status_code=404, detail=f"Tender '{tender_id}' not found.")

    for k, v in payload.model_dump(exclude_unset=True).items():
        if v is not None:
            matched[k] = v

    return TenderResponse(**matched)


@router.post("/near-me", response_model=List[TenderNearMeResponse])
async def find_tenders_near_me(payload: TenderNearMeRequest):
    """
    Spatial radius query using the Haversine equation.
    Returns tenders within specified radius_km sorted in ascending order of proximity.
    """
    all_tenders = []
    client = get_supabase()
    if client:
        try:
            res = client.table("tenders").select("*").execute()
            if res.data and len(res.data) > 0:
                all_tenders = [TenderResponse(**t) for t in res.data]
        except Exception as e:
            logger.warning(f"Failed to fetch tenders from Supabase: {e}")

    if not all_tenders:
        all_tenders = [TenderResponse(**t) for t in DEMO_TENDERS]

    geo_results = []
    for t in all_tenders:
        if t.latitude is None or t.longitude is None:
            continue
        if payload.sector and payload.sector.lower() not in t.sector.lower():
            continue

        dist = haversine_distance_km(payload.latitude, payload.longitude, t.latitude, t.longitude)
        if dist <= payload.radius_km:
            geo_results.append(
                TenderNearMeResponse(
                    **t.model_dump(),
                    distance_km=dist,
                )
            )

    # Sort nearest first
    geo_results.sort(key=lambda x: x.distance_km)
    return geo_results
