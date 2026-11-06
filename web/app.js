/* MOA T13 M2 — 가상 문의 접수 / 규칙 기반 분류 / 사람의 답변 검토·처리 데모.
 * 개인정보 조회, 사용자 인증, 생성형 AI 호출, 외부 데이터 전송 기능은 없다.
 * 데모의 '승인'과 '처리 완료'는 이 브라우저 안에 남는 시연용 표시다.
 */
(() => {
  'use strict';

  const STORAGE_KEY = 'moa-t13-demo-m2-v1';
  const LEGACY_KEY = 'moa-t13-demo-m1-v1';
  const MAX_COUNT = 100;
  const MAX_REPLY = 600;
  const MAX_NOTE = 300;
  const examples = Object.freeze({
    assignment: '과제를 어디에서 제출하나요?',
    project: '최종 프로젝트는 언제, 어떻게 진행하나요?',
    attendance: '제 출결 내역을 알려주세요.'
  });
  const sources = Object.freeze({
    assignment: '과제는 교육 플랫폼의 ‘과제 제출’ 메뉴에서 제출한다.',
    project: '최종 프로젝트의 세부 진행 방식은 아직 문서에 정리되지 않았다.'
  });
  const categories = Object.freeze({
    common: {label:'공통 안내', hint:'공식 자료에 과제 제출 메뉴의 근거가 있습니다.', answer:'과제는 교육 플랫폼의 ‘과제 제출’ 메뉴에서 제출하시면 됩니다.', source:'가상 공식 자료 01 · 과제 제출 위치', tag:'common'},
    info: {label:'정보 확인 필요', hint:'공식 안내에 없는 내용을 추측하지 않습니다.', answer:null, source:'가상 공식 자료 02 또는 현재 공개된 근거 부족', tag:'info'},
    private: {label:'담당자 확인 필요', hint:'개인별 출결은 이 시연 앱에서 조회할 수 없습니다.', answer:null, source:'권한 확인 원칙(데모 운영 규칙)', tag:'private'},
    personal: {label:'개별 상담', hint:'개인별 판단이 필요한 상담은 자동 안내하지 않습니다.', answer:null, source:'개별 상담 분리 원칙(데모 운영 규칙)', tag:'personal'}
  });
  const workflow = Object.freeze({
    received: '접수',
    in_review: '검토 중',
    approved: '승인됨',
    needs_info: '추가 확인 요청',
    completed: '처리 완료'
  });
  const $ = selector => document.querySelector(selector);
  const ui = {
    form: $('#inquiryForm'), input: $('#inquiryText'), error: $('#inputError'), count: $('#charCount'),
    list: $('#ticketList'), empty: $('#emptyList'), detail: $('#ticketDetail'),
    filter: $('#filterSelect'), statusFilter: $('#statusFilter'),
    total: $('#totalCount'), common: $('#commonCount'), review: $('#reviewCount'),
    completed: $('#completedCount'), reset: $('#resetBtn'), toast: $('#toast'),
    reviewForm: $('#reviewForm'), reply: $('#replyDraft'), note: $('#reviewNote'),
    reviewError: $('#reviewError'), sourceConfirmed: $('#sourceConfirmed'),
    reviewStatus: $('#reviewStatus'), draftHint: $('#draftHint'), workflowHelp: $('#workflowHelp'),
    save: $('#saveDraftBtn'), request: $('#requestInfoBtn'), approve: $('#approveBtn'), complete: $('#completeBtn')
  };
  const demoData = [examples.assignment, examples.project, examples.attendance];
  const nowLabel = () => new Intl.DateTimeFormat('ko-KR', {month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date());

  // 명시된 데모 규칙 이외의 자유 입력은 안전하게 '정보 확인 필요'로 둔다.
  function classify(text) {
    const t = String(text || '').replace(/\s+/g,' ').trim().toLowerCase();
    if (/(출결|출석|결석|지각|내\s*(기록|내역)|출석률|수강\s*여부)/.test(t)) return 'private';
    if (/(개별\s*상담|진로|취업\s*상담|개인\s*상담|고민|면담)/.test(t)) return 'personal';
    if (/(최종\s*프로젝트|프로젝트\s*진행|프로젝트\s*일정)/.test(t)) return 'info';
    if (/(마감|기한|언제까지|몇\s*시|기간|연장|지연|늦게|평가|점수|채점|제출\s*확인|제출했|제출\s*여부)/.test(t)) return 'info';
    if (/<[^>]*>|https?:\/\/|[{}]/.test(t)) return 'info';
    const mentionsAssignment = /(과제|숙제)/.test(t);
    const asksWhere = /(어디|어느\s*곳|어느\s*메뉴|메뉴|경로|위치|어디서|어떻게\s*제출|제출\s*방법)/.test(t);
    const mentionsSubmit = /(제출|올리|등록)/.test(t);
    if (mentionsAssignment && asksWhere && mentionsSubmit) return 'common';
    return 'info';
  }
  const isCategory = v => Object.prototype.hasOwnProperty.call(categories, v);
  const isStatus = v => Object.prototype.hasOwnProperty.call(workflow, v);
  const timeLabel = () => nowLabel();
  const makeTicket = (text,id,createdAt) => {
    const category = classify(text);
    return {id,text,category,createdAt,reviewStatus:'received',draft:categories[category].answer || '',note:'',approvedText:null,updatedAt:null};
  };
  const defaultTickets = () => demoData.map((text,index)=>makeTicket(text,index+1,'예시 데이터'));
  const isValidLegacy = o => o && Number.isSafeInteger(o.id) && o.id>0 &&
    typeof o.text==='string' && o.text.trim().length>=1 && o.text.length<=280 &&
    isCategory(o.category) && o.category===classify(o.text) && typeof o.createdAt==='string';
  function isValidTicket(o) {
    if (!isValidLegacy(o) || !isStatus(o.reviewStatus) ||
      typeof o.draft!=='string' || o.draft.length>MAX_REPLY ||
      typeof o.note!=='string' || o.note.length>MAX_NOTE ||
      !(o.approvedText===null || (typeof o.approvedText==='string' && o.approvedText.length<=MAX_REPLY)) ||
      !(o.updatedAt===null || typeof o.updatedAt==='string')) return false;
    if (['approved','completed'].includes(o.reviewStatus)) {
      if (o.category!=='common' || !o.approvedText || o.draft!==o.approvedText) return false;
      if (draftPolicyError(o.approvedText)) return false;
    } else if (o.approvedText!==null) return false;
    return true;
  }
  function readStorage() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw !== null) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length<=MAX_COUNT && parsed.every(isValidTicket)) return parsed;
      }
      // Same origin on M1 upgrades once; no rewrites of the old storage key.
      const legacy = localStorage.getItem(LEGACY_KEY);
      if (legacy !== null) {
        const old = JSON.parse(legacy);
        if (Array.isArray(old) && old.length<=MAX_COUNT && old.every(isValidLegacy)) {
          return old.map(item=>makeTicket(item.text,item.id,item.createdAt));
        }
      }
    } catch (_) { /* corrupted/disabled storage: use fixed example records */ }
    return defaultTickets();
  }
  const node = (tag,className,text) => {
    const el=document.createElement(tag);
    if (className) el.className=className;
    if (text!==undefined) el.textContent=String(text);  // never inject user HTML
    return el;
  };
  const tagFor = category=>node('span',`tag tag-${categories[category].tag}`,categories[category].label);
  const statusFor = status=>node('span',`ticket-status ${status}`,workflow[status]);

  let tickets = readStorage();
  let selected = tickets[0]?.id ?? null;
  let filter = 'all';
  let statusFilter='all';
  let toastTimer;
  function persist(){try{localStorage.setItem(STORAGE_KEY,JSON.stringify(tickets));}catch(_){/* memory-only session */}}
  function notify(message){ui.toast.textContent=message;ui.toast.classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>ui.toast.classList.remove('visible'),2800);}
  function setInputError(message){ui.error.textContent=message;ui.error.hidden=!message;ui.input.setAttribute('aria-invalid',message?'true':'false');}
  function setReviewError(message){ui.reviewError.textContent=message;ui.reviewError.hidden=!message;}
  function updateCount(){ui.count.textContent=`${ui.input.value.length} / 280`;}
  function nextId(){return tickets.reduce((a,x)=>Math.max(a,x.id),0)+1;}
  function ticket(){return tickets.find(x=>x.id===selected);}
  const isDirty = t=>!!t&&(ui.reply.value!==t.draft||ui.note.value!==t.note);
  function visibleTickets(){return tickets.filter(t=>(filter==='all'||t.category===filter)&&(statusFilter==='all'||t.reviewStatus===statusFilter));}
  function renderMetrics(){
    const common=tickets.filter(t=>t.category==='common').length;
    const completed=tickets.filter(t=>t.reviewStatus==='completed').length;
    const metric=(el,n)=>el.replaceChildren(document.createTextNode(n+' '),node('small','','건'));
    metric(ui.total,tickets.length); metric(ui.common,common);
    metric(ui.review,tickets.length-common); metric(ui.completed,completed);
  }
  function renderList(){
    const data=visibleTickets();ui.list.replaceChildren();ui.empty.hidden=data.length!==0;
    data.slice().reverse().forEach(t=>{
      const li=node('li');
      const btn=node('button','ticket-button'+(selected===t.id?' selected':''));
      btn.type='button';btn.dataset.id=String(t.id);btn.setAttribute('aria-pressed',selected===t.id?'true':'false');
      btn.setAttribute('aria-label',`문의 ${t.id}, ${t.text}, ${categories[t.category].label}, ${workflow[t.reviewStatus]}`);
      const meta=node('div','ticket-meta');
      meta.append(node('span','ticket-id','MOA-'+String(t.id).padStart(3,'0')),tagFor(t.category),statusFor(t.reviewStatus),node('span','ticket-time',t.createdAt));
      btn.append(meta,node('p','ticket-text',t.text),node('p','ticket-desc',t.updatedAt?`${t.updatedAt} 검토 기록 · 자동 발송 없음`:'접수됨 · 운영자 검토 전'));
      li.append(btn);ui.list.append(li);
    });
  }
  function renderDetail(){
    const t=ticket();ui.detail.replaceChildren();
    if (!t){ui.detail.append(node('p','detail-empty','목록에서 문의를 선택해 주세요.'));return;}
    const meta=categories[t.category];const grid=node('div','detail-grid');
    const left=node('article','detail-box');left.append(node('p','box-label','문의 내용'),node('p','inquiry-value',t.text));
    const line=node('div','status-line');line.append(tagFor(t.category),statusFor(t.reviewStatus),node('span','ticket-id','MOA-'+String(t.id).padStart(3,'0')));
    left.append(line,node('p','detail-caption',meta.hint));
    const right=node('article','detail-box');
    right.append(node('p','box-label',meta.answer?(['approved','completed'].includes(t.reviewStatus)?'운영자 승인된 답변 · 데모 기록 / 미발송':'운영자가 저장한 초안 · 승인 전 / 미발송'):'공식 근거 부족 · 자동 답변 보류'));
    const summary=meta.answer?(t.draft||'답변 초안이 비어 있습니다. 운영자가 직접 확인해 주세요.'):'공식 자료로 확인되지 않아 자동 답변 초안을 만들지 않았습니다. 담당자가 확인해야 합니다.';
    right.append(node('p','answer'+(meta.answer?'':' placeholder'),summary));
    const notes=node('ul','result-list');notes.append(node('li','',`판단 근거: ${meta.source}`),node('li','',meta.answer?'검토 승인·처리 완료는 실무 발송과 무관한 데모 표시입니다.':'이 시연에는 추가 공식 근거가 없으므로 답변 승인을 막습니다.'));
    right.append(notes);
    if (t.reviewStatus==='completed') right.append(node('p','approval-note','검토 승인 후 처리 완료로 표시했습니다. 실제로 답변이 전송되지는 않았습니다.'));
    grid.append(left,right);ui.detail.append(grid);
  }
  function updateButtons(){
    const t=ticket(), none=!t, dirty=isDirty(t);
    const common=!!t&&t.category==='common';
    ui.save.disabled=none;ui.request.disabled=none;
    ui.sourceConfirmed.disabled=!common||!t||t.reviewStatus!=='in_review'||dirty;
    ui.approve.disabled=!common||!t||t.reviewStatus!=='in_review'||dirty||!ui.sourceConfirmed.checked;
    ui.complete.disabled=!t||t.reviewStatus!=='approved'||dirty;
    ui.reviewStatus.textContent=t?workflow[t.reviewStatus]:'선택한 문의 없음';
    ui.draftHint.textContent=none?'문의 목록에서 먼저 선택하세요.':common
      ? '공식 자료 01의 “교육 플랫폼 → 과제 제출 메뉴”만 근거로 삼을 수 있습니다. 초안을 수정하면 다시 저장·승인해야 합니다.'
      : '공식 답변 근거가 없으므로 답변 승인은 비활성화됩니다. 검토 메모를 남기고 추가 확인을 요청하세요.';
    ui.workflowHelp.textContent=none?'문의 선택 후 사용할 수 있습니다.':dirty
      ? '저장하지 않은 변경이 있습니다. 먼저 「초안 저장」을 눌러주세요.'
      : t.reviewStatus==='received'?'첫 단계: 초안과 검토 메모를 확인하고 「초안 저장」을 누르세요.'
      : t.reviewStatus==='in_review'?(common?'공식 자료와 일치함을 체크하고 「검토 승인」을 누르세요.':'공식 근거가 없으므로 「추가 확인 요청」으로 보류하세요.')
      : t.reviewStatus==='approved'?'승인된 초안만 「처리 완료」로 표시할 수 있습니다. 실제 발송은 하지 않습니다.'
      : t.reviewStatus==='completed'?'처리 완료 상태입니다. 수정 후 저장하면 승인 상태는 자동으로 해제됩니다.'
      : '담당자 확인을 요청한 상태입니다. 근거가 생기기 전에는 승인하지 않습니다.';
  }
  function renderEditor(){
    const t=ticket();setReviewError('');
    ui.reply.disabled=!t;ui.note.disabled=!t;
    ui.reply.value=t?.draft||'';ui.note.value=t?.note||'';ui.sourceConfirmed.checked=false;
    ui.reply.setAttribute('aria-invalid','false');
    updateButtons();
  }
  function render(){renderMetrics();renderList();renderDetail();renderEditor();}
  function confirmDiscard(){return !isDirty(ticket())||window.confirm('저장하지 않은 답변/메모 변경이 있습니다. 변경을 버리고 이동할까요?');}
  function ensureVisible(){const visible=visibleTickets();if(!visible.some(t=>t.id===selected))selected=visible.at(-1)?.id??null;}
  // A narrow deterrent for obvious fabricated dates, URLs, names of other menus or announcements.
  // Not a proof of factual accuracy: human confirmation is always mandatory.
  function draftPolicyError(text){
    const t=text.trim();
    if(t.length<5)return '답변 초안을 5자 이상 작성해 주세요.';
    if(!/교육\s*플랫폼/.test(t)||!/과제\s*제출/.test(t))return '공식 근거 01의 교육 플랫폼과 「과제 제출」 메뉴를 모두 포함해 주세요.';
    if(/\d|마감|기한|점수|평가|언제까지|기다리|별도\s*안내|추후|공지|메일|카카오|문자|전화|팀원|확인해\s*드리|내\s*강의실|학습\s*관리|\bhttps?:\/\/|@/i.test(t))return '공식 문서에 없는 일정·안내 약속·연락처·다른 메뉴 등이 포함된 것으로 보여 승인할 수 없습니다. 근거를 다시 확인해 주세요.';
    return '';
  }
  function handleSave(){
    const t=ticket();if(!t)return;
    const reply=ui.reply.value.trim(),note=ui.note.value.trim();
    if(reply.length>MAX_REPLY||note.length>MAX_NOTE){setReviewError('글자 수 제한을 확인해 주세요.');return;}
    if(t.category==='common'&&reply.length<5){setReviewError('공통 안내 답변 초안을 5자 이상 작성해 주세요.');return;}
    t.draft=reply;t.note=note;t.approvedText=null;t.reviewStatus='in_review';t.updatedAt=timeLabel();
    persist();render();notify('초안을 저장했습니다. 이전 승인은 해제됩니다.');
  }
  function handleRequest(){
    const t=ticket();if(!t)return;
    t.note=ui.note.value.trim();t.draft=ui.reply.value.trim();t.approvedText=null;t.reviewStatus='needs_info';t.updatedAt=timeLabel();
    persist();render();notify('추가 확인 요청으로 표시했습니다. 자동 발송은 없습니다.');
  }
  function handleApprove(){
    const t=ticket();if(!t)return;
    if(t.category!=='common'){setReviewError('공식 근거가 없는 문의는 승인할 수 없습니다.');return;}
    if(t.reviewStatus!=='in_review'){setReviewError('승인 전에 먼저 초안을 저장해 주세요.');return;}
    if(isDirty(t)){setReviewError('저장하지 않은 변경이 있습니다. 초안을 다시 저장해 주세요.');return;}
    if(!ui.sourceConfirmed.checked){setReviewError('공식 안내자료와 일치하는지 확인하고 체크해 주세요.');return;}
    const error=draftPolicyError(t.draft);
    if(error){setReviewError(error);return;}
    t.reviewStatus='approved';t.approvedText=t.draft;t.updatedAt=timeLabel();
    persist();render();notify('데모용 검토 승인이 기록됐습니다. 실제 답변은 발송되지 않았습니다.');
  }
  function handleComplete(){
    const t=ticket();if(!t)return;
    if(t.reviewStatus!=='approved'||t.approvedText!==t.draft||isDirty(t)){
      setReviewError('처리 완료 전 검토 승인과 변경 내용 저장이 필요합니다.');return;
    }
    t.reviewStatus='completed';t.updatedAt=timeLabel();persist();render();notify('처리 완료로 표시했습니다. 실제 전송은 하지 않았습니다.');
  }
  document.querySelectorAll('.example').forEach(button=>button.addEventListener('click',()=>{
    ui.input.value=examples[button.dataset.example];document.querySelectorAll('.example').forEach(b=>b.classList.toggle('active',b===button));setInputError('');updateCount();ui.input.focus();
  }));
  ui.input.addEventListener('input',()=>{setInputError('');updateCount();document.querySelectorAll('.example').forEach(b=>b.classList.remove('active'));});
  ui.form.addEventListener('submit',event=>{
    event.preventDefault();const text=ui.input.value.trim();
    if(text.length<3){setInputError('문의 내용을 3자 이상 입력해 주세요.');ui.input.focus();return;}
    if(text.length>280){setInputError('문의는 280자 이내로 입력해 주세요.');ui.input.focus();return;}
    if(tickets.length>=MAX_COUNT){setInputError('데모는 최대 100건까지만 저장할 수 있습니다. 초기화 후 사용해 주세요.');return;}
    if(!confirmDiscard())return;
    const id=nextId();tickets.push(makeTicket(text,id,timeLabel()));selected=id;filter='all';statusFilter='all';ui.filter.value='all';ui.statusFilter.value='all';persist();render();ui.input.value='';updateCount();setInputError('');document.querySelectorAll('.example').forEach(b=>b.classList.remove('active'));notify('문의 MOA-'+String(id).padStart(3,'0')+'이(가) 접수됐습니다.');
  });
  ui.list.addEventListener('click',event=>{
    const button=event.target.closest('button[data-id]');if(!button)return;
    const id=Number(button.dataset.id);if(id===selected||!tickets.some(t=>t.id===id)||!confirmDiscard())return;
    selected=id;renderList();renderDetail();renderEditor();
  });
  function changeFilter(kind,value){
    if(!confirmDiscard()) {ui.filter.value=filter;ui.statusFilter.value=statusFilter;return;}
    if(kind==='category')filter=value;else statusFilter=value;
    ensureVisible();renderList();renderDetail();renderEditor();
  }
  ui.filter.addEventListener('change',()=>changeFilter('category',ui.filter.value));
  ui.statusFilter.addEventListener('change',()=>changeFilter('status',ui.statusFilter.value));
  [ui.reply,ui.note].forEach(el=>el.addEventListener('input',()=>{ui.sourceConfirmed.checked=false;setReviewError('');updateButtons();}));
  ui.sourceConfirmed.addEventListener('change',()=>{setReviewError('');updateButtons();});
  ui.reviewForm.addEventListener('submit',e=>e.preventDefault());
  ui.save.addEventListener('click',handleSave);
  ui.request.addEventListener('click',handleRequest);
  ui.approve.addEventListener('click',handleApprove);
  ui.complete.addEventListener('click',handleComplete);
  ui.reset.addEventListener('click',()=>{
    if(!window.confirm('추가한 문의와 검토·승인·완료 표시를 모두 지우고 기본 가상 문의 3건으로 돌아갑니다. 초기화할까요?'))return;
    tickets=defaultTickets();selected=tickets[0].id;filter='all';statusFilter='all';ui.filter.value='all';ui.statusFilter.value='all';ui.input.value='';updateCount();setInputError('');persist();render();notify('모든 시연 데이터가 초기화됐습니다.');
  });
  persist();updateCount();render();
})();
