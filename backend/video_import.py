import re
import os
from pathlib import Path
from urllib.parse import parse_qs, urlparse

MAX_BYTES = 500 * 1024 * 1024
MAX_DURATION = 7200
YOUTUBE_HOSTS = {"youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"}


def _is_youtube_video(parsed) -> bool:
    host = (parsed.hostname or "").lower()
    if host == "youtu.be":
        return bool(re.fullmatch(r"/[A-Za-z0-9_-]{6,20}/?", parsed.path))
    if host not in YOUTUBE_HOSTS:
        return False
    if parsed.path == "/watch":
        return bool(re.fullmatch(r"[A-Za-z0-9_-]{6,20}", parse_qs(parsed.query).get("v", [""])[0]))
    return bool(re.fullmatch(r"/(shorts|live|embed)/[A-Za-z0-9_-]{6,20}/?", parsed.path))


def validate_source_url(value: str) -> str:
    value = value.strip()
    parsed = urlparse(value)
    host = (parsed.hostname or "").lower()
    safe_request = parsed.scheme == "https" and not parsed.username and not parsed.password
    is_tbs = host == "newsdig.tbs.co.jp" and bool(re.fullmatch(r"/articles/-/\d+/?", parsed.path))
    if not safe_request or not (is_tbs or _is_youtube_video(parsed)):
        raise ValueError("仅支持 TBS NewsDig 正文或 YouTube 单个视频链接")
    return value


def _download_with_ytdlp(source: str, directory: str) -> tuple[Path, dict]:
    import yt_dlp

    options = {
        "outtmpl": str(Path(directory) / "media.%(ext)s"),
        # Prefer a <=720p video/audio pair, then progressively fall back for
        # videos whose uploader/platform does not expose that exact shape.
        "format": "bv*[height<=720]+ba/b[height<=720]/bv*+ba/b",
        "merge_output_format": "mp4",
        "noplaylist": True,
        "max_filesize": MAX_BYTES,
        "socket_timeout": 20,
        "retries": 2,
        "fragment_retries": 2,
        "quiet": True,
        "no_warnings": True,
    }
    with yt_dlp.YoutubeDL(options) as ydl:
        info = ydl.extract_info(source, download=True)
    if not isinstance(info, dict):
        raise RuntimeError("没有取得可用的视频信息")
    if float(info.get("duration") or 0) > MAX_DURATION:
        raise RuntimeError("视频超过 2 小时限制")
    files = [path for path in Path(directory).iterdir() if path.is_file() and not path.name.endswith((".part", ".ytdl"))]
    if len(files) != 1 or not 0 < files[0].stat().st_size <= MAX_BYTES:
        raise RuntimeError("没有取得可用视频，或视频超过 500MB")
    return files[0], info


def download_video(url: str, directory: str):
    import requests

    parsed = urlparse(url)
    if (parsed.hostname or "").lower() in YOUTUBE_HOSTS:
        path, info = _download_with_ytdlp(url, directory)
        title = str(info.get("title") or "youtube-video")
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
        if float(media.get("duration") or 0) > MAX_DURATION:
            raise RuntimeError("视频超过 2 小时限制")
        source = next(
            (item.get("src") for item in media.get("sources") or [] if item.get("src", "").startswith("https://manifest.streaks.jp/")),
            None,
        )
        if not source:
            raise RuntimeError("没有找到受支持的正文视频源")
        path, _ = _download_with_ytdlp(source, directory)
        title = str(media.get("name") or "TBS NewsDig")
    safe = re.sub(r"[^\w\-一-龥ぁ-んァ-ヶ]+", "_", title).strip("_")[:70] or "imported-video"
    return path, f"{safe}{path.suffix.lower()}"
