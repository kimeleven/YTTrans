# Phase 2 — YouTube 설명 업데이트 기능

번역된 제목/설명을 YouTube 영상에 직접 업데이트하는 기능.

---

## 현재 프로젝트 구조

```
YTTrans/
├── api/
│   ├── index.py        ← FastAPI 백엔드 (여기에 OAuth 엔드포인트 추가)
│   └── static/         ← 프론트엔드 소스 (Vercel 번들용)
│       ├── index.html
│       ├── style.css
│       └── app.js
├── public/             ← 로컬 개발용 (api/static/ 과 동일하게 유지)
├── requirements.txt
├── vercel.json
└── .env / .env.example
```

> **주의:** `api/static/`을 수정한 후 반드시 `public/`에도 동일하게 복사해야 함.  
> 로컬 개발 서버: `python -m uvicorn api.index:app --reload --port 8000`  
> Vercel 배포: `vercel --prod`

---

## 구현 목표

YouTube URL + 언어 선택 → 번역 결과를 해당 영상의 제목·설명으로 직접 업데이트

---

## 사전 준비 (Google Cloud Console)

1. [console.cloud.google.com](https://console.cloud.google.com) → 기존 프로젝트 선택
2. **APIs & Services → OAuth consent screen** 설정
   - User Type: External
   - App name: YTTrans
   - Scopes에 `https://www.googleapis.com/auth/youtube` 추가
   - Test users에 본인 Google 계정 이메일 추가
3. **APIs & Services → Credentials → + CREATE CREDENTIALS → OAuth 2.0 Client ID**
   - Application type: **Web application**
   - Authorized redirect URIs: `https://yttrans-ochre.vercel.app/oauth/callback` (프로덕션)
   - 로컬 테스트용 추가: `http://localhost:8000/oauth/callback`
4. 발급된 `client_id`와 `client_secret`을 `.env`와 Vercel 환경변수에 추가:
   ```
   GOOGLE_CLIENT_ID=...
   GOOGLE_CLIENT_SECRET=...
   OAUTH_REDIRECT_URI=https://yttrans-ochre.vercel.app/oauth/callback
   ```

---

## 백엔드 추가 작업 (`api/index.py`)

### 추가 패키지

```
google-auth-oauthlib==1.1.0   # 이미 시스템에 설치되어 있음
itsdangerous                   # 세션 서명용 (pip install itsdangerous)
```

`requirements.txt`에 추가:
```
google-auth-oauthlib==1.1.0
itsdangerous
```

### 인메모리 토큰 저장소

```python
# Vercel은 stateless라 요청 간 메모리 공유 불가 → token.json 파일로 저장
TOKEN_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "token.json")
```

> **Vercel 주의:** Vercel 서버리스 함수는 파일시스템이 read-only. 토큰 저장을 위해  
> **Vercel KV** (무료 플랜: 256MB) 또는 **쿠키 기반 저장** 방식 사용 필요.  
> 로컬 개발에서는 `token.json` 파일 방식 그대로 사용 가능.

### 추가 엔드포인트 5개

#### 1. `GET /oauth/authorize`
Google 로그인 페이지 URL을 생성해서 리다이렉트

```python
from google_auth_oauthlib.flow import Flow

SCOPES = ["https://www.googleapis.com/auth/youtube"]

@app.get("/oauth/authorize")
def oauth_authorize():
    flow = Flow.from_client_config(
        {
            "web": {
                "client_id": os.getenv("GOOGLE_CLIENT_ID"),
                "client_secret": os.getenv("GOOGLE_CLIENT_SECRET"),
                "auth_uri": "https://accounts.google.com/o/oauth2/auth",
                "token_uri": "https://oauth2.googleapis.com/token",
                "redirect_uris": [os.getenv("OAUTH_REDIRECT_URI")],
            }
        },
        scopes=SCOPES,
    )
    flow.redirect_uri = os.getenv("OAUTH_REDIRECT_URI")
    auth_url, _ = flow.authorization_url(prompt="consent", access_type="offline")
    from fastapi.responses import RedirectResponse
    return RedirectResponse(auth_url)
```

#### 2. `GET /oauth/callback?code=...`
Google로부터 인증 코드 수신 → 액세스 토큰 교환 → 저장

```python
@app.get("/oauth/callback")
def oauth_callback(code: str):
    flow = Flow.from_client_config(...)
    flow.redirect_uri = os.getenv("OAUTH_REDIRECT_URI")
    flow.fetch_token(code=code)
    credentials = flow.credentials
    # 토큰 저장 (로컬: token.json / Vercel: KV store)
    save_credentials(credentials)
    from fastapi.responses import RedirectResponse
    return RedirectResponse("/?auth=success")
```

#### 3. `GET /oauth/status`
프론트엔드가 인증 여부 확인용

```python
@app.get("/oauth/status")
def oauth_status():
    creds = load_credentials()
    return {"authenticated": creds is not None and creds.valid}
```

#### 4. `GET /oauth/logout`
저장된 토큰 삭제

```python
@app.get("/oauth/logout")
def oauth_logout():
    delete_credentials()
    return {"ok": True}
```

#### 5. `POST /api/push`
번역된 내용을 YouTube 영상에 업데이트

```python
class PushRequest(BaseModel):
    video_id: str
    title: str
    description: str

@app.post("/api/push")
def push_to_youtube(req: PushRequest):
    creds = load_credentials()
    if not creds or not creds.valid:
        raise HTTPException(401, "YouTube 인증이 필요합니다. /oauth/authorize 를 먼저 진행하세요.")

    youtube = build("youtube", "v3", credentials=creds)

    # 기존 snippet 전체를 가져온 후 title/description만 교체 (videos.update는 full overwrite)
    existing = youtube.videos().list(part="snippet", id=req.video_id).execute()
    if not existing.get("items"):
        raise HTTPException(404, "영상을 찾을 수 없습니다.")

    snippet = existing["items"][0]["snippet"]
    snippet["title"] = req.title
    snippet["description"] = req.description

    youtube.videos().update(
        part="snippet",
        body={"id": req.video_id, "snippet": snippet}
    ).execute()

    return {"ok": True}
```

> **주의:** `google-api-python-client` 사용 필요 (`pip install google-api-python-client`)  
> `requirements.txt`에 `google-api-python-client` 추가

---

## 프론트엔드 추가 작업 (`api/static/`)

### `index.html` 수정

번역 결과 패널 하단에 YouTube 업데이트 UI 추가:

```html
<!-- 번역 결과 패널 (.trans-result 내부) -->
<div id="push-section" class="push-section hidden">
  <hr class="divider" />
  
  <!-- 미인증 상태 -->
  <div id="auth-needed" class="auth-needed">
    <p>번역 결과를 YouTube에 바로 적용할 수 있습니다.</p>
    <a href="/oauth/authorize" class="btn btn-google">
      Google 계정으로 인증
    </a>
  </div>
  
  <!-- 인증 완료 상태 -->
  <div id="auth-done" class="auth-done hidden">
    <button id="push-btn" class="btn btn-push">
      <span class="btn-text">YouTube에 적용</span>
      <span class="spinner hidden"></span>
    </button>
    <span id="push-result" class="push-result"></span>
    <button id="logout-btn" class="logout-btn">로그아웃</button>
  </div>
</div>
```

### `app.js` 수정

1. 페이지 로드 시 `/oauth/status` 호출 → 인증 여부 확인
2. `push-btn` 클릭 시 현재 선택된 언어의 제목/설명을 `/api/push`로 전송
3. 인증 후 리다이렉트 (`?auth=success`) 감지 → 성공 메시지 표시
4. `logout-btn` 클릭 시 `/oauth/logout` 호출

```javascript
// 페이지 로드 시 인증 상태 체크
async function checkAuthStatus() {
  const data = await fetch('/oauth/status').then(r => r.json());
  document.getElementById('auth-needed').classList.toggle('hidden', data.authenticated);
  document.getElementById('auth-done').classList.toggle('hidden', !data.authenticated);
}

// YouTube 적용
document.getElementById('push-btn').addEventListener('click', async () => {
  const t = state.translations[state.activeLang];
  await apiPost('/api/push', {
    video_id: state.videoId,
    title: t.title,
    description: t.description,
  });
  // 성공 표시
});
```

### `style.css` 추가

```css
.push-section { margin-top: 12px; }
.divider { border: none; border-top: 1px solid var(--border); margin: 12px 0; }
.btn-google { background: #4285f4; color: #fff; text-decoration: none; }
.btn-push { background: var(--yt-red); color: #fff; }
.logout-btn { font-size: 0.75rem; color: var(--text-secondary); background: none; border: none; cursor: pointer; text-decoration: underline; }
.push-result { font-size: 0.82rem; color: #16a34a; }
```

---

## 배포 시 추가 환경변수 (Vercel)

```bash
vercel env add GOOGLE_CLIENT_ID production
vercel env add GOOGLE_CLIENT_SECRET production
vercel env add OAUTH_REDIRECT_URI production
# OAUTH_REDIRECT_URI = https://yttrans-ochre.vercel.app/oauth/callback
```

---

## 제약사항 및 주의점

| 항목 | 내용 |
|---|---|
| `videos.update` 쿼터 | 50 units/호출 → 무료 티어 200회/일 |
| snippet 전체 필요 | title, description, categoryId, defaultLanguage 모두 포함해야 함 |
| 본인 영상만 | 인증한 계정이 소유한 영상만 업데이트 가능 |
| Vercel 토큰 저장 | 서버리스라 파일 저장 불가 → Vercel KV 사용 또는 클라이언트 쿠키 방식 고려 |
| Google 앱 심사 | 개인 사용(테스트 모드)은 100명까지 심사 없이 가능 |
| `google-api-python-client` | Vercel 번들 크기 증가 (~10MB) — 허용 범위 내 |
