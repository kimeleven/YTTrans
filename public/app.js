(function () {
  'use strict';

  // ── State ──────────────────────────────────────────────────
  const state = {
    translations: { ko: '', en: '', ja: '' },
  };

  // ── DOM refs ───────────────────────────────────────────────
  const urlInput       = document.getElementById('url-input');
  const fetchBtn       = document.getElementById('fetch-btn');
  const btnText        = fetchBtn.querySelector('.btn-text');
  const btnSpinner     = fetchBtn.querySelector('.spinner');
  const errorBanner    = document.getElementById('error-banner');
  const errorText      = document.getElementById('error-text');
  const videoCard      = document.getElementById('video-card');
  const videoThumb     = document.getElementById('video-thumb');
  const videoTitle     = document.getElementById('video-title');
  const videoDesc      = document.getElementById('video-desc');
  const translations   = document.getElementById('translations');
  const translateLoad  = document.getElementById('translate-loading');

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

  // ── Error / Loading helpers ────────────────────────────────
  function showError(msg) {
    errorText.textContent = msg;
    errorBanner.classList.remove('hidden');
  }
  function hideError() {
    errorBanner.classList.add('hidden');
  }
  function setFetchLoading(on) {
    fetchBtn.disabled = on;
    btnText.textContent = on ? '가져오는 중...' : '가져오기';
    btnSpinner.classList.toggle('hidden', !on);
  }
  function setTranslateLoading(on) {
    translateLoad.classList.toggle('hidden', !on);
  }

  // ── Render video card ──────────────────────────────────────
  function renderVideoCard(data) {
    videoThumb.src = data.thumbnail;
    videoThumb.alt = data.title;
    videoTitle.textContent = data.title;
    videoDesc.textContent = data.description || '(설명 없음)';
    videoCard.classList.remove('hidden');
  }

  // ── Render translations ────────────────────────────────────
  function renderTranslations(data) {
    document.getElementById('text-ko').textContent = data.ko || '(번역 결과 없음)';
    document.getElementById('text-en').textContent = data.en || '(no translation)';
    document.getElementById('text-ja').textContent = data.ja || '(翻訳結果なし)';
    state.translations = data;
    translations.classList.remove('hidden');
  }

  // ── Tab switching ──────────────────────────────────────────
  function switchTab(lang) {
    document.querySelectorAll('.tab-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.lang === lang);
    });
    document.querySelectorAll('.tab-panel').forEach((panel) => {
      panel.classList.toggle('active', panel.dataset.lang === lang);
    });
  }

  // ── Copy ───────────────────────────────────────────────────
  async function copyTranslation(lang) {
    const text = state.translations[lang];
    if (!text) return;
    const btn = document.querySelector(`.copy-btn[data-copy="${lang}"]`);
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // 구형 브라우저 fallback
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    btn.classList.add('copied');
    const originalLabel = btn.textContent;
    btn.textContent = '✓';
    setTimeout(() => {
      btn.textContent = originalLabel;
      btn.classList.remove('copied');
    }, 1500);
  }

  // ── Fetch translations ─────────────────────────────────────
  async function fetchTranslations(text) {
    if (!text || !text.trim()) {
      document.getElementById('text-ko').textContent = '(설명 없음)';
      document.getElementById('text-en').textContent = '(no description)';
      document.getElementById('text-ja').textContent = '(説明なし)';
      translations.classList.remove('hidden');
      return;
    }
    setTranslateLoading(true);
    try {
      const data = await apiPost('/api/translate', {
        text,
        target_langs: ['ko', 'en', 'ja'],
      });
      renderTranslations(data);
    } catch (err) {
      showError('번역 실패: ' + err.message);
      translations.classList.add('hidden');
    } finally {
      setTranslateLoading(false);
    }
  }

  // ── Fetch video ────────────────────────────────────────────
  async function fetchVideo() {
    const url = urlInput.value.trim();
    if (!url) {
      showError('YouTube URL을 입력해주세요.');
      return;
    }
    hideError();
    videoCard.classList.add('hidden');
    translations.classList.add('hidden');
    setFetchLoading(true);

    try {
      const data = await apiPost('/api/video', { url });
      renderVideoCard(data);
      await fetchTranslations(data.description);
    } catch (err) {
      showError(err.message);
    } finally {
      setFetchLoading(false);
    }
  }

  // ── Event listeners ────────────────────────────────────────
  fetchBtn.addEventListener('click', fetchVideo);

  urlInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') fetchVideo();
  });

  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => switchTab(btn.dataset.lang));
  });

  document.querySelectorAll('.copy-btn').forEach((btn) => {
    btn.addEventListener('click', () => copyTranslation(btn.dataset.copy));
  });
})();
