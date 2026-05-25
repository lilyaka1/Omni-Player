"""SO-VITS-SVC backend for voice conversion."""
from __future__ import annotations

import json
import logging
import os
import re
import subprocess
import tempfile
from pathlib import Path

import librosa
import numpy as np
import soundfile as sf
import torch

log = logging.getLogger(__name__)

try:
    from so_vits_svc_fork.inference.core import Svc

    SOVITS_AVAILABLE = True
except ImportError:
    Svc = None
    SOVITS_AVAILABLE = False
    log.warning("⚠️ so_vits_svc_fork not available")


class SOVITSRVCEngine:
    """SO-VITS-SVC voice conversion engine."""

    def __init__(self, model_path: str, device: str = "cpu"):
        self.device = device
        self.model_path = Path(model_path)
        self.model_dir = self.model_path if self.model_path.is_dir() else self.model_path.parent
        self.checkpoint_path = self.model_path if self.model_path.is_file() else self.model_dir / "model.pth"
        self.cache_dir = Path(os.getenv("RVC_CACHE_DIR", tempfile.gettempdir() + "/rvc_cache"))
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self.svc_model = None
        self.target_sample_rate = None
        self.default_speaker = os.getenv("RVC_SPEAKER", "0")

        if not SOVITS_AVAILABLE:
            raise ImportError("so_vits_svc_fork not installed: pip install so-vits-svc-fork")
        if not self.checkpoint_path.exists():
            raise FileNotFoundError(f"Model not found: {self.checkpoint_path}")

        self.config_path = self._resolve_config_path()
        self._load_model()

        log.info(f"✅ SO-VITS model loaded, sr={self.target_sample_rate}Hz")

    def _resolve_config_path(self) -> Path:
        env_path = os.getenv("RVC_CONFIG_PATH")
        if env_path:
            config_path = Path(env_path)
            if config_path.exists():
                return config_path

        for candidate in (
            self.model_dir / "config.json",
            self.model_dir / "configs" / "config.json",
            self.model_dir / "configs" / "44k" / "config.json",
        ):
            if candidate.exists():
                return candidate

        return self._build_runtime_config()

    def _build_runtime_config(self) -> Path:
        checkpoint = torch.load(self.checkpoint_path, map_location="cpu", weights_only=False)
        config = checkpoint.get("config", [])
        if not isinstance(config, list) or len(config) < 18:
            raise ValueError("Checkpoint does not contain a usable RVC config payload")

        sampling_rate = int(config[17])
        hop_length = 320 if sampling_rate >= 32000 else 256
        segment_size = hop_length * max(int(config[1]), 1)
        filter_length = int((int(config[0]) - 1) * 2)

        runtime_config = {
            "train": {
                "log_interval": 100,
                "eval_interval": 200,
                "seed": 1234,
                "epochs": 10000,
                "learning_rate": 0.0001,
                "betas": [0.8, 0.99],
                "eps": 1e-9,
                "batch_size": 16,
                "fp16_run": False,
                "bf16_run": False,
                "lr_decay": 0.999875,
                "segment_size": segment_size,
                "init_lr_ratio": 1,
                "warmup_epochs": 0,
                "c_mel": 45,
                "c_kl": 1.0,
                "use_sr": True,
                "max_speclen": 512,
                "port": "8001",
                "keep_ckpts": 3,
                "num_workers": 4,
                "log_version": 0,
                "ckpt_name_by_step": False,
                "accumulate_grad_batches": 1,
            },
            "data": {
                "training_files": "filelists/44k/train.txt",
                "validation_files": "filelists/44k/val.txt",
                "max_wav_value": 32768.0,
                "sampling_rate": sampling_rate,
                "filter_length": filter_length,
                "hop_length": hop_length,
                "win_length": filter_length,
                "n_mel_channels": 80,
                "mel_fmin": 0.0,
                "mel_fmax": float(sampling_rate / 2),
                "contentvec_final_proj": True,
            },
            "model": {
                "inter_channels": int(config[2]),
                "hidden_channels": int(config[3]),
                "filter_channels": int(config[4]),
                "n_heads": int(config[5]),
                "n_layers": int(config[6]),
                "kernel_size": int(config[7]),
                "p_dropout": float(config[8]),
                "resblock": str(config[9]),
                "resblock_kernel_sizes": config[10],
                "resblock_dilation_sizes": config[11],
                "upsample_rates": config[12],
                "upsample_initial_channel": int(config[13]),
                "upsample_kernel_sizes": config[14],
                "n_layers_q": 3,
                "use_spectral_norm": False,
                "gin_channels": 256,
                "ssl_dim": 256,
                "n_speakers": int(config[15]),
                "type_": "hifi-gan",
                "pretrained": {},
            },
            "spk": {"0": 0},
        }

        runtime_config_path = self.cache_dir / f"{self.model_dir.name}_runtime_config.json"
        runtime_config_path.write_text(json.dumps(runtime_config, ensure_ascii=False, indent=2))
        log.warning(f"⚠️ Generated runtime SO-VITS config at {runtime_config_path}")
        return runtime_config_path

    def _load_model(self) -> None:
        checkpoint = torch.load(self.checkpoint_path, map_location="cpu", weights_only=False)
        load_path = self.checkpoint_path

        if "model" not in checkpoint and "weight" in checkpoint:
            iteration_match = re.search(r"(\d+)", str(checkpoint.get("info", "0")))
            iteration = int(iteration_match.group(1)) if iteration_match else 0
            compat_checkpoint = {
                "model": checkpoint["weight"],
                "iteration": iteration,
                "optimizer": None,
                "learning_rate": 0.0,
            }
            load_path = self.cache_dir / f"{self.model_dir.name}_compat_checkpoint.pth"
            torch.save(compat_checkpoint, load_path)
            log.warning(f"⚠️ Repacked RVC checkpoint for SO-VITS loader: {load_path}")

        self.svc_model = Svc(
            net_g_path=load_path.as_posix(),
            config_path=self.config_path.as_posix(),
            cluster_model_path=None,
            device=self.device,
        )
        self.target_sample_rate = self.svc_model.target_sample

    def _encode_output(self, audio: np.ndarray, sample_rate: int, output_path: Path) -> None:
        output_path.parent.mkdir(parents=True, exist_ok=True)
        suffix = output_path.suffix.lower()
        if suffix in {".wav", ".flac", ".ogg"}:
            sf.write(output_path.as_posix(), audio, sample_rate)
            return

        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False, dir=self.cache_dir) as temp_file:
            temp_wav = Path(temp_file.name)

        try:
            sf.write(temp_wav.as_posix(), audio, sample_rate)
            if suffix == ".mp3":
                subprocess.run(
                    ["ffmpeg", "-y", "-i", temp_wav.as_posix(), "-b:a", "128k", output_path.as_posix(), "-loglevel", "quiet"],
                    check=True,
                )
            else:
                sf.write(output_path.as_posix(), audio, sample_rate)
        finally:
            try:
                temp_wav.unlink()
            except OSError:
                pass

    def convert_voice(
        self,
        input_audio_path: str,
        output_path: str,
        index_rate: float = 0.75,
        pitch_shift: int = 0,
    ) -> bool:
        """Convert voice using SO-VITS inference."""
        try:
            assert self.svc_model is not None

            audio, _ = librosa.load(input_audio_path, sr=self.target_sample_rate, mono=True)
            audio = audio.astype(np.float32)

            cluster_infer_ratio = index_rate
            if not hasattr(self.svc_model, "cluster_model") or self.svc_model.cluster_model is None:
                if index_rate > 0:
                    log.warning("⚠️ SO-VITS checkpoint has no cluster model; index_rate will be ignored")
                cluster_infer_ratio = 0.0

            log.info(
                f"🎤 SO-VITS: converting {Path(input_audio_path).name} "
                f"(pitch={pitch_shift}, index_rate={index_rate})"
            )

            converted = self.svc_model.infer_silence(
                audio,
                speaker=self.default_speaker,
                transpose=pitch_shift,
                auto_predict_f0=False,
                cluster_infer_ratio=cluster_infer_ratio,
                noise_scale=0.4,
                f0_method="dio",
                db_thresh=-40,
                pad_seconds=0.5,
                chunk_seconds=0.5,
                absolute_thresh=False,
                max_chunk_seconds=40,
            )

            self._encode_output(converted.astype(np.float32), self.target_sample_rate, Path(output_path))
            log.info(f"💾 SO-VITS: saved {output_path}")
            return True

        except Exception as e:
            log.error(f"❌ SO-VITS conversion failed: {e}")
            import traceback

            traceback.print_exc()
            return False
