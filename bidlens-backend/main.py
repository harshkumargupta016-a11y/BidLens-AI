"""
BidLens AI - Python FastAPI Backend Entrypoint.
Production-ready procurement intelligence backend integrated with Supabase and Google Gemini.
Zero-configuration deployment on PyHost, Render, Railway, or AWS.
"""

import time
import logging
from datetime import datetime
from fastapi import FastAPI, Request, status
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.exceptions import RequestValidationError
from starlette.exceptions import HTTPException as StarletteHTTPException

from config import get_settings
from database import check_supabase_health, get_supabase
from schemas import HealthResponse

# Import Domain Routers
from routers.auth import router as auth_router
from routers.tenders import router as tenders_router
from routers.bids import router as bids_router
from routers.complaints import router as complaints_router
from routers.ai_score import router as ai_score_router

# Configure Logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("bidlens.backend")

settings = get_settings()

# Initialize FastAPI App
app = FastAPI(
    title="BidLens AI - Procurement Intelligence Engine",
    description=(
        "Production-grade RESTful API for BidLens AI. "
        "Enables MSME tender intelligence, geo-discovery, 1-Click statutory bidding under GFR 2017, "
        "grievance redressal, and Gemini-powered 5-Pillar tender feasibility scoring."
    ),
    version=settings.APP_VERSION,
    docs_url="/docs",
    redoc_url="/redoc",
    openapi_url="/openapi.json",
)

# Configure Cross-Origin Resource Sharing (CORS)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS if isinstance(settings.CORS_ORIGINS, list) else ["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Global Timing & Request Logging Middleware
@app.middleware("http")
async def add_process_time_header(request: Request, call_next):
    start_time = time.time()
    response = await call_next(request)
    process_time = (time.time() - start_time) * 1000
    response.headers["X-Process-Time-Ms"] = f"{process_time:.2f}"
    return response


# Global Exception Handlers
@app.exception_handler(StarletteHTTPException)
async def http_exception_handler(request: Request, exc: StarletteHTTPException):
    return JSONResponse(
        status_code=exc.status_code,
        content={
            "success": False,
            "error": exc.detail,
            "status_code": exc.status_code,
            "path": request.url.path,
        },
    )


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        content={
            "success": False,
            "error": "Request payload validation failed",
            "details": exc.errors(),
            "path": request.url.path,
        },
    )


@app.exception_handler(Exception)
async def generic_exception_handler(request: Request, exc: Exception):
    logger.exception(f"Unhandled exception on {request.url.path}: {exc}")
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={
            "success": False,
            "error": "An internal server error occurred while processing your request.",
            "details": str(exc) if settings.DEBUG else None,
            "path": request.url.path,
        },
    )


# System & Diagnostics Endpoints
@app.get("/", tags=["System Diagnostics"])
async def root():
    """
    API Welcome and Service Discovery index.
    """
    return {
        "service": "BidLens AI Backend",
        "version": settings.APP_VERSION,
        "environment": settings.APP_ENV,
        "documentation": "/docs",
        "redoc": "/redoc",
        "health_check": "/health",
        "modules": {
            "auth_and_profiles": "/api/auth",
            "tenders_and_geo": "/api/tenders",
            "bids_and_payments": "/api/bids",
            "grievances": "/api/complaints",
            "gemini_5pillar_eval": "/api/ai-score",
        },
    }


@app.get("/health", response_model=HealthResponse, tags=["System Diagnostics"])
async def health_check():
    """
    Complete system health and dependency connectivity status.
    Tests Supabase PostgreSQL accessibility and verifies Gemini API configuration.
    """
    supabase_status = await check_supabase_health()
    gemini_ready = bool(settings.GEMINI_API_KEY and settings.GEMINI_API_KEY != "your-gemini-api-key")

    overall_status = "healthy"
    if not supabase_status.get("connected") and settings.SUPABASE_URL:
        overall_status = "degraded"

    return HealthResponse(
        status=overall_status,
        version=settings.APP_VERSION,
        environment=settings.APP_ENV,
        supabase=supabase_status,
        gemini_configured=gemini_ready,
        timestamp=datetime.utcnow(),
    )


# Register Feature Routers
app.include_router(auth_router)
app.include_router(tenders_router)
app.include_router(bids_router)
app.include_router(complaints_router)
app.include_router(ai_score_router)


# Local Execution Entrypoint
if __name__ == "__main__":
    import uvicorn

    logger.info(f"Starting BidLens AI FastAPI backend on port {settings.PORT}...")
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=settings.PORT,
        reload=settings.DEBUG,
    )
