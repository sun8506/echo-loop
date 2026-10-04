from __future__ import annotations

import hashlib
import hmac
import json
import os
import re
import secrets
import sqlite3
import time
import uuid
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, Header, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

router = APIRouter(tags=["learner"])


def _database_path() -> Path:
    configured = os.getenv("ECHOLOOP_DB_PATH", "").strip()
    return Path(configured) if configured else Path(__file__).parent / "data" / "echoloop.db"


def _connect() -> sqlite3.Connection:
    path = _database_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(path, timeout=10)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys=ON")
    connection.execute("PRAGMA busy_timeout=10000")
    connection.execute("PRAGMA journal_mode=WAL")
    connection.executescript(
        """
        CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            email TEXT NOT NULL UNIQUE,
            display_name TEXT NOT NULL,
            password_hash TEXT NOT NULL,
            created_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS sessions (
            token_hash TEXT PRIMARY KEY,
            user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            expires_at INTEGER NOT NULL,
            created_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS learning_progress (
            user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            course_id TEXT NOT NULL,
            position REAL NOT NULL DEFAULT 0,
            speed REAL NOT NULL DEFAULT 1,
            completed_cues TEXT NOT NULL DEFAULT '[]',
            bookmarked_cues TEXT NOT NULL DEFAULT '[]',
            total_seconds INTEGER NOT NULL DEFAULT 0,
            updated_at INTEGER NOT NULL,
            PRIMARY KEY (user_id, course_id)
        );
        CREATE TABLE IF NOT EXISTS learning_events (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            course_id TEXT NOT NULL,
            learned_seconds INTEGER NOT NULL,
            created_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS feedback (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            course_id TEXT NOT NULL,
            category TEXT NOT NULL,
            message TEXT NOT NULL,
            position REAL NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL,
            status TEXT NOT NULL DEFAULT 'new'
        );
        CREATE TABLE IF NOT EXISTS published_courses (
            id TEXT PRIMARY KEY, title TEXT NOT NULL, manifest TEXT NOT NULL, visibility TEXT NOT NULL,
            allowed_emails TEXT NOT NULL DEFAULT '[]', expires_at INTEGER, media_path TEXT NOT NULL,
            media_type TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
        );
        """
    )
    return connection


def _password_hash(password: str, salt: bytes | None = None) -> str:
    actual_salt = salt or secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), actual_salt, 240_000)
    return f"pbkdf2_sha256$240000${actual_salt.hex()}${digest.hex()}"


def _password_matches(password: str, encoded: str) -> bool:
    try:
        algorithm, rounds, salt, expected = encoded.split("$", 3)
        if algorithm != "pbkdf2_sha256" or int(rounds) != 240_000:
            return False
        actual = _password_hash(password, bytes.fromhex(salt)).rsplit("$", 1)[1]
        return hmac.compare_digest(actual, expected)
    except (ValueError, TypeError):
        return False


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _new_session(connection: sqlite3.Connection, user_id: str) -> str:
    token = secrets.token_urlsafe(32)
    now = int(time.time())
    connection.execute(
        "INSERT INTO sessions(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)",
        (_token_hash(token), user_id, now + 30 * 24 * 3600, now),
    )
    return token


def _public_user(row: sqlite3.Row) -> dict[str, object]:
    return {"id": row["id"], "email": row["email"], "displayName": row["display_name"]}


def current_user(authorization: Annotated[str | None, Header()] = None) -> dict[str, object]:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "请先登录")
    token = authorization[7:].strip()
    with _connect() as connection:
        row = connection.execute(
            """SELECT users.* FROM sessions JOIN users ON users.id=sessions.user_id
               WHERE sessions.token_hash=? AND sessions.expires_at>?""",
            (_token_hash(token), int(time.time())),
        ).fetchone()
    if not row:
        raise HTTPException(401, "登录状态已过期，请重新登录")
    return _public_user(row)


class RegisterRequest(BaseModel):
    email: str
    displayName: str
    password: str


class LoginRequest(BaseModel):
    email: str
    password: str


class ProgressRequest(BaseModel):
    position: float = 0
    speed: float = 1
    completedCueIds: list[int] = Field(default_factory=list)
    bookmarkedCueIds: list[int] = Field(default_factory=list)
    learnedSeconds: int = 0
    eventId: str | None = None


class FeedbackRequest(BaseModel):
    courseId: str
    category: str = "general"
    message: str
    position: float = 0


@router.post("/auth/register")
def register(payload: RegisterRequest) -> dict[str, object]:
    email = payload.email.strip().lower()
    name = payload.displayName.strip()
    if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", email):
        raise HTTPException(400, "请输入有效邮箱")
    if not 2 <= len(name) <= 40:
        raise HTTPException(400, "用户名需要 2–40 个字符")
    if len(payload.password) < 8:
        raise HTTPException(400, "密码至少需要 8 个字符")
    user_id = uuid.uuid4().hex
    now = int(time.time())
    try:
        with _connect() as connection:
            connection.execute(
                "INSERT INTO users(id,email,display_name,password_hash,created_at) VALUES(?,?,?,?,?)",
                (user_id, email, name, _password_hash(payload.password), now),
            )
            token = _new_session(connection, user_id)
            row = connection.execute("SELECT * FROM users WHERE id=?", (user_id,)).fetchone()
    except sqlite3.IntegrityError as exc:
        raise HTTPException(409, "该邮箱已经注册") from exc
    return {"token": token, "user": _public_user(row)}


@router.post("/auth/login")
def login(payload: LoginRequest) -> dict[str, object]:
    with _connect() as connection:
        row = connection.execute("SELECT * FROM users WHERE email=?", (payload.email.strip().lower(),)).fetchone()
        if not row or not _password_matches(payload.password, row["password_hash"]):
            raise HTTPException(401, "邮箱或密码错误")
        token = _new_session(connection, row["id"])
    return {"token": token, "user": _public_user(row)}


@router.get("/auth/me")
def me(user: Annotated[dict[str, object], Depends(current_user)]) -> dict[str, object]:
    return {"user": user}


@router.post("/auth/logout")
def logout(authorization: Annotated[str | None, Header()] = None) -> dict[str, bool]:
    if authorization and authorization.startswith("Bearer "):
        with _connect() as connection:
            connection.execute("DELETE FROM sessions WHERE token_hash=?", (_token_hash(authorization[7:].strip()),))
    return {"ok": True}


def _progress_payload(row: sqlite3.Row | None, course_id: str) -> dict[str, object]:
    if not row:
        return {"courseId": course_id, "position": 0, "speed": 1, "completedCueIds": [], "bookmarkedCueIds": [], "totalSeconds": 0}
    return {
        "courseId": course_id,
        "position": row["position"],
        "speed": row["speed"],
        "completedCueIds": json.loads(row["completed_cues"]),
        "bookmarkedCueIds": json.loads(row["bookmarked_cues"]),
        "totalSeconds": row["total_seconds"],
        "updatedAt": row["updated_at"],
    }


@router.get("/learning/progress/{course_id:path}")
def get_progress(course_id: str, user: Annotated[dict[str, object], Depends(current_user)]) -> dict[str, object]:
    with _connect() as connection:
        row = connection.execute(
            "SELECT * FROM learning_progress WHERE user_id=? AND course_id=?", (user["id"], course_id)
        ).fetchone()
    return _progress_payload(row, course_id)


@router.post("/learning/progress/{course_id:path}")
def save_progress(payload: ProgressRequest, course_id: str, user: Annotated[dict[str, object], Depends(current_user)]) -> dict[str, object]:
    if not course_id or len(course_id) > 300:
        raise HTTPException(400, "课程ID无效")
    learned_seconds = max(0, min(int(payload.learnedSeconds), 300))
    now = int(time.time())
    with _connect() as connection:
        if learned_seconds:
            if not payload.eventId:
                raise HTTPException(400, "学习时间记录缺少事件ID")
            cursor = connection.execute(
                "INSERT OR IGNORE INTO learning_events(id,user_id,course_id,learned_seconds,created_at) VALUES(?,?,?,?,?)",
                (payload.eventId, user["id"], course_id, learned_seconds, now),
            )
            if cursor.rowcount == 0:
                learned_seconds = 0
        connection.execute(
            """INSERT INTO learning_progress
               (user_id,course_id,position,speed,completed_cues,bookmarked_cues,total_seconds,updated_at)
               VALUES(?,?,?,?,?,?,?,?)
               ON CONFLICT(user_id,course_id) DO UPDATE SET
                 position=excluded.position, speed=excluded.speed,
                 completed_cues=excluded.completed_cues, bookmarked_cues=excluded.bookmarked_cues,
                 total_seconds=learning_progress.total_seconds+excluded.total_seconds,
                 updated_at=excluded.updated_at""",
            (
                user["id"], course_id, max(0, payload.position), max(0.5, min(payload.speed, 2)),
                json.dumps(sorted(set(payload.completedCueIds))), json.dumps(sorted(set(payload.bookmarkedCueIds))),
                learned_seconds, now,
            ),
        )
        row = connection.execute(
            "SELECT * FROM learning_progress WHERE user_id=? AND course_id=?", (user["id"], course_id)
        ).fetchone()
    return _progress_payload(row, course_id)


@router.get("/learning/stats")
def learning_stats(user: Annotated[dict[str, object], Depends(current_user)]) -> dict[str, object]:
    with _connect() as connection:
        rows = connection.execute("SELECT * FROM learning_progress WHERE user_id=?", (user["id"],)).fetchall()
    return {
        "totalSeconds": sum(row["total_seconds"] for row in rows),
        "courseCount": len(rows),
        "completedCueCount": sum(len(json.loads(row["completed_cues"])) for row in rows),
    }


@router.post("/feedback")
def create_feedback(payload: FeedbackRequest, user: Annotated[dict[str, object], Depends(current_user)]) -> dict[str, object]:
    message = payload.message.strip()
    if not 5 <= len(message) <= 2000:
        raise HTTPException(400, "反馈内容需要 5–2000 个字符")
    category = payload.category if payload.category in {"general", "subtitle", "media", "suggestion"} else "general"
    feedback_id = uuid.uuid4().hex
    with _connect() as connection:
        connection.execute(
            "INSERT INTO feedback(id,user_id,course_id,category,message,position,created_at) VALUES(?,?,?,?,?,?,?)",
            (feedback_id, user["id"], payload.courseId, category, message, max(0, payload.position), int(time.time())),
        )
    return {"id": feedback_id, "status": "received"}


def _publication_dir() -> Path:
    configured = os.getenv("ECHOLOOP_PUBLICATION_DIR", "").strip()
    path = Path(configured) if configured else _database_path().parent / "publications"
    path.mkdir(parents=True, exist_ok=True)
    return path


def _optional_user(authorization: str | None) -> dict[str, object] | None:
    if not authorization:
        return None
    try:
        return current_user(authorization)
    except HTTPException:
        return None


@router.post("/publications")
async def publish_course(
    manifest: Annotated[str, Form()], visibility: Annotated[str, Form()],
    media: Annotated[UploadFile, File()], allowed_emails: Annotated[str, Form()] = "[]",
    expires_at: Annotated[str, Form()] = "",
    publish_key: Annotated[str | None, Header(alias="X-EchoLoop-Publish-Key")] = None,
) -> dict[str, object]:
    expected = os.getenv("ECHOLOOP_PUBLISH_KEY", "").strip()
    if not expected or not publish_key or not hmac.compare_digest(expected, publish_key):
        raise HTTPException(403, "发布凭证无效")
    if visibility not in {"private", "global", "selected"}:
        raise HTTPException(400, "发布范围无效")
    try:
        course = json.loads(manifest)
        emails = sorted({str(item).strip().lower() for item in json.loads(allowed_emails) if str(item).strip()})
        expiry = int(expires_at) if expires_at else None
    except (ValueError, TypeError) as exc:
        raise HTTPException(400, "发布数据格式无效") from exc
    if visibility == "selected" and not emails:
        raise HTTPException(400, "指定用户发布至少需要一个邮箱")
    course_id = re.sub(r"[^a-zA-Z0-9_-]", "", str(course.get("id", ""))) or uuid.uuid4().hex
    suffix = Path(media.filename or "clip.mp4").suffix.lower() or ".mp4"
    media_path = _publication_dir() / f"{course_id}{suffix}"
    with media_path.open("wb") as target:
        while chunk := await media.read(1024 * 1024):
            target.write(chunk)
    now = int(time.time())
    course.update({"id": course_id, "mediaUrl": f"/api/course-media/{course_id}", "mediaType": media.content_type or "video/mp4"})
    with _connect() as connection:
        connection.execute(
            """INSERT INTO published_courses(id,title,manifest,visibility,allowed_emails,expires_at,media_path,media_type,created_at,updated_at)
               VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,manifest=excluded.manifest,
               visibility=excluded.visibility,allowed_emails=excluded.allowed_emails,expires_at=excluded.expires_at,
               media_path=excluded.media_path,media_type=excluded.media_type,updated_at=excluded.updated_at""",
            (course_id, str(course.get("title", course_id)), json.dumps(course, ensure_ascii=False), visibility,
             json.dumps(emails), expiry, str(media_path), course["mediaType"], now, now),
        )
    return {"id": course_id, "status": "published", "visibility": visibility, "expiresAt": expiry}


def _accessible_course(course_id: str, authorization: str | None) -> sqlite3.Row:
    with _connect() as connection:
        row = connection.execute("SELECT * FROM published_courses WHERE id=?", (course_id,)).fetchone()
    if not row or (row["expires_at"] and row["expires_at"] <= int(time.time())):
        raise HTTPException(404, "素材不存在或已经到期")
    if row["visibility"] == "global":
        return row
    if row["visibility"] == "private":
        raise HTTPException(404, "素材为私有暂存状态")
    user = _optional_user(authorization)
    if not user:
        raise HTTPException(401, "该素材需要登录")
    if row["visibility"] == "selected" and str(user["email"]).lower() not in json.loads(row["allowed_emails"]):
        raise HTTPException(403, "你没有该素材的使用权限")
    return row


@router.get("/courses")
def list_courses(authorization: Annotated[str | None, Header()] = None) -> dict[str, object]:
    """Return active publications the current learner may open."""
    user = _optional_user(authorization)
    email = str(user["email"]).lower() if user else ""
    now = int(time.time())
    with _connect() as connection:
        rows = connection.execute(
            "SELECT * FROM published_courses WHERE expires_at IS NULL OR expires_at>? ORDER BY updated_at DESC",
            (now,),
        ).fetchall()
    courses: list[dict[str, object]] = []
    for row in rows:
        if row["visibility"] == "private":
            continue
        if row["visibility"] == "selected" and email not in json.loads(row["allowed_emails"]):
            continue
        try:
            manifest = json.loads(row["manifest"])
        except (TypeError, ValueError):
            continue
        courses.append({
            "id": row["id"], "title": row["title"], "description": manifest.get("description", ""),
            "language": manifest.get("language", ""), "duration": manifest.get("duration", 0),
            "cueCount": len(manifest.get("cues", [])), "visibility": row["visibility"],
            "expiresAt": row["expires_at"], "updatedAt": row["updated_at"],
        })
    return {"courses": courses}


@router.get("/courses/{course_id}")
def get_course(course_id: str, request: Request, authorization: Annotated[str | None, Header()] = None) -> dict[str, object]:
    row = _accessible_course(course_id, authorization)
    course = json.loads(row["manifest"])
    course["mediaUrl"] = str(request.url_for("get_course_media", course_id=course_id))
    return course


@router.get("/course-media/{course_id}")
def get_course_media(course_id: str, authorization: Annotated[str | None, Header()] = None):
    row = _accessible_course(course_id, authorization)
    path = Path(row["media_path"])
    if not path.is_file():
        raise HTTPException(404, "媒体片段不存在")
    return FileResponse(path, media_type=row["media_type"], filename=path.name)
