import os
import logging
from fastapi import APIRouter, HTTPException
from starlette.responses import FileResponse
from pydantic import BaseModel, Field
from typing import Optional

from .tts import tts_manager, generate_speech, TTS_AUDIO_DIR

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/voice", tags=["voice"])


class VoiceGenerateRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=1000)
    voice_id: Optional[str] = "en_US-libritts-high"
    use_rvc: Optional[bool] = True
    rvc_pitch: Optional[int] = 0
    index_rate: Optional[float] = 0.75


class VoiceGenerateResponse(BaseModel):
    success: bool
    file_path: Optional[str] = None
    filename: Optional[str] = None
    duration: Optional[float] = None
    used_rvc: Optional[bool] = False
    error: Optional[str] = None


@router.post("/generate", response_model=VoiceGenerateResponse)
async def generate_voice(request: VoiceGenerateRequest):
    """Piper TTS → SO-VITS-SVC → MP3."""
    if not request.text.strip():
        raise HTTPException(status_code=400, detail="Text is required")

    result = await generate_speech(
        text=request.text,
        voice_id=request.voice_id or "en_US-libritts-high",
        use_rvc=bool(request.use_rvc),
        rvc_pitch=request.rvc_pitch or 0,
        index_rate=request.index_rate or 0.75,
    )

    if not result.success:
        raise HTTPException(status_code=500, detail=result.error or "TTS failed")

    return VoiceGenerateResponse(
        success=True,
        file_path=result.audio_path,
        filename=os.path.basename(result.audio_path),
        duration=result.duration_sec,
        used_rvc=result.is_kanye,
    )


@router.get("/status")
async def get_tts_status():
    """TTS system status."""
    return {
        "initialized": True,
        "model_name": tts_manager.model_name,
        "device": tts_manager.device,
        "rvc_enabled": os.getenv("RVC_ENABLED", "true").lower() == "true",
    }


@router.get("/audio/{filename}")
async def get_audio(filename: str):
    """Serve generated audio."""
    safe_dir = os.path.abspath(str(TTS_AUDIO_DIR))
    file_path = os.path.abspath(os.path.join(safe_dir, filename))
    if not file_path.startswith(safe_dir):
        raise HTTPException(status_code=400, detail="Invalid path")
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="File not found")
    media_type = "audio/mpeg" if file_path.endswith(".mp3") else "audio/wav"
    return FileResponse(file_path, media_type=media_type)
