import os
import threading
import time
from collections import OrderedDict

import requests

NOMINATIM_SEARCH_URL = os.getenv(
    "NOMINATIM_SEARCH_URL",
    "https://nominatim.openstreetmap.org/search",
)
NOMINATIM_USER_AGENT = os.getenv(
    "NOMINATIM_USER_AGENT",
    "DailyTodoSync/1.0 (https://68.183.180.19.sslip.io)",
)
MIN_REQUEST_INTERVAL_SECONDS = 1.1
CACHE_TTL_SECONDS = 30 * 24 * 60 * 60
MAX_CACHE_ENTRIES = 500

_request_lock = threading.Lock()
_last_request_at = 0.0
_cache: OrderedDict[str, tuple[float, list[dict]]] = OrderedDict()


def _normalized_query(value: str) -> str:
    return " ".join(value.strip().lower().split())


def _parse_results(items: list[dict]) -> list[dict]:
    results = []
    for item in items:
        try:
            latitude = float(item["lat"])
            longitude = float(item["lon"])
        except (KeyError, TypeError, ValueError):
            continue
        address = str(item.get("display_name") or "").strip()
        if not address:
            continue
        name = str(item.get("name") or "").strip() or address.split(",", 1)[0].strip()
        result_id = (
            f"{item.get('osm_type') or 'place'}-"
            f"{item.get('osm_id') or item.get('place_id') or address}"
        )
        results.append(
            {
                "id": result_id,
                "name": name,
                "address": address,
                "latitude": latitude,
                "longitude": longitude,
            }
        )
    return results


def search_places(value: str) -> list[dict]:
    global _last_request_at

    query = _normalized_query(value)
    cached = _cache.get(query)
    if cached and time.monotonic() - cached[0] < CACHE_TTL_SECONDS:
        _cache.move_to_end(query)
        return cached[1]

    with _request_lock:
        cached = _cache.get(query)
        if cached and time.monotonic() - cached[0] < CACHE_TTL_SECONDS:
            _cache.move_to_end(query)
            return cached[1]

        wait_seconds = MIN_REQUEST_INTERVAL_SECONDS - (
            time.monotonic() - _last_request_at
        )
        if wait_seconds > 0:
            time.sleep(wait_seconds)

        response = requests.get(
            NOMINATIM_SEARCH_URL,
            params={
                "format": "jsonv2",
                "addressdetails": 1,
                "limit": 5,
                "countrycodes": "cn",
                "dedupe": 1,
                "accept-language": "zh-CN",
                "q": value.strip(),
            },
            headers={
                "Accept-Language": "zh-CN",
                "User-Agent": NOMINATIM_USER_AGENT,
            },
            timeout=12,
        )
        _last_request_at = time.monotonic()
        response.raise_for_status()
        payload = response.json()
        if not isinstance(payload, list):
            raise ValueError("Nominatim response must be a list.")
        results = _parse_results(payload)
        _cache[query] = (_last_request_at, results)
        _cache.move_to_end(query)
        while len(_cache) > MAX_CACHE_ENTRIES:
            _cache.popitem(last=False)
        return results
