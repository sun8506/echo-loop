"""Local-only transcription service for EchoLoop."""

from __future__ import annotations

import os
import json
import hashlib
import logging
import mimetypes
import re
import subprocess
import sys
import tempfile
import time
import uuid
import shutil
from urllib.parse import quote
from functools import lru_cache
from pathlib import Path
from typing import Annotated, Literal

from fastapi import BackgroundTasks, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel
from fastapi.middleware.cors import CORSMiddleware
from faster_whisper import WhisperModel
from faster_whisper.audio import decode_audio
from starlette.concurrency import run_in_threadpool
from video_import import download_video, validate_source_url
from learner_api import router as learner_router

ModelName = Literal["tiny", "base", "small"]
ALLOWED_MODELS = {"tiny", "base", "small"}
logger = logging.getLogger("echoloop.whisperx")
NVIDIA_WHISPER_FUNCTION_ID = "b702f636-f60c-4a3d-a6f4-f3568c13bd7d"
NVIDIA_STATUS: dict[str, object] = {"state": "idle", "message": "尚未使用高级模型"}
LOCAL_STATUS: dict[str, object] = {"state": "idle", "message": "尚未开始局部转写"}
NVIDIA_TRACE: dict[str, object] = {"request_id": None, "items": []}

app = FastAPI(title="EchoLoop Local Transcription", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[],
    allow_origin_regex=r"(https?://(localhost|127\.0\.0\.1|tauri\.localhost)(:\d+)?|tauri://localhost)",
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
    expose_headers=["X-EchoLoop-Filename"],
)
app.include_router(learner_router)

class UrlImport(BaseModel): url: str

@app.post('/import/url')
async def import_url(payload:UrlImport,background_tasks:BackgroundTasks):
    try: url=validate_source_url(payload.url)
    except ValueError as exc: raise HTTPException(400,str(exc)) from exc
    directory=tempfile.mkdtemp(prefix='echoloop-url-')
    try:
        path,name=await run_in_threadpool(download_video,url,directory)
        background_tasks.add_task(shutil.rmtree,directory,True)
        media_type = mimetypes.guess_type(name)[0] or "application/octet-stream"
        return FileResponse(path,media_type=media_type,filename=name,headers={'X-EchoLoop-Filename':quote(name,safe='')})
    except Exception as exc:
        shutil.rmtree(directory,ignore_errors=True);logger.exception('URL video import failed')
        clean_error = re.sub(r"\x1b\[[0-9;]*m", "", str(exc))
        raise HTTPException(422,f'网页视频加载失败：{clean_error}') from exc


@lru_cache(maxsize=3)
def get_model(name: str) -> WhisperModel:
    # Some CTranslate2 builds cannot execute int8 efficiently. Prefer it on
    # compatible CPUs, but always retain a portable float32 fallback.
    try:
        return WhisperModel(name, device="cpu", compute_type="int8")
    except ValueError as exc:
        if "compute type" not in str(exc).lower() and "not support" not in str(exc).lower():
            raise
        logger.warning("Local Whisper int8 unavailable; using CPU float32: %s", exc)
        return WhisperModel(name, device="cpu", compute_type="float32")


@app.get("/health")
def health() -> dict[str, object]:
    return {
        "ok": True,
        "features": ["url-import-v1"],
        "provider": "local",
        "models": sorted(ALLOWED_MODELS),
        "whisperx": {"python": str(find_whisperx_python(probe_current=False) or "not found"), "offline": True},
        "nvidia_cloud": {"configured": bool(os.getenv("NVIDIA_API_KEY", "").strip())},
    }


@app.get("/nvidia/status")
def nvidia_status() -> dict[str, object]:
    return dict(NVIDIA_STATUS)


@app.get("/nvidia/trace")
def nvidia_trace() -> dict[str, object]:
    """Return the current job's sanitized NVIDIA request/response trace."""
    return {**NVIDIA_TRACE, "count": len(NVIDIA_TRACE.get("items", []))}


def _set_nvidia_status(**values: object) -> None:
    NVIDIA_STATUS.update(values)


@app.get("/transcribe/status")
def transcribe_status() -> dict[str, object]:
    return dict(LOCAL_STATUS)


def _set_local_status(**values: object) -> None:
    LOCAL_STATUS.update(values)


def _join_cloud_words(words: list[str], language: str) -> str:
    compact = language.lower().startswith(("ja", "zh", "ko"))
    return ("" if compact else " ").join(words).strip()


_SUBTITLE_END_RE = re.compile(r"[。！？.!?…](?:[\"'”’」』）)\]]*)$")


def _subtitle_text(text: object, language: str = "auto") -> str:
    """Normalize an ASR cue and supply a missing sentence-ending mark."""
    normalized = re.sub(r"\s+", " ", str(text or "")).strip()
    if not normalized or _SUBTITLE_END_RE.search(normalized):
        return normalized
    language_code = (language or "auto").lower()
    return normalized + ("。" if language_code.startswith(("ja", "zh")) else ".")


def _natural_cloud_cues(words: list[dict[str, object]], language: str) -> list[dict[str, object]]:
    cues: list[dict[str, object]] = []
    current: list[dict[str, object]] = []
    for word in words:
        if current and float(word["start"]) - float(current[-1]["end"]) >= 0.75:
            text = _join_cloud_words([str(item["text"]) for item in current], language)
            cues.append({"start": current[0]["start"], "end": current[-1]["end"], "text": _subtitle_text(text, language)})
            current = []
        current.append(word)
        text = str(word["text"]).strip()
        duration = float(current[-1]["end"]) - float(current[0]["start"])
        if (text.endswith(("。", "！", "？", ".", "!", "?")) and duration >= 1) or duration >= 12:
            joined = _join_cloud_words([str(item["text"]) for item in current], language)
            cues.append({"start": current[0]["start"], "end": current[-1]["end"], "text": _subtitle_text(joined, language)})
            current = []
    if current:
        joined = _join_cloud_words([str(item["text"]) for item in current], language)
        cues.append({"start": current[0]["start"], "end": current[-1]["end"], "text": _subtitle_text(joined, language)})
    return cues


def _duration_value(value: object) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        text = str(value or "")
        parts = text.split(":")
        try:
            return sum(float(part) * (60 ** index) for index, part in enumerate(reversed(parts)))
        except ValueError:
            return 0


def _decode_longest_audio_stream(path: str, expected_duration: float) -> "object":
    """Decode the audio stream whose declared duration best matches the media."""
    import av
    import numpy as np

    container = av.open(path, mode="r", metadata_errors="ignore")
    streams = list(container.streams.audio)
    if not streams:
        raise RuntimeError("媒体中没有音频流")
    candidates = []
    for stream in streams:
        duration = float(stream.duration * stream.time_base) if stream.duration is not None else 0
        if not duration:
            duration = _duration_value(stream.metadata.get("DURATION"))
        candidates.append((stream, duration))
    if expected_duration > 0 and any(duration for _, duration in candidates):
        selected, _ = min(candidates, key=lambda item: abs(item[1] - expected_duration) if item[1] else float("inf"))
    else:
        selected, _ = max(candidates, key=lambda item: item[1])
    logger.warning(
        "Audio streams=%s; selected stream index=%s",
        [(stream.index, round(duration, 2)) for stream, duration in candidates], selected.index,
    )
    resampler = av.audio.resampler.AudioResampler(format="fltp", layout="mono", rate=16000)
    chunks = []
    for frame in container.decode(selected):
        converted = resampler.resample(frame)
        for output in converted if isinstance(converted, list) else [converted]:
            if output is not None:
                chunks.append(output.to_ndarray().reshape(-1).astype(np.float32, copy=False))
    flushed = resampler.resample(None)
    for output in flushed if isinstance(flushed, list) else [flushed]:
        if output is not None:
            chunks.append(output.to_ndarray().reshape(-1).astype(np.float32, copy=False))
    container.close()
    return np.concatenate(chunks) if chunks else np.empty(0, dtype=np.float32)


def transcribe_with_nvidia_cloud(
    path: str, language: str, request_id: str, expected_duration: float = 0,
    expected_bytes: int = 0,
) -> dict[str, object]:
    api_key = os.getenv("NVIDIA_API_KEY", "").strip()
    if not api_key:
        raise HTTPException(503, "尚未配置高级模型密钥，请在启动后端前设置云端 API Key")
    try:
        _set_nvidia_status(
            state="loading_client", request_id=request_id,
            message="正在加载 NVIDIA Riva 客户端",
        )
        import numpy as np
        import riva.client

        _set_nvidia_status(
            state="decoding", request_id=request_id,
            message="正在解码完整音轨为 16 kHz 单声道",
        )
        decode_started = time.monotonic()
        audio = decode_audio(path, sampling_rate=16000)
        pcm = (np.clip(audio, -1, 1) * 32767).astype("<i2")
        decoded_duration = len(pcm) / 16000
        received_bytes = os.path.getsize(path)
        if expected_duration > 0 and decoded_duration + 2 < expected_duration:
            _set_nvidia_status(
                state="selecting_audio_stream",
                request_id=request_id,
                decoded_seconds=round(decoded_duration, 2),
                message="默认音轨过短，正在用 FFmpeg 选择完整音频流",
            )
            audio = _decode_longest_audio_stream(path, expected_duration)
            pcm = (np.clip(audio, -1, 1) * 32767).astype("<i2")
            decoded_duration = len(pcm) / 16000
        decode_elapsed = round(time.monotonic() - decode_started, 2)
        _set_nvidia_status(
            state="decoded", request_id=request_id,
            decoded_seconds=round(decoded_duration, 2),
            received_bytes=received_bytes,
            expected_bytes=expected_bytes,
            decode_elapsed_seconds=decode_elapsed,
            message=f"音轨解码完成：{decoded_duration:.1f} 秒，耗时 {decode_elapsed} 秒",
        )
        if expected_duration > 0 and decoded_duration + 2 < expected_duration:
            detail = (
                f"后端只收到/解码了 {decoded_duration:.1f} 秒，但浏览器媒体为 "
                f"{expected_duration:.1f} 秒；已停止，避免保存不完整结果"
            )
            logger.error("NVIDIA [%s] duration mismatch: %s", request_id, detail)
            _set_nvidia_status(
                state="error",
                request_id=request_id,
                decoded_seconds=round(decoded_duration, 2),
                expected_seconds=round(expected_duration, 2),
                received_bytes=received_bytes,
                expected_bytes=expected_bytes,
                decode_elapsed_seconds=decode_elapsed,
                message=detail,
            )
            raise HTTPException(
                422,
                detail,
            )
        auth = riva.client.Auth(
            use_ssl=True,
            uri="grpc.nvcf.nvidia.com:443",
            metadata_args=[
                ["function-id", NVIDIA_WHISPER_FUNCTION_ID],
                ["authorization", f"Bearer {api_key}"],
            ],
            options=[
                ("grpc.max_send_message_length", 16 * 1024 * 1024),
                ("grpc.max_receive_message_length", 16 * 1024 * 1024),
            ],
        )
        service = riva.client.ASRService(auth)
        resolved_language = "multi" if language == "auto" else language
        # Hosted Whisper accepts a roughly 30-second audio window. Keep a safe
        # margin so the service never silently truncates the end of a chunk.
        chunk_frames = 25 * 16000
        chunk_count = max(1, (len(pcm) + chunk_frames - 1) // chunk_frames)
        cloud_started = time.monotonic()
        words: list[dict[str, object]] = []
        fallback_results: list[dict[str, object]] = []
        chunks_with_text = 0
        for chunk_index, frame_start in enumerate(range(0, len(pcm), chunk_frames), start=1):
            chunk = pcm[frame_start:frame_start + chunk_frames]
            if not len(chunk):
                continue
            config = riva.client.RecognitionConfig(
                encoding=riva.client.AudioEncoding.LINEAR_PCM,
                sample_rate_hertz=16000,
                audio_channel_count=1,
                language_code=resolved_language,
                max_alternatives=1,
                enable_automatic_punctuation=True,
                enable_word_time_offsets=True,
            )
            logger.warning(
                "NVIDIA [%s] calling grpc.nvcf.nvidia.com chunk %s/%s (%.1fs)",
                request_id, chunk_index, chunk_count, len(chunk) / 16000,
            )
            _set_nvidia_status(
                state="calling",
                request_id=request_id,
                chunk=chunk_index,
                chunks=chunk_count,
                message=f"正在调用 NVIDIA 云端：第 {chunk_index}/{chunk_count} 块",
            )
            chunk_started = time.monotonic()
            response = service.offline_recognize(chunk.tobytes(), config)
            chunk_elapsed = round(time.monotonic() - chunk_started, 2)
            chunk_transcripts = [
                result.alternatives[0].transcript.strip()
                for result in response.results
                if result.alternatives and result.alternatives[0].transcript.strip()
            ]
            chunk_text = " ".join(chunk_transcripts)
            logger.warning(
                "NVIDIA [%s] cloud returned chunk %s/%s in %.2fs, results=%s",
                request_id, chunk_index, chunk_count, chunk_elapsed,
                len(response.results),
            )
            _set_nvidia_status(
                state="returned",
                request_id=request_id,
                chunk=chunk_index,
                chunks=chunk_count,
                returned_characters=len(chunk_text),
                transcript_preview=chunk_text[:120],
                language=resolved_language,
                message=f"NVIDIA 已返回第 {chunk_index}/{chunk_count} 块：{len(chunk_text)} 字（{chunk_elapsed} 秒）",
            )
            offset = frame_start / 16000
            chunk_has_text = False
            for result in response.results:
                if not result.alternatives:
                    continue
                alternative = result.alternatives[0]
                if alternative.transcript.strip() or alternative.words:
                    chunk_has_text = True
                timed = list(alternative.words)
                if timed:
                    for item in timed:
                        words.append({
                            "text": item.word,
                            "start": round(offset + float(item.start_time) / 1000, 3),
                            "end": round(offset + float(item.end_time) / 1000, 3),
                        })
                elif alternative.transcript.strip():
                    fallback_results.append({
                        "start": round(offset, 3),
                        "end": round(offset + len(chunk) / 16000, 3),
                        "text": alternative.transcript.strip(),
                    })
            if chunk_has_text:
                chunks_with_text += 1
        cues = _natural_cloud_cues(words, resolved_language) if words else fallback_results
        if not words and fallback_results:
            logger.warning(
                "NVIDIA [%s] returned transcripts without word timestamps; chunk ranges are not natural sentence boundaries",
                request_id,
            )
        if chunk_count >= 4 and chunks_with_text <= 1:
            raise HTTPException(
                502,
                f"NVIDIA 只返回了 {chunks_with_text}/{chunk_count} 个音频块的文字；已拒绝这个明显不完整的结果",
            )
        elapsed = round(time.monotonic() - cloud_started, 2)
        logger.warning(
            "NVIDIA [%s] verified complete: chunks=%s words=%s cues=%s elapsed=%.2fs",
            request_id, chunk_count, len(words), len(cues), elapsed,
        )
        _set_nvidia_status(
            state="complete",
            request_id=request_id,
            chunk=chunk_count,
            chunks=chunk_count,
            elapsed_seconds=elapsed,
            message=f"NVIDIA 云端处理完成：{chunk_count} 块，{elapsed} 秒",
        )
        return {
            "provider": "nvidia-nim",
            "model": "whisper-large-v3",
            "language": resolved_language,
            "request_id": request_id,
            "cloud_chunks": chunk_count,
            "cloud_chunks_with_text": chunks_with_text,
            "has_word_timestamps": bool(words),
            "cloud_elapsed_seconds": elapsed,
            "decoded_audio_seconds": round(decoded_duration, 2),
            "received_bytes": received_bytes,
            "expected_bytes": expected_bytes,
            "decode_elapsed_seconds": decode_elapsed,
            "cues": cues,
        }
    except HTTPException as exc:
        _set_nvidia_status(state="error", request_id=request_id, message=str(exc.detail))
        raise
    except Exception as exc:
        _set_nvidia_status(state="error", request_id=request_id, message=f"NVIDIA 云端调用失败：{exc}")
        logger.exception("NVIDIA NIM transcription failed")
        raise HTTPException(502, f"NVIDIA 云端解析失败：{exc}") from exc


def transcribe_hybrid(path: str, language: str, model: str, request_id: str) -> dict[str, object]:
    """Use local WhisperX timing, then replace each aligned segment's text with NVIDIA ASR."""
    api_key = os.getenv("NVIDIA_API_KEY", "").strip()
    if not api_key:
        raise HTTPException(503, "尚未配置高级模型密钥")
    local_language = {
        "ja-JP": "ja", "en-US": "en", "zh-CN": "zh", "ko-KR": "ko",
        "fr-FR": "fr", "de-DE": "de", "es-ES": "es",
    }.get(language, "auto" if language in {"auto", "multi"} else language)
    _set_nvidia_status(
        state="local_aligning", request_id=request_id,
        message=f"第一阶段：本地 WhisperX {model} 正在生成自然句时间戳",
    )
    aligned = transcribe_with_whisperx(path, local_language, model)
    timed_segments = [
        item for item in aligned.get("segments", [])
        if str(item.get("text", "")).strip() and float(item.get("end", 0)) > float(item.get("start", 0))
    ]
    if not timed_segments:
        raise HTTPException(502, "本地 WhisperX 没有生成可用的时间戳片段")

    import numpy as np
    import riva.client
    from google.protobuf.json_format import MessageToDict
    audio = decode_audio(path, sampling_rate=16000)
    pcm = (np.clip(audio, -1, 1) * 32767).astype("<i2")
    auth = riva.client.Auth(
        use_ssl=True,
        uri="grpc.nvcf.nvidia.com:443",
        metadata_args=[
            ["function-id", NVIDIA_WHISPER_FUNCTION_ID],
            ["authorization", f"Bearer {api_key}"],
        ],
        options=[
            ("grpc.max_send_message_length", 16 * 1024 * 1024),
            ("grpc.max_receive_message_length", 16 * 1024 * 1024),
        ],
    )
    service = riva.client.ASRService(auth)
    cloud_language = "multi" if language in {"auto", "multi"} else language
    cues: list[dict[str, object]] = []
    started = time.monotonic()
    total = len(timed_segments)
    for index, item in enumerate(timed_segments, start=1):
        start = max(0.0, float(item["start"]))
        end = min(len(pcm) / 16000, float(item["end"]))
        # Preserve enough acoustic context around an alignment edge without
        # turning the neighboring sentence into a duplicate transcript.
        clip_start = max(0.0, start - 0.5)
        clip_end = min(len(pcm) / 16000, end + 0.5)
        clip = pcm[int(clip_start * 16000):int(clip_end * 16000)]
        _set_nvidia_status(
            state="cloud_refining", request_id=request_id, chunk=index, chunks=total,
            message=f"第二阶段：高级模型正在校正自然句 {index}/{total}",
        )
        config = riva.client.RecognitionConfig(
            encoding=riva.client.AudioEncoding.LINEAR_PCM,
            sample_rate_hertz=16000,
            audio_channel_count=1,
            language_code=cloud_language,
            max_alternatives=1,
            enable_automatic_punctuation=True,
            enable_word_time_offsets=False,
        )
        audio_bytes = clip.tobytes()
        trace_item: dict[str, object] = {
            "sequence": index,
            "request": {
                "endpoint": "grpc.nvcf.nvidia.com:443",
                "function_id": NVIDIA_WHISPER_FUNCTION_ID,
                "authorization": "Bearer ***",
                "segment_start": round(start, 3),
                "segment_end": round(end, 3),
                "context_start": round(clip_start, 3),
                "context_end": round(clip_end, 3),
                "audio_bytes": len(audio_bytes),
                "audio_sha256": hashlib.sha256(audio_bytes).hexdigest(),
                "config": {
                    "encoding": "LINEAR_PCM", "sample_rate_hertz": 16000,
                    "audio_channel_count": 1, "language_code": cloud_language,
                    "max_alternatives": 1, "enable_automatic_punctuation": True,
                    "enable_word_time_offsets": False,
                },
                "whisperx_text_before_refine": str(item["text"]).strip(),
            },
        }
        call_started = time.monotonic()
        try:
            response = service.offline_recognize(audio_bytes, config)
            trace_item["elapsed_seconds"] = round(time.monotonic() - call_started, 3)
            trace_item["response"] = MessageToDict(
                response, preserving_proto_field_name=True,
            )
        except Exception as exc:
            trace_item["elapsed_seconds"] = round(time.monotonic() - call_started, 3)
            trace_item["error"] = {"type": type(exc).__name__, "message": str(exc)}
            NVIDIA_TRACE.setdefault("items", []).append(trace_item)
            raise
        NVIDIA_TRACE.setdefault("items", []).append(trace_item)
        cloud_text = " ".join(
            result.alternatives[0].transcript.strip()
            for result in response.results
            if result.alternatives and result.alternatives[0].transcript.strip()
        ).strip()
        local_text = str(item["text"]).strip()
        compact_local = re.sub(r"[\s。、，！？.!?]", "", local_text)
        compact_cloud = re.sub(r"[\s。、，！？.!?]", "", cloud_text)
        length_ratio = len(compact_cloud) / max(1, len(compact_local))
        local_complete = local_text.endswith(("。", "！", "？", ".", "!", "?"))
        cloud_complete = cloud_text.endswith(("。", "！", "？", ".", "!", "?"))
        cloud_accepted = bool(cloud_text) and 0.72 <= length_ratio <= 1.45 and not (local_complete and not cloud_complete)
        selected_text = cloud_text if cloud_accepted else local_text
        trace_item["quality_check"] = {
            "cloud_to_local_length_ratio": round(length_ratio, 3),
            "local_complete": local_complete,
            "cloud_complete": cloud_complete,
            "cloud_accepted": cloud_accepted,
            "fallback_reason": None if cloud_accepted else "NVIDIA text incomplete or length differs too much",
        }
        trace_item["selected_transcript"] = selected_text
        cues.append({
            "start": round(start, 3), "end": round(end, 3),
            "text": selected_text,
            "source": "nvidia" if cloud_accepted else "whisperx-fallback",
        })
    elapsed = round(time.monotonic() - started, 2)
    _set_nvidia_status(
        state="complete", request_id=request_id, chunk=total, chunks=total,
        elapsed_seconds=elapsed,
        message=f"混合解析完成：本地时间戳 + 高级模型原文，共 {total} 句",
    )
    return {
        "provider": "whisperx+nvidia-nim", "model": f"{model}+whisper-large-v3",
        "language": cloud_language, "device": aligned.get("device", "cpu"),
        "request_id": request_id, "cloud_chunks": total,
        "cloud_elapsed_seconds": elapsed, "has_word_timestamps": True, "cues": cues,
    }


def find_whisperx_python(probe_current: bool = True) -> Path | None:
    configured = os.getenv("ECHOLOOP_WHISPERX_PYTHON", "").strip()
    candidates = [
        Path(configured) if configured else None,
        Path("/projects/temp/myenv/bin/python"),
        Path(r"T:\projects\temp\.venv\Scripts\python.exe"),
        Path(r"T:\projects\temp\venv\Scripts\python.exe"),
        Path(r"T:\projects\temp\python.exe"),
    ]
    for candidate in candidates:
        if candidate and candidate.is_file():
            return candidate
    if not probe_current:
        return None
    # This also supports starting the API itself from the existing WhisperX environment.
    try:
        probe = subprocess.run(
            [sys.executable, "-c", "import whisperx"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=10,
            check=False,
        )
        if probe.returncode == 0:
            return Path(sys.executable)
    except (OSError, subprocess.SubprocessError):
        pass
    return None


def transcribe_with_whisperx(path: str, language: str, model: str = "tiny") -> dict[str, object]:
    python = find_whisperx_python()
    if not python:
        raise HTTPException(
            503,
            r"未找到 WhisperX Python。请设置 ECHOLOOP_WHISPERX_PYTHON，例如 T:\projects\temp\.venv\Scripts\python.exe",
        )
    runner = Path(__file__).with_name("whisperx_runner.py")
    command = [str(python), str(runner), path, "--language", language, "--model", model]
    environment = os.environ.copy()
    environment.setdefault("TORCH_HOME", "/projects/temp/.cache/torch")
    environment.setdefault("MPLCONFIGDIR", "/projects/temp/.cache/matplotlib")
    completed = subprocess.run(
        command,
        stdout=subprocess.PIPE,
        # Keep WhisperX/CUDA diagnostics visible in the backend terminal.
        stderr=None,
        text=True,
        encoding="utf-8",
        timeout=3600,
        check=False,
        env=environment,
    )
    output = completed.stdout.strip().splitlines()
    stderr_tail = completed.stderr.strip()[-2000:] if completed.stderr else ""
    try:
        payload = json.loads(output[-1]) if output else {}
    except json.JSONDecodeError as exc:
        detail = stderr_tail or completed.stdout.strip()[-2000:] or "没有输出"
        logger.error("WhisperX returned invalid JSON: %s", detail)
        raise HTTPException(500, f"WhisperX 返回格式错误：{detail[-500:]}") from exc
    if completed.returncode != 0 or payload.get("error"):
        detail = payload.get("error") or stderr_tail[-500:] or "未知错误"
        logger.error("WhisperX failed (exit %s): %s", completed.returncode, detail)
        raise HTTPException(500, f"WhisperX 离线解析失败：{detail}")
    logger.warning(
        "WhisperX completed with device=%s model=%s segments=%s",
        payload.get("device"),
        payload.get("model"),
        len(payload.get("segments", [])),
    )
    return payload


@app.post("/segment/whisperx")
async def segment_with_whisperx(
    media: Annotated[UploadFile, File()],
    language: Annotated[str, Form()] = "auto",
    model: Annotated[ModelName, Form()] = "tiny",
) -> dict[str, object]:
    if model not in ALLOWED_MODELS:
        raise HTTPException(400, "Unsupported WhisperX model")
    suffix = Path(media.filename or "media.bin").suffix or ".bin"
    temp_path = ""
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as target:
            temp_path = target.name
            while chunk := await media.read(1024 * 1024):
                target.write(chunk)

        logger.info("WhisperX natural segmentation started: file=%s model=%s", media.filename, model)
        payload = transcribe_with_whisperx(temp_path, language, model)
        natural = []
        for item in payload["segments"]:
            start = max(0.0, float(item["start"]))
            end = max(start, float(item["end"]))
            text = str(item["text"]).strip()
            if not text or end <= start:
                continue
            # The player requires selectable ranges of at least one second.
            if natural and end - start < 1:
                natural[-1]["end"] = round(end, 3)
                natural[-1]["text"] = f'{natural[-1]["text"]} {text}'.strip()
            else:
                natural.append({"start": round(start, 3), "end": round(max(end, start + 1), 3), "text": text})

        resolved_language = str(payload.get("language") or language)
        for item in natural:
            item["text"] = _subtitle_text(item["text"], resolved_language)

        return {
            "provider": "whisperx-local",
            "model": payload["model"],
            "language": payload["language"],
            "device": payload["device"],
            "segments": [
                {"id": index, "start": item["start"], "end": item["end"]}
                for index, item in enumerate(natural, start=1)
            ],
            "cues": [
                {"id": index, "start": item["start"], "end": item["end"], "text": item["text"]}
                for index, item in enumerate(natural, start=1)
            ],
        }
    except HTTPException:
        raise
    except subprocess.TimeoutExpired as exc:
        logger.exception("WhisperX timed out after one hour")
        raise HTTPException(504, "WhisperX 处理超过 1 小时；请改用 tiny 或缩短媒体") from exc
    except Exception as exc:
        logger.exception("WhisperX natural segmentation failed")
        raise HTTPException(500, f"WhisperX natural segmentation failed: {exc}") from exc
    finally:
        await media.close()
        if temp_path:
            try:
                os.unlink(temp_path)
            except FileNotFoundError:
                pass


@app.post("/segment/nvidia")
async def segment_with_nvidia(
    media: Annotated[UploadFile, File()],
    language: Annotated[str, Form()] = "auto",
    model: Annotated[ModelName, Form()] = "tiny",
    expected_duration: Annotated[float, Form()] = 0,
    expected_bytes: Annotated[int, Form()] = 0,
) -> dict[str, object]:
    suffix = Path(media.filename or "media.bin").suffix or ".bin"
    temp_path = ""
    request_id = uuid.uuid4().hex[:8]
    try:
        NVIDIA_TRACE.clear()
        NVIDIA_TRACE.update({"request_id": request_id, "started_at": time.time(), "items": []})
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as target:
            temp_path = target.name
            while chunk := await media.read(1024 * 1024):
                target.write(chunk)
        logger.warning("NVIDIA [%s] request accepted: file=%s", request_id, media.filename)
        _set_nvidia_status(state="accepted", request_id=request_id, message="后端已收到音频，准备本地时间戳分析")
        payload = await run_in_threadpool(
            transcribe_hybrid, temp_path, language, model, request_id,
        )
        cues = [
            {
                "id": index,
                "start": round(float(item["start"]), 3),
                "end": round(max(float(item["end"]), float(item["start"]) + 1), 3),
                "text": _subtitle_text(item["text"], str(payload.get("language") or language)),
            }
            for index, item in enumerate(payload["cues"], start=1)
            if str(item["text"]).strip()
        ]
        return {
            **payload,
            "segments": [{"id": item["id"], "start": item["start"], "end": item["end"]} for item in cues],
            "cues": cues,
        }
    except HTTPException as exc:
        _set_nvidia_status(state="error", request_id=request_id, message=str(exc.detail))
        raise
    except Exception as exc:
        logger.exception("NVIDIA natural segmentation failed")
        raise HTTPException(500, f"高级模型自然切分失败：{exc}") from exc
    finally:
        await media.close()
        if temp_path:
            try:
                os.unlink(temp_path)
            except FileNotFoundError:
                pass


@app.post("/transcribe")
async def transcribe(
    media: Annotated[UploadFile, File()],
    model: Annotated[ModelName, Form()] = "tiny",
    language: Annotated[str, Form()] = "auto",
    start: Annotated[float, Form()] = 0,
    end: Annotated[float, Form()] = 0,
) -> dict[str, object]:
    if model not in ALLOWED_MODELS:
        raise HTTPException(400, "Unsupported local model")
    if start < 0 or end <= start:
        raise HTTPException(400, "A valid selected time range is required")
    if end - start > 180:
        raise HTTPException(400, "Selected range is too long")
    suffix = Path(media.filename or "media.bin").suffix or ".bin"
    temp_path = ""
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as target:
            temp_path = target.name
            while chunk := await media.read(1024 * 1024):
                target.write(chunk)

        request_id = uuid.uuid4().hex[:8]
        _set_local_status(
            state="loading_model", request_id=request_id, model=model,
            message=f"正在加载本地 Whisper {model}；首次使用可能需要下载模型",
        )
        whisper = await run_in_threadpool(get_model, model)
        _set_local_status(
            state="decoding", request_id=request_id, model=model,
            message="模型已加载，正在解码所选音频",
        )
        sampling_rate = 16000
        full_audio = await run_in_threadpool(decode_audio, temp_path, sampling_rate)
        clip = full_audio[int(start * sampling_rate):int(end * sampling_rate)]
        if clip.size == 0:
            raise HTTPException(400, "Selected range contains no decodable audio")
        _set_local_status(
            state="transcribing", request_id=request_id, model=model,
            duration=round(end - start, 2), message=f"正在用本地 Whisper {model} 推理",
        )
        def run_inference():
            generated, detected = whisper.transcribe(
                clip,
                language=None if language == "auto" else language,
                beam_size=5,
                vad_filter=False,
                word_timestamps=True,
                condition_on_previous_text=False,
            )
            return list(generated), detected
        result, info = await run_in_threadpool(run_inference)
        cues = [
            {
                "id": index,
                "start": round(item.start + start, 3),
                "end": round(item.end + start, 3),
                "text": _subtitle_text(item.text, info.language),
            }
            for index, item in enumerate(result, start=1)
            if item.text.strip()
        ]
        payload = {
            "provider": "local",
            "model": model,
            "language": info.language,
            "language_probability": round(info.language_probability, 4),
            "duration": round(end - start, 3),
            "range": {"start": start, "end": end},
            "cues": cues,
        }
        _set_local_status(
            state="complete", request_id=request_id, model=model,
            cues=len(cues), message=f"局部转写完成：返回 {len(cues)} 条原文",
        )
        return payload
    except HTTPException:
        raise
    except Exception as exc:
        _set_local_status(state="error", message=f"局部转写失败：{exc}")
        logger.exception("Local transcription failed")
        raise HTTPException(500, f"Local transcription failed: {exc}") from exc
    finally:
        await media.close()
        if temp_path:
            try:
                os.unlink(temp_path)
            except FileNotFoundError:
                pass
