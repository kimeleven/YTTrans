import os
import re
from concurrent.futures import ThreadPoolExecutor, as_completed

import requests
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

load_dotenv()
YOUTUBE_API_KEY = os.getenv("YOUTUBE_API_KEY")

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)

# 정적 파일 서빙 (로컬 + Vercel 공통)
from fastapi.responses import FileResponse as _FR

_pub = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")


@app.get("/")
def _index():
    return _FR(os.path.join(_pub, "index.html"))


@app.get("/style.css")
def _css():
    return _FR(os.path.join(_pub, "style.css"), media_type="text/css")


@app.get("/app.js")
def _js():
    return _FR(os.path.join(_pub, "app.js"), media_type="application/javascript")


# ---------- Models ----------

class VideoRequest(BaseModel):
    url: str


class TranslateRequest(BaseModel):
    title: str
    text: str
    target_langs: list[str]


# ---------- YouTube helpers ----------

def extract_video_id(url: str) -> str | None:
    match = re.search(r"(?:v=|youtu\.be/|shorts/)([A-Za-z0-9_-]{11})", url)
    return match.group(1) if match else None


def fetch_video_info(video_id: str) -> dict:
    if not YOUTUBE_API_KEY:
        raise HTTPException(500, "YOUTUBE_API_KEY가 설정되지 않았습니다. .env 파일을 확인하세요.")

    resp = requests.get(
        "https://www.googleapis.com/youtube/v3/videos",
        params={"id": video_id, "part": "snippet", "key": YOUTUBE_API_KEY},
        timeout=10,
    )
    resp.raise_for_status()
    data = resp.json()

    if not data.get("items"):
        raise HTTPException(404, "영상을 찾을 수 없습니다. 비공개 영상이거나 잘못된 URL입니다.")

    snippet = data["items"][0]["snippet"]
    thumbnails = snippet.get("thumbnails", {})
    thumb = (
        thumbnails.get("high")
        or thumbnails.get("medium")
        or thumbnails.get("default")
        or {}
    ).get("url", "")

    return {
        "videoId": video_id,
        "title": snippet.get("title", ""),
        "description": snippet.get("description", ""),
        "thumbnail": thumb,
    }


# ---------- Translation helpers ----------

def _chunk_text(text: str, max_len: int = 480) -> list[str]:
    if len(text) <= max_len:
        return [text]
    sentences = re.split(r"(?<=[.!?\n])\s*", text)
    chunks, current = [], ""
    for sentence in sentences:
        if len(current) + len(sentence) + 1 <= max_len:
            current = (current + " " + sentence).strip()
        else:
            if current:
                chunks.append(current)
            while len(sentence) > max_len:
                chunks.append(sentence[:max_len])
                sentence = sentence[max_len:]
            current = sentence
    if current:
        chunks.append(current)
    return chunks


def _translate_deep(text: str, target: str) -> str:
    from deep_translator import GoogleTranslator

    return GoogleTranslator(source="auto", target=target).translate(text) or ""


def _translate_mymemory(text: str, target: str) -> str:
    chunks = _chunk_text(text)
    results = []
    for chunk in chunks:
        resp = requests.get(
            "https://api.mymemory.translated.net/get",
            params={"q": chunk, "langpair": f"en|{target}"},
            timeout=10,
        )
        resp.raise_for_status()
        data = resp.json()
        translated = data.get("responseData", {}).get("translatedText", "")
        # MyMemory 캐시 프리픽스 제거
        translated = translated.replace("TRANSLATED.NET CACHING", "").strip()
        results.append(translated)
    return " ".join(results)


def translate_text(text: str, target: str) -> str:
    try:
        return _translate_deep(text, target)
    except Exception:
        pass
    try:
        return _translate_mymemory(text, target)
    except Exception as e:
        raise HTTPException(503, f"번역 실패 ({target}): {e}")


# ---------- Routes ----------

@app.post("/api/video")
async def get_video(req: VideoRequest):
    video_id = extract_video_id(req.url)
    if not video_id:
        raise HTTPException(
            400,
            "유효하지 않은 YouTube URL입니다. "
            "watch?v=, youtu.be/, youtube.com/shorts/ 형식을 지원합니다.",
        )
    return fetch_video_info(video_id)


@app.post("/api/translate")
async def translate(req: TranslateRequest):
    if not req.target_langs:
        raise HTTPException(400, "target_langs를 하나 이상 지정해주세요.")

    def _do(lang: str) -> tuple[str, dict]:
        try:
            return lang, {
                "title": translate_text(req.title, lang) if req.title.strip() else "",
                "description": translate_text(req.text, lang) if req.text.strip() else "",
            }
        except Exception as e:
            return lang, {"title": "", "description": f"[번역 실패: {e}]"}

    workers = min(10, len(req.target_langs))
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {pool.submit(_do, lang): lang for lang in req.target_langs}
        result = {}
        for fut in as_completed(futures):
            lang, data = fut.result()
            result[lang] = data
    return result
