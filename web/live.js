/* MOA live operator module: separate from the unchanged rule-based T13 demo.
 * No service-role or ingest token is held in the browser. Auth tokens remain in memory.
 * Actual access is verified on the server against MOA_OPERATOR_USER_ID.
 */
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const ui = {
    setup: $('liveSetupNotice'),
    loginArea: $('liveLoginArea'), loginForm: $('liveLoginForm'),
    email: $('liveEmail'), password: $('livePassword'), authMsg: $('liveAuthMessage'),
    desk: $('liveDeskArea'), session: $('liveSessionLabel'),
    refresh: $('liveRefresh'), logout: $('liveLogout'),
    list: $('liveTicketList'), count: $('liveCount'), filter: $('liveStatusFilter'),
    detail: $('liveDetail'), form: $('liveReviewForm'),
    draft: $('liveDraft'), note: $('liveNote'), confirmed: $('liveConfirmed'),
    save: $('liveSave'), request: $('liveRequest'), approve: $('liveApprove'), complete: $('liveComplete'),
    result: $('liveResult'),
  };
  if (!ui.setup || !ui.loginForm || !ui.list || !ui.form) return;

  const raw = window.MOA_LIVE_CONFIG || {};
  const url = String(raw.projectUrl || '').trim().replace(/\/$/, '');
  const publishableKey = String(raw.publishableKey || '').trim();
  const functionName = String(raw.functionName || 'moa-operator-api').trim();
  const configured = /^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(url) &&
    publishableKey.length > 20 && !publishableKey.startsWith('sb_secret_') &&
    /^[a-z0-9-]+$/.test(functionName);

  // Prevent accidentally putting a legacy service_role JWT into frontend config.
  let forbiddenLegacyKey = false;
  if (publishableKey.split('.').length === 3) {
    try {
      const part = publishableKey.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      const claim = JSON.parse(atob(part));
      forbiddenLegacyKey = claim.role !== 'anon';
    } catch (_) { forbiddenLegacyKey = true; }
  }

  let token = null;
  let selectedId = null;
  let records = [];
  let originalRecord = null;
  let busy = false;

  const node = (tag, className, value) => {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (value !== undefined) el.textContent = String(value);
    return el;
  };
  const text = (value) => (value === null || value === undefined || value === '') ? '미기록' : String(value);
  const time = (iso) => {
    if (!iso) return '-';
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? String(iso) : new Intl.DateTimeFormat('ko-KR', {
      dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Seoul'
    }).format(d);
  };
  const setMessage = (message, isError = false) => {
    ui.result.textContent = message;
    ui.result.classList.toggle('live-error', isError);
    ui.result.hidden = !message;
  };
  const setAuthMessage = (message) => { ui.authMsg.textContent = message; };
  const setBusy = (value) => {
    busy = value;
    [ui.refresh, ui.logout, ui.save, ui.request, ui.approve, ui.complete].forEach(b => { b.disabled = value; });
    ui.loginForm.querySelector('button[type="submit"]').disabled = value;
  };

  function sessionView(signedIn) {
    ui.loginArea.hidden = signedIn;
    ui.desk.hidden = !signedIn;
    if (!signedIn) {
      ui.password.value = '';
      ui.list.replaceChildren();
      ui.detail.replaceChildren();
      ui.form.hidden = true;
      originalRecord = null;
      selectedId = null;
      records = [];
    }
  }

  async function parseResponse(res) {
    const content = await res.text();
    let data = {};
    try { data = JSON.parse(content); } catch (_) { data = {}; }
    if (!res.ok) {
      const code = typeof data.error === 'string' ? data.error : `HTTP ${res.status}`;
      const err = new Error(code);
      err.status = res.status;
      throw err;
    }
    return data;
  }

  async function api(method, payload) {
    const headers = {
      'apikey': publishableKey,
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    };
    const res = await fetch(`${url}/functions/v1/${functionName}`, {
      method, headers,
      ...(payload ? { body: JSON.stringify(payload) } : {}),
      cache: 'no-store'
    });
    return parseResponse(res);
  }

  function canUseGuide(item) {
    return item && item.ai_category === '공통 안내' &&
      item.ai_next_action === 'USE_APPROVED_GUIDE' &&
      !!item.ai_guide_id && !!item.ai_draft;
  }

  function changed() {
    if (!originalRecord) return false;
    return ui.draft.value !== (originalRecord.reviewed_draft ?? originalRecord.ai_draft ?? '') ||
      ui.note.value !== (originalRecord.review_note ?? '');
  }

  function controls() {
    const r = originalRecord;
    if (!r) { ui.form.hidden = true; return; }
    ui.form.hidden = false;
    const allowed = canUseGuide(r);
    ui.confirmed.disabled = !allowed || busy || r.review_status !== '검토 중' || changed();
    ui.approve.disabled = busy || !allowed || r.review_status !== '검토 중' ||
      !ui.confirmed.checked || changed() || !r.reviewed_draft;
    ui.complete.disabled = busy || r.review_status !== '승인됨' || changed();
    ui.save.disabled = busy;
    ui.request.disabled = busy || r.review_status === '처리 완료';
    $('liveReviewHelp').textContent = !allowed
      ? '승인 가능한 공통 안내로 확인되지 않았습니다. 초안을 자동 발송하지 않으며 추가 확인 요청으로 보류하세요.'
      : '초안을 저장한 뒤 실제 승인 자료와 직접 대조하고 체크해 주세요. 체크만으로 정책의 사실성이 검증되는 것은 아닙니다.';
  }

  function renderList() {
    const status = ui.filter.value;
    const shown = records.filter(r => status === 'all' || r.review_status === status);
    ui.list.replaceChildren();
    ui.count.textContent = `${shown.length}건 / 조회 ${records.length}건`;
    if (!shown.length) {
      ui.list.append(node('li', 'live-empty', '표시할 문의가 없습니다.'));
      return;
    }
    for (const r of shown) {
      const li = node('li');
      const btn = node('button', 'live-ticket' + (r.id === selectedId ? ' is-active' : ''));
      btn.type = 'button';
      btn.setAttribute('aria-pressed', r.id === selectedId ? 'true' : 'false');
      btn.dataset.id = String(r.id);
      btn.append(
        node('span', 'live-ticket-id', `${text(r.source_ref)} · ${time(r.created_at)}`),
        node('strong', 'live-ticket-title', r.inquiry_text),
        node('span', 'live-ticket-meta', `${text(r.ai_category)}  /  ${text(r.review_status)}`)
      );
      li.append(btn); ui.list.append(li);
    }
  }

  function renderDetail() {
    const r = records.find(item => item.id === selectedId);
    originalRecord = r || null;
    ui.detail.replaceChildren();
    if (!r) {
      ui.detail.append(node('p', 'live-empty', '왼쪽에서 실제 문의를 선택해 주세요.'));
      controls(); return;
    }
    const pairs = [
      ['문의 원문', r.inquiry_text],
      ['원본 식별값', r.source_ref],
      ['AI 분류', r.ai_category],
      ['AI 실행 행동', r.ai_next_action],
      ['선택한 안내ID / 버전', `${text(r.ai_guide_id)} / ${text(r.ai_guide_version)}`],
      ['AI 작성·조회된 초안', r.ai_draft],
      ['AI 판단 근거', r.ai_reason],
      ['현재 검토 상태', r.review_status],
      ['최근 변경 시각', time(r.updated_at)]
    ];
    for (const [key, value] of pairs) {
      const item = node('div', 'live-fact');
      item.append(node('dt', '', key), node('dd', '', text(value)));
      ui.detail.append(item);
    }
    ui.draft.value = r.reviewed_draft ?? r.ai_draft ?? '';
    ui.note.value = r.review_note ?? '';
    ui.confirmed.checked = false;
    controls();
  }

  async function refresh() {
    if (!token) return;
    setBusy(true); setMessage('실제 AI 문의를 조회 중입니다.');
    try {
      const response = await api('GET');
      if (!Array.isArray(response.items)) throw new Error('서버 응답 형식 오류');
      records = response.items;
      if (!records.some(r => r.id === selectedId)) selectedId = records[0]?.id ?? null;
      renderList();renderDetail();
      setMessage(`Supabase에서 실제 문의 ${records.length}건을 조회했습니다. (데모 문의는 별도)`);
    } catch (e) {
      if (e.status === 401) { token = null;sessionView(false); setAuthMessage('로그인이 만료되었어. 다시 로그인해 줘.'); }
      setMessage(`조회 실패: ${e.message}`, true);
    } finally { setBusy(false); controls(); }
  }

  async function review(action) {
    const r = originalRecord;
    if (!r || busy) return;
    const draft = ui.draft.value.trim();
    const note = ui.note.value.trim();
    if (draft.length > 600 || note.length > 300) {setMessage('답변 600자, 메모 300자 이하로 입력해 줘.', true);return;}
    if (action === 'approve' && !ui.confirmed.checked) {setMessage('승인 전에 공식 원문을 직접 대조하고 확인해 줘.', true);return;}
    if ((action === 'approve' || action === 'complete') && changed()) {
      setMessage('저장하지 않은 변경이 있어. 먼저 초안을 저장해 줘.', true);return;
    }
    setBusy(true);
    try {
      const result = await api('POST', {
        id: r.id, action,
        reviewed_draft: draft,
        review_note: note,
        source_confirmed: action === 'approve' && ui.confirmed.checked,
        expected_updated_at: r.updated_at
      });
      if (!result || !result.item) throw new Error('서버에서 수정 결과를 받지 못했습니다.');
      records = records.map(item => item.id === result.item.id ? result.item : item);
      renderList(); renderDetail();
      setMessage('운영자 검토 결과가 Supabase에 저장됐습니다. 외부 답변은 전송하지 않았습니다.');
    } catch (e) {
      setMessage(`검토 저장 실패: ${e.message}`, true);
    } finally {setBusy(false);controls();}
  }

  if (!configured || forbiddenLegacyKey) {
    ui.setup.hidden = false;
    ui.setup.textContent = '실데이터 모드 준비 중: web/live-config.js에 Supabase Publishable key만 입력하고, 운영자 API를 배포·인증 설정해야 합니다. 비밀키는 입력하지 마세요.';
    ui.loginArea.hidden = true;
    ui.desk.hidden = true;
    return;
  }
  ui.setup.hidden = true;
  sessionView(false);
  ui.loginForm.addEventListener('submit', async event => {
    event.preventDefault();
    if (busy) return;
    const email = ui.email.value.trim();
    const password = ui.password.value;
    if (!email || !password) return;
    setBusy(true);setAuthMessage('운영자 인증 중...');
    try {
      const res = await fetch(`${url}/auth/v1/token?grant_type=password`, {
        method: 'POST',
        headers: {'apikey':publishableKey, 'Content-Type':'application/json'},
        body: JSON.stringify({ email, password }),cache:'no-store'
      });
      const data = await parseResponse(res);
      if (!data.access_token || typeof data.access_token !== 'string') throw new Error('인증 토큰이 없습니다.');
      token = data.access_token;ui.password.value = '';
      sessionView(true);
      ui.session.textContent = `${email} · 서버에서 권한 재검증`;
      setAuthMessage('');
    } catch (_) {
      token = null;
      setAuthMessage('로그인에 실패했어. 계정 정보와 운영자 권한을 확인해 줘.');
    } finally {setBusy(false);}
    if (token) await refresh();
  });
  ui.logout.addEventListener('click', () => {token=null;sessionView(false);setAuthMessage('로그아웃했습니다.');setMessage('');});
  ui.refresh.addEventListener('click', refresh);
  ui.filter.addEventListener('change', () => {renderList();});
  ui.list.addEventListener('click', event => {
    const btn = event.target.closest('button[data-id]');
    if (!btn || busy) return;
    if (originalRecord && changed() && !window.confirm('저장하지 않은 변경을 버리고 이동할까?')) return;
    selectedId = Number(btn.dataset.id);
    renderList();renderDetail();setMessage('');
  });
  [ui.draft,ui.note].forEach(input => input.addEventListener('input', () => {ui.confirmed.checked=false;controls();}));
  ui.confirmed.addEventListener('change', controls);
  ui.form.addEventListener('submit', e=>e.preventDefault());
  ui.save.addEventListener('click',()=>review('save'));
  ui.request.addEventListener('click',()=>review('request_info'));
  ui.approve.addEventListener('click',()=>review('approve'));
  ui.complete.addEventListener('click',()=>review('complete'));
})();
