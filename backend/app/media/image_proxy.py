"""Safe proxy for remote cover artwork."""

import ipaddress
from urllib.parse import urlparse

import httpx
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse

router = APIRouter(prefix="/api", tags=["media"])

_ALLOWED_HOSTS = (
    "sndcdn.com",
    "soundcloud.com",
    "ytimg.com",
    "youtube.com",
    "googleusercontent.com",
)
_MAX_IMAGE_BYTES = 5 * 1024 * 1024
_TIMEOUT = httpx.Timeout(connect=5.0, read=10.0, write=5.0, pool=5.0)


def _is_private_host(hostname: str) -> bool:
    try:
        address = ipaddress.ip_address(hostname)
    except ValueError:
        return False
    return address.is_private or address.is_loopback or address.is_link_local or address.is_reserved


def validate_image_url(raw_url: str) -> str:
    """Validate a remote artwork URL before making an outbound request."""
    parsed = urlparse(raw_url.strip())
    hostname = (parsed.hostname or "").lower().rstrip(".")

    if parsed.scheme != "https" or not hostname or parsed.username or parsed.password:
        raise HTTPException(status_code=400, detail="Only public HTTPS image URLs are supported")
    if _is_private_host(hostname):
        raise HTTPException(status_code=400, detail="Private network addresses are not allowed")
    if not any(hostname == allowed or hostname.endswith(f".{allowed}") for allowed in _ALLOWED_HOSTS):
        raise HTTPException(status_code=403, detail="Image host is not allowed")

    return raw_url.strip()


@router.get("/image-proxy")
async def image_proxy(url: str = Query(..., min_length=1, max_length=2048)):
    target_url = validate_image_url(url)
    client = httpx.AsyncClient(
        timeout=_TIMEOUT,
        follow_redirects=False,
        headers={"User-Agent": "Omni-Player/1.0 image proxy"},
    )

    try:
        response = await client.send(client.build_request("GET", target_url), stream=True)
        if 300 <= response.status_code < 400:
            raise HTTPException(status_code=502, detail="Image source returned a redirect")
        if response.status_code != 200:
            raise HTTPException(status_code=502, detail="Image source is unavailable")

        content_type = response.headers.get("content-type", "").split(";", 1)[0].lower()
        if not content_type.startswith("image/"):
            raise HTTPException(status_code=415, detail="Remote resource is not an image")

        content_length = response.headers.get("content-length")
        if content_length and int(content_length) > _MAX_IMAGE_BYTES:
            raise HTTPException(status_code=413, detail="Image is too large")

        async def body():
            total = 0
            try:
                async for chunk in response.aiter_bytes(64 * 1024):
                    total += len(chunk)
                    if total > _MAX_IMAGE_BYTES:
                        return
                    yield chunk
            finally:
                await response.aclose()
                await client.aclose()

        headers = {
            "Cache-Control": "public, max-age=86400, s-maxage=604800",
            "X-Content-Type-Options": "nosniff",
        }
        return StreamingResponse(body(), media_type=content_type, headers=headers)
    except HTTPException:
        await client.aclose()
        raise
    except (httpx.HTTPError, ValueError) as exc:
        await client.aclose()
        raise HTTPException(status_code=502, detail="Failed to fetch image") from exc