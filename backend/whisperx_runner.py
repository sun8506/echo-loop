"""Run WhisperX inside its own Python environment and print one JSON result."""

from __future__ import annotations

import argparse
import json
import os
import re
import sys

# WhisperX ships its Pyannote VAD weights, but torch still requires a writable
# cache directory while loading them. Keep these generated files with the
# already installed WhisperX environment rather than under /root.
_runtime_cache = "/projects/temp/.cache"
os.makedirs(_runtime_cache, exist_ok=True)
os.environ.setdefault("TORCH_HOME", os.path.join(_runtime_cache, "torch"))
os.environ.setdefault("MPLCONFIGDIR", os.path.join(_runtime_cache, "matplotlib"))


def _join_words(words: list[str], language: str) -> str:
    if language.startswith(("ja", "zh", "ko")):
        return "".join(words).strip()
    return " ".join(word.strip() for word in words if word.strip()).strip()


def _short_aligned_segments(segments: list[dict], language: str) -> list[dict]:
    """Create punctuation-aware segments capped at 15 seconds for cloud refinement."""
    output: list[dict] = []
    for segment in segments:
        timed_words = [
            word for word in segment.get("words", [])
            if word.get("start") is not None and word.get("end") is not None and str(word.get("word", "")).strip()
        ]
        if timed_words:
            current: list[dict] = []
            for word in timed_words:
                current.append(word)
                duration = float(current[-1]["end"]) - float(current[0]["start"])
                token = str(word.get("word", "")).strip()
                if (token.endswith(("。", "！", "？", ".", "!", "?")) and duration >= 1) or duration >= 15:
                    output.append({
                        "start": float(current[0]["start"]),
                        "end": float(current[-1]["end"]),
                        "text": _join_words([str(item["word"]) for item in current], language),
                    })
                    current = []
            if current:
                output.append({
                    "start": float(current[0]["start"]),
                    "end": float(current[-1]["end"]),
                    "text": _join_words([str(item["word"]) for item in current], language),
                })
            continue

        # Alignment can be unavailable offline. Preserve complete sentences and
        # estimate their ranges proportionally instead of sending a 20–30s block.
        text = str(segment.get("text", "")).strip()
        start = float(segment.get("start", 0))
        end = float(segment.get("end", start))
        sentences = [part.strip() for part in re.findall(r".*?(?:[。！？.!?]+|$)", text) if part.strip()]
        if not sentences:
            continue
        total_chars = max(1, sum(len(part) for part in sentences))
        cursor = start
        for index, sentence in enumerate(sentences):
            sentence_end = end if index == len(sentences) - 1 else cursor + (end - start) * len(sentence) / total_chars
            # Extra-long punctuation-free text is divided by time/character ratio.
            pieces = max(1, int((sentence_end - cursor + 14.999) // 15))
            for piece in range(pieces):
                char_start = round(len(sentence) * piece / pieces)
                char_end = round(len(sentence) * (piece + 1) / pieces)
                piece_start = cursor + (sentence_end - cursor) * piece / pieces
                piece_end = cursor + (sentence_end - cursor) * (piece + 1) / pieces
                output.append({"start": piece_start, "end": piece_end, "text": sentence[char_start:char_end]})
            cursor = sentence_end
    return [item for item in output if item["text"] and item["end"] > item["start"]]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("media")
    parser.add_argument("--model", default=os.getenv("ECHOLOOP_WHISPERX_MODEL", "tiny"))
    parser.add_argument("--model-dir", default=os.getenv("ECHOLOOP_WHISPERX_MODEL_DIR", ""))
    parser.add_argument("--language", default="auto")
    args = parser.parse_args()

    try:
        import torch
        import whisperx
        from faster_whisper.audio import decode_audio

        cuda_available = torch.cuda.is_available()
        cuda_capability = torch.cuda.get_device_capability(0) if cuda_available else (0, 0)
        # Current Torch/CTranslate2 builds no longer support the Maxwell sm_50
        # GPU in this machine. Treat it as CPU instead of selecting CUDA merely
        # because torch.cuda.is_available() happens to return True.
        device = "cuda" if cuda_available and cuda_capability[0] >= 7 else "cpu"
        print(
            f"EchoLoop WhisperX runtime: device={device}, gpu={torch.cuda.get_device_name(0) if device == 'cuda' else 'none'}",
            file=sys.stderr,
            flush=True,
        )
        model_kwargs = {
            "local_files_only": True,
            "language": None if args.language == "auto" else args.language,
        }
        if args.model_dir:
            model_kwargs["download_root"] = args.model_dir

        compute_candidates = ["float16", "float32"] if device == "cuda" else ["int8", "float32"]
        model = None
        compute_errors = []
        compute_type = ""
        for candidate in compute_candidates:
            try:
                model = whisperx.load_model(args.model, device, compute_type=candidate, **model_kwargs)
                compute_type = candidate
                break
            except Exception as exc:
                compute_errors.append(f"{candidate}: {exc}")
                if "compute type" not in str(exc).lower() and "not support" not in str(exc).lower():
                    raise
                print(f"WhisperX {candidate} unavailable, falling back: {exc}", file=sys.stderr, flush=True)
        if model is None:
            raise RuntimeError("; ".join(compute_errors))
        print(f"EchoLoop WhisperX compute_type={compute_type}", file=sys.stderr, flush=True)
        # PyAV decoding avoids WhisperX's ffmpeg executable dependency. The
        # browser normally submits WAV clips, while this also supports media
        # formats handled by the installed PyAV build.
        audio = decode_audio(args.media, sampling_rate=16000)
        result = model.transcribe(
            audio,
            batch_size=1,
        )

        language = result.get("language") or (None if args.language == "auto" else args.language) or "unknown"
        segments = result.get("segments", [])
        aligned = False
        alignment_warning = ""
        if segments and language != "unknown":
            try:
                align_kwargs = {"language_code": language, "device": device, "model_cache_only": True}
                if args.model_dir:
                    align_kwargs["model_dir"] = args.model_dir
                align_model, metadata = whisperx.load_align_model(**align_kwargs)
                result = whisperx.align(
                    segments,
                    align_model,
                    metadata,
                    audio,
                    device,
                    return_char_alignments=False,
                )
                segments = result.get("segments", segments)
                aligned = True
            except Exception as exc:
                # Natural segmentation still comes from WhisperX ASR/VAD. An alignment
                # model is optional here and must never be downloaded implicitly.
                alignment_warning = str(exc)

        short_segments = _short_aligned_segments(segments, language)
        payload = {
            "language": language,
            "device": device,
            "model": args.model,
            "compute_type": compute_type,
            "aligned": aligned,
            "alignment_warning": alignment_warning,
            "segments": [
                {
                    "start": float(item.get("start", 0)),
                    "end": float(item.get("end", item.get("start", 0))),
                    "text": str(item.get("text", "")).strip(),
                }
                for item in short_segments
                if str(item.get("text", "")).strip()
            ],
        }
        print(json.dumps(payload, ensure_ascii=False))
    except Exception as exc:
        print(json.dumps({"error": str(exc)}, ensure_ascii=False))
        raise SystemExit(1) from exc


if __name__ == "__main__":
    main()
