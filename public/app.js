(function () {
  'use strict';

  // ── 언어 목록 ──────────────────────────────────────────────
  const LANG_GROUPS = [
    {
      region: '아시아',
      langs: [
        { code: 'ko', name: '한국어' },
        { code: 'ja', name: '일본어' },
        { code: 'zh-CN', name: '중국어' },
        { code: 'yue', name: '광둥어' },
        { code: 'vi', name: '베트남어' },
        { code: 'ms', name: '말레이어' },
        { code: 'id', name: '인도네시아어' },
        { code: 'th', name: '태국어' },
        { code: 'tl', name: '필리핀어' },
        { code: 'hi', name: '힌디어' },
        { code: 'bn', name: '벵골어' },
        { code: 'fa', name: '페르시아어' },
        { code: 'ar', name: '아랍어' },
      ],
    },
    {
      region: '유럽',
      langs: [
        { code: 'en', name: '영어' },
        { code: 'fr', name: '프랑스어' },
        { code: 'de', name: '독일어' },
        { code: 'it', name: '이탈리아어' },
        { code: 'es', name: '스페인어' },
        { code: 'pt', name: '포르투갈어' },
        { code: 'ru', name: '러시아어' },
        { code: 'nl', name: '네덜란드어' },
        { code: 'pl', name: '폴란드어' },
        { code: 'sv', name: '스웨덴어' },
        { code: 'no', name: '노르웨이어' },
        { code: 'da', name: '덴마크어' },
        { code: 'fi', name: '핀란드어' },
        { code: 'ro', name: '루마니아어' },
        { code: 'cs', name: '체코어' },
        { code: 'el', name: '그리스어' },
        { code: 'hu', name: '헝가리어' },
        { code: 'uk', name: '우크라이나어' },
        { code: 'sk', name: '슬로바키아어' },
        { code: 'hr', name: '크로아티아어' },
        { code: 'ca', name: '카탈로니아어' },
        { code: 'is', name: '아이슬란드어' },
      ],
    },
    {
      region: '기타',
      langs: [
        { code: 'tr', name: '튀르키예어' },
        { code: 'he', name: '히브리어' },
        { code: 'af', name: '아프리칸스어' },
      ],
    },
  ];

  const ALL_LANGS = LANG_GROUPS.flatMap((g) => g.langs);

  // ── State ──────────────────────────────────────────────────
  const state = {
    activeLang: 'ko',
    translations: {}, // { code: { title, description } }
    status: {},       // { code: 'idle' | 'loading' | 'done' | 'error' }
    doneCount: 0,
    totalCount: ALL_LANGS.length,
  };

  // ── DOM refs ───────────────────────────────────────────────
  const urlInput      = document.getElementById('url-input');
  const fetchBtn      = document.getElementById('fetch-btn');
  const btnText       = fetchBtn.querySelector('.btn-text');
  const btnSpinner    = fetchBtn.querySelector('.spinner');
  const errorBanner   = document.getElementById('error-banner');
  const errorText     = document.getElementById('error-text');
  const videoCard     = document.getElementById('video-card');
  const videoThumb    = document.getElementById('video-thumb');
  const videoTitle    = document.getElementById('video-title');
  const videoDesc     = document.getElementById('video-desc');
  const translationsEl = document.getElementById('translations');
  const langNav       = document.getElementById('lang-nav');
  const transProgress = document.getElementById('trans-progress');
  const progressText  = document.getElementById('progress-text');
  const activeLangLbl = document.getElementById('active-lang-label');
  const copyBtn       = document.getElementById('copy-btn');
  const resultTitle   = document.getElementById('result-title');
  const resultDesc    = document.getElementById('result-desc');

  // ── Build sidebar ──────────────────────────────────────────
  function buildLangNav() {
    langNav.innerHTML = '';
    LANG_GROUPS.forEach(({ region, langs }) => {
      const header = document.createElement('div');
      header.className = 'lang-group-header';
      header.textContent = region;
      langNav.appendChild(header);

      const group = document.createElement('div');
      group.className = 'lang-group';
      langs.forEach(({ code, name }) => {
        const item = document.createElement('div');
        item.className = 'lang-item' + (code === state.activeLang ? ' active' : '');
        item.dataset.lang = code;
        item.innerHTML = `<span class="lang-name">${name}</span><span class="lang-status"></span>`;
        item.addEventListener('click', () => selectLang(code));
        group.appendChild(item);
      });
      langNav.appendChild(group);
    });
  }

  // ── Select language ────────────────────────────────────────
  function selectLang(code) {
    state.activeLang = code;
    document.querySelectorAll('.lang-item').forEach((el) => {
      el.classList.toggle('active', el.dataset.lang === code);
    });
    renderResult(code);

    // Scroll active item into view
    const activeEl = langNav.querySelector(`.lang-item[data-lang="${code}"]`);
    if (activeEl) activeEl.scrollIntoView({ block: 'nearest' });
  }

  // ── Render result for a language ───────────────────────────
  function renderResult(code) {
    const lang = ALL_LANGS.find((l) => l.code === code);
    activeLangLbl.textContent = lang ? lang.name : code;

    const t = state.translations[code];
    if (t) {
      resultTitle.textContent = t.title || '';
      resultDesc.textContent  = t.description || '(설명 없음)';
      resultDesc.classList.remove('result-placeholder');
    } else if (state.status[code] === 'loading') {
      resultTitle.textContent = '';
      resultDesc.textContent  = '번역 중...';
      resultDesc.classList.add('result-placeholder');
    } else {
      resultTitle.textContent = '';
      resultDesc.textContent  = '';
    }
  }

  // ── Update individual lang status in sidebar ───────────────
  function setLangStatus(code, status) {
    state.status[code] = status;
    const item = langNav.querySelector(`.lang-item[data-lang="${code}"]`);
    if (!item) return;
    item.classList.remove('loading', 'done', 'error');
    const statusEl = item.querySelector('.lang-status');
    if (status === 'loading') {
      item.classList.add('loading');
      statusEl.innerHTML = '<span class="spinner-sm"></span>';
    } else if (status === 'done') {
      item.classList.add('done');
      statusEl.textContent = '✓';
    } else if (status === 'error') {
      item.classList.add('error');
      statusEl.textContent = '✕';
    } else {
      statusEl.textContent = '';
    }
  }

  // ── API helper ─────────────────────────────────────────────
  async function apiPost(path, body) {
    const resp = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.detail || `HTTP ${resp.status}`);
    return data;
  }

  // ── Error helpers ──────────────────────────────────────────
  function showError(msg) {
    errorText.textContent = msg;
    errorBanner.classList.remove('hidden');
  }
  function hideError() { errorBanner.classList.add('hidden'); }

  function setFetchLoading(on) {
    fetchBtn.disabled = on;
    btnText.textContent = on ? '가져오는 중...' : '가져오기';
    btnSpinner.classList.toggle('hidden', !on);
  }

  // ── Copy ───────────────────────────────────────────────────
  copyBtn.addEventListener('click', async () => {
    const t = state.translations[state.activeLang];
    const text = [t?.title, t?.description].filter(Boolean).join('\n\n');
    if (!text) return;
    try { await navigator.clipboard.writeText(text); }
    catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;opacity:0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    copyBtn.classList.add('copied');
    const orig = copyBtn.textContent;
    copyBtn.textContent = '✓';
    setTimeout(() => { copyBtn.textContent = orig; copyBtn.classList.remove('copied'); }, 1500);
  });

  // ── Translate one language ─────────────────────────────────
  async function translateOne(code, title, text) {
    setLangStatus(code, 'loading');
    if (state.activeLang === code) renderResult(code);
    try {
      const data = await apiPost('/api/translate', {
        title,
        text,
        target_langs: [code],
      });
      state.translations[code] = data[code];
      setLangStatus(code, 'done');
    } catch {
      state.translations[code] = { title: '', description: '[번역 실패]' };
      setLangStatus(code, 'error');
    }
    if (state.activeLang === code) renderResult(code);

    // 진행 상황 업데이트
    state.doneCount++;
    const remaining = state.totalCount - state.doneCount;
    if (remaining > 0) {
      progressText.textContent = `번역 중... (${state.doneCount}/${state.totalCount})`;
    } else {
      transProgress.classList.add('hidden');
    }
  }

  // ── Start all translations in parallel ────────────────────
  async function startTranslations(title, text) {
    state.translations = {};
    state.doneCount = 0;
    transProgress.classList.remove('hidden');
    progressText.textContent = `번역 중... (0/${state.totalCount})`;

    // 병렬로 모든 언어 번역 시작 (브라우저가 동시 연결 수 자동 조절)
    const promises = ALL_LANGS.map(({ code }) => translateOne(code, title, text));
    await Promise.allSettled(promises);
  }

  // ── Fetch video ────────────────────────────────────────────
  async function fetchVideo() {
    const url = urlInput.value.trim();
    if (!url) { showError('YouTube URL을 입력해주세요.'); return; }

    hideError();
    videoCard.classList.add('hidden');
    translationsEl.classList.add('hidden');
    setFetchLoading(true);

    try {
      const data = await apiPost('/api/video', { url });

      // 영상 카드
      videoThumb.src = data.thumbnail;
      videoThumb.alt = data.title;
      videoTitle.textContent = data.title;
      videoDesc.textContent = data.description || '(설명 없음)';
      videoCard.classList.remove('hidden');

      // 언어 사이드바 초기화
      ALL_LANGS.forEach(({ code }) => { state.status[code] = 'idle'; });
      buildLangNav();
      translationsEl.classList.remove('hidden');
      selectLang('ko');

      // 모든 언어 번역 시작
      await startTranslations(data.title, data.description);
    } catch (err) {
      showError(err.message);
    } finally {
      setFetchLoading(false);
    }
  }

  // ── Init ───────────────────────────────────────────────────
  fetchBtn.addEventListener('click', fetchVideo);
  urlInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') fetchVideo(); });
})();
