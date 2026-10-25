"""
BidLens AI Supabase Database Connection & Client Provider.
Handles client initialization, service role management, and connection health diagnostics.
"""

from typing import Optional, Dict, Any
import logging
from supabase import create_client, Client
from config import get_settings

logger = logging.getLogger("bidlens.database")
settings = get_settings()

_supabase_client: Optional[Client] = None
_supabase_admin_client: Optional[Client] = None


def get_supabase() -> Optional[Client]:
    """
    Get or create the standard Supabase client.
    Uses SUPABASE_KEY (anon or service role key).
    """
    global _supabase_client
    if _supabase_client is not None:
        return _supabase_client

    if not settings.SUPABASE_URL or not settings.SUPABASE_KEY:
        logger.warning(
            "SUPABASE_URL or SUPABASE_KEY not configured. Running in unconfigured/mock mode."
        )
        return None

    try:
        _supabase_client = create_client(settings.SUPABASE_URL, settings.SUPABASE_KEY)
        logger.info("Supabase standard client initialized successfully.")
        return _supabase_client
    except Exception as e:
        logger.error(f"Failed to initialize Supabase client: {e}")
        return None


def get_supabase_admin() -> Optional[Client]:
    """
    Get or create the Supabase admin client using the service role key.
    Bypasses Row Level Security (RLS) for admin audit and governance tasks.
    """
    global _supabase_admin_client
    if _supabase_admin_client is not None:
        return _supabase_admin_client

    admin_key = settings.SUPABASE_SERVICE_ROLE_KEY or settings.SUPABASE_KEY
    if not settings.SUPABASE_URL or not admin_key:
        return get_supabase()

    try:
        _supabase_admin_client = create_client(settings.SUPABASE_URL, admin_key)
        logger.info("Supabase admin client initialized successfully.")
        return _supabase_admin_client
    except Exception as e:
        logger.error(f"Failed to initialize Supabase admin client: {e}")
        return get_supabase()


async def check_supabase_health() -> Dict[str, Any]:
    """
    Verify Supabase connectivity by running a lightweight ping query.
    Returns connectivity status and metadata.
    """
    client = get_supabase()
    if not client:
        return {
            "status": "unconfigured",
            "message": "SUPABASE_URL and SUPABASE_KEY environment variables are not set.",
            "connected": False,
        }

    try:
        # Check if msme_profiles table exists and is accessible
        response = client.table("msme_profiles").select("id").limit(1).execute()
        return {
            "status": "connected",
            "message": "Successfully connected to Supabase PostgreSQL database.",
            "connected": True,
            "sample_table_accessible": True,
            "records_found": len(response.data) if response.data else 0,
        }
    except Exception as e:
        # If table does not exist or network error, return diagnostic detail
        err_msg = str(e)
        logger.warning(f"Supabase health check returned warning: {err_msg}")
        return {
            "status": "degraded",
            "message": f"Connected to Supabase endpoint, but table query returned: {err_msg}",
            "connected": True,
            "sample_table_accessible": False,
        }
