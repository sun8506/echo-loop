import re
import os
from pathlib import Path
from urllib.parse import parse_qs, urlparse

MAX_BYTES = 500 * 1024 * 1024
MAX_DURATION_HOURS_DEFAULT = 12


def max_duration_seconds() -> float:
    value = os.getenv("ECHOLOOP_MAX_IMPORT_HOURS", str(MAX_DURATION_HOURS_DEFAULT)).strip()
    try:
        hours = float(value)
    except ValueError as exc:
        raise RuntimeError("ECHOLOOP_MAX_IMPORT_HOURS 必须是数字") from exc
    return 0 if hours <= 0 else min(hours, 168) * 3600


def _check_duration(duration: object) -> None:
    limit = max_duration_seconds()
    actual = float(duration or 0)
    if limit and actual > limit:
        raise RuntimeError(f"视频超过 {limit / 3600:g} 小时限制；可通过 ECHOLOOP_MAX_IMPORT_HOURS 调整，设为 0 表示不限制时长")
YOUTUBE_HOSTS = {"youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"}
BILIBILI_HOSTS = {"bilibili.com", "www.bilibili.com", "m.bilibili.com", "b23.tv"}


def _is_youtube_video(parsed) -> bool:
    host = (parsed.hostname or "").lower()
    if host == "youtu.be":
        return bool(re.fullmatch(r"/[A-Za-z0-9_-]{6,20}/?", parsed.path))
    if host not in YOUTUBE_HOSTS:
        return False
    if parsed.path == "/watch":
        return bool(re.fullmatch(r"[A-Za-z0-9_-]{6,20}", parse_qs(parsed.query).get("v", [""])[0]))
    return bool(re.fullmatch(r"/(shorts|live|embed)/[A-Za-z0-9_-]{6,20}/?", parsed.path))


def _is_bilibili_video(parsed) -> bool:
    host = (parsed.hostname or "").lower()
    if host == "b23.tv":
        return bool(re.fullmatch(r"/[A-Za-z0-9]+/?", parsed.path))
    if host not in BILIBILI_HOSTS:
        return False
    return bool(re.fullmatch(r"/video/(BV[0-9A-Za-z]+|av\d+)/?", parsed.path, re.IGNORECASE))


def validate_source_url(value: str) -> str:
    value = value.strip()
    parsed = urlparse(value)
    host = (parsed.hostname or "").lower()
    safe_request = parsed.scheme == "https" and not parsed.username and not parsed.password
    is_tbs = host == "newsdig.tbs.co.jp" and bool(re.fullmatch(r"/articles/-/\d+/?", parsed.path))
    if not safe_request or not (is_tbs or _is_youtube_video(parsed) or _is_bilibili_video(parsed)):
        raise ValueError("仅支持 TBS NewsDig 正文、YouTube 或 Bilibili 单个视频链接")
    return value


def _download_with_ytdlp(source: str, directory: str, cancel_check=None) -> tuple[Path, dict]:
    import yt_dlp

    options = {
        "outtmpl": str(Path(directory) / "media.%(ext)s"),
        # Prefer a <=720p video/audio pair, then progressively fall back for
        # videos whose uploader/platform does not expose that exact shape.
        "format": "bv*[vcodec^=avc1][height<=720]+ba[ext=m4a]/b[ext=mp4][height<=720]/bv*[height<=720]+ba/b[height<=720]/bv*+ba/b",
        "merge_output_format": "mp4",
        "noplaylist": True,
        "max_filesize": MAX_BYTES,
        # Bilibili CDN nodes occasionally close a large response early. Small
        # ranged requests plus continuation let yt-dlp resume from the last
        # completed block instead of restarting a 40–200 MB stream.
        "http_chunk_size": 4 * 1024 * 1024,
        "continuedl": True,
        "socket_timeout": 60,
        "retries": 12,
        "fragment_retries": 12,
        "extractor_retries": 5,
        "file_access_retries": 5,
        "retry_sleep_functions": {
            "http": lambda n: min(2 ** max(0, n - 1), 15),
            "fragment": lambda n: min(2 ** max(0, n - 1), 15),
            "extractor": lambda n: min(n * 2, 10),
        },
        "quiet": True,
        "no_warnings": True,
        "progress_hooks": ([lambda _: cancel_check()] if cancel_check else []),
    }
    if cancel_check:
        cancel_check()
    with yt_dlp.YoutubeDL(options) as ydl:
        info = ydl.extract_info(source, download=True)
    if not isinstance(info, dict):
        raise RuntimeError("没有取得可用的视频信息")
    _check_duration(info.get("duration"))
    files = [path for path in Path(directory).iterdir() if path.is_file() and not path.name.endswith((".part", ".ytdl"))]
    if len(files) != 1 or not 0 < files[0].stat().st_size <= MAX_BYTES:
        raise RuntimeError("没有取得可用视频，或视频超过 500MB")
    return files[0], info


def download_video(url: str, directory: str, cancel_check=None):
    import requests

    parsed = urlparse(url)
    if cancel_check:
        cancel_check()
    host = (parsed.hostname or "").lower()
    if host in YOUTUBE_HOSTS or host in BILIBILI_HOSTS:
        path, info = _download_with_ytdlp(url, directory, cancel_check)
        title = str(info.get("title") or ("bilibili-video" if host in BILIBILI_HOSTS else "youtube-video"))
    else:
        page = requests.get(url, timeout=20)
        page.raise_for_status()
        match = re.search(r'data-mw-play-id=["\x27]([a-f0-9]{32})', page.text)
        if not match:
            raise RuntimeError("新闻正文中没有找到视频")
        api = f"https://playback.api.streaks.jp/v1/projects/tbsnews-prod/medias/{match.group(1)}"
        streaks_api_key = os.getenv("ECHOLOOP_TBS_STREAKS_API_KEY", "").strip()
        if not streaks_api_key:
            raise RuntimeError("TBS 导入未配置 ECHOLOOP_TBS_STREAKS_API_KEY")
        metadata = requests.get(api, headers={"X-Streaks-Api-Key": streaks_api_key}, timeout=20)
        metadata.raise_for_status()
        media = metadata.json()
        _check_duration(media.get("duration"))
        source = next(
            (item.get("src") for item in media.get("sources") or [] if item.get("src", "").startswith("https://manifest.streaks.jp/")),
            None,
        )
        if not source:
            raise RuntimeError("没有找到受支持的正文视频源")
        path, _ = _download_with_ytdlp(source, directory, cancel_check)
        title = str(media.get("name") or "TBS NewsDig")
    safe = re.sub(r"[^\w\-一-龥ぁ-んァ-ヶ]+", "_", title).strip("_")[:70] or "imported-video"
    return path, f"{safe}{path.suffix.lower()}"
