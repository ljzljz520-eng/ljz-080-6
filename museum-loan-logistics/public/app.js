/* 博物馆文物借展物流台 — 前端单页应用 */

const state = {
  user: null,
  loans: [],
  museums: [],
  pendingFiles: [],      // 待上传照片（开箱/装箱）
  detailLoanId: null,
};

const STATUS_MAP = {
  pending_packing: { label: '待装箱', cls: 's-pending_packing' },
  packed: { label: '已装箱', cls: 's-packed' },
  in_transit: { label: '运输中', cls: 's-in_transit' },
  arrived: { label: '已到馆签收', cls: 's-arrived' },
};
const STEP_ORDER = ['pending_packing', 'packed', 'in_transit', 'arrived'];
const STEP_LABELS = ['发起借展', '库房装箱', '物流发运', '到馆签收'];
const ROLE_HINTS = {
  curator: '策展人工作台：发起借展，录入文物编号、保险金额、环境要求与展期，跟踪全部借展单流转。',
  warehouse: '库房工作台：对待装箱文物进行点交装箱；任何一次开箱均须记录在场人员并上传照片。',
  logistics: '物流工作台：确认发运、回传运输温湿度、登记到馆签收。',
  museum: '外部展馆工作台：仅可查看本馆借到的文物状态，并对到馆开箱进行留证。',
  admin: '管理员工作台：拥有全部角色权限，可代行全流程操作。',
};

/* ---------------- 工具 ---------------- */

const $ = (sel) => document.querySelector(sel);
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function fmtDateTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
function fmtMoney(n) {
  if (n == null) return '—';
  return '¥ ' + Number(n).toLocaleString('zh-CN');
}
function toast(msg, type = '') {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast ' + type;
  t.hidden = false;
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => { t.hidden = true; }, 2600);
}

async function api(url, opts = {}) {
  const res = await fetch(url, {
    headers: opts.body instanceof FormData ? {} : { 'Content-Type': 'application/json' },
    ...opts,
  });
  let data = null;
  try { data = await res.json(); } catch { /* ignore */ }
  if (!res.ok) throw new Error((data && data.error) || '请求失败（' + res.status + '）');
  return data;
}

/* ---------------- 弹窗 ---------------- */

function openModal(title, html, wide = false) {
  $('#modalTitle').textContent = title;
  $('#modalBody').innerHTML = html;
  $('#modalBox').classList.toggle('wide', wide);
  $('#modalMask').hidden = false;
}
function closeModal() {
  $('#modalMask').hidden = true;
  state.pendingFiles = [];
}
$('#modalClose').addEventListener('click', closeModal);
$('#modalMask').addEventListener('click', (e) => { if (e.target.id === 'modalMask') closeModal(); });
$('#lightboxClose').addEventListener('click', () => { $('#lightbox').hidden = true; });
$('#lightbox').addEventListener('click', (e) => { if (e.target.id === 'lightbox') $('#lightbox').hidden = true; });

function showPhoto(photoId) {
  $('#lightboxImg').src = '/api/photos/' + encodeURIComponent(photoId);
  $('#lightbox').hidden = false;
}

/* ---------------- 登录 ---------------- */

$('#loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('#loginError').textContent = '';
  try {
    const data = await api('/api/login', {
      method: 'POST',
      body: JSON.stringify({ username: $('#loginUser').value.trim(), password: $('#loginPass').value }),
    });
    state.user = data.user;
    enterApp();
  } catch (err) {
    $('#loginError').textContent = err.message;
  }
});
document.querySelectorAll('.demo-grid button').forEach((btn) => {
  btn.addEventListener('click', () => {
    $('#loginUser').value = btn.dataset.u;
    $('#loginPass').value = '123456';
  });
});
$('#logoutBtn').addEventListener('click', async () => {
  await api('/api/logout', { method: 'POST' }).catch(() => {});
  state.user = null;
  location.reload();
});

/* ---------------- 进入主界面 ---------------- */

async function enterApp() {
  const u = state.user;
  $('#loginView').hidden = true;
  $('#appView').hidden = false;
  $('#userName').textContent = u.name;
  $('#roleBadge').textContent = { curator: '策展人', warehouse: '库房', logistics: '物流方', museum: '外部展馆', admin: '管理员' }[u.role];
  if (u.role === 'museum') {
    $('#orgBadge').hidden = false;
    $('#orgBadge').textContent = u.org || '';
  } else {
    $('#orgBadge').hidden = true;
  }
  $('#pageHint').textContent = ROLE_HINTS[u.role] || '';
  $('#newLoanBtn').hidden = !(u.role === 'curator' || u.role === 'admin');
  if (u.role === 'curator' || u.role === 'admin') {
    api('/api/museums').then((d) => { state.museums = d.museums; }).catch(() => {});
  }
  await loadLoans();
}

async function loadLoans() {
  const data = await api('/api/loans');
  state.loans = data.loans;
  renderList();
  if (state.detailLoanId) {
    const fresh = state.loans.find((l) => l.id === state.detailLoanId);
    if (fresh) openDetail(fresh.id, true);
  }
}

function renderList() {
  const wrap = $('#loanList');
  $('#emptyHint').hidden = state.loans.length > 0;
  wrap.innerHTML = state.loans.map((l) => {
    const st = STATUS_MAP[l.status];
    return `
    <article class="loan-card" data-id="${l.id}">
      <div class="loan-card-top">
        <span class="loan-no">${esc(l.loanNo)}</span>
        <span class="status ${st.cls}">${st.label}</span>
      </div>
      <div>
        <div class="artifact-name">${esc(l.artifactName || '未命名文物')}</div>
        <div class="artifact-code">文物编号：${esc(l.artifactCode)}</div>
      </div>
      <dl class="loan-meta">
        <dt>借入展馆</dt><dd>${esc(l.museumName)}</dd>
        <dt>展期</dt><dd>${esc(l.startDate)} ~ ${esc(l.endDate)}</dd>
        <dt>环境要求</dt><dd title="${esc(l.envRequirement)}">${esc(l.envRequirement.length > 26 ? l.envRequirement.slice(0, 26) + '…' : l.envRequirement)}</dd>
        ${l.insuredValue != null ? `<dt>保险金额</dt><dd class="money">${fmtMoney(l.insuredValue)}</dd>` : ''}
      </dl>
      <div class="loan-foot">
        <span>
          <span class="chip-count">🌡 ${l.envLogCount}</span>
          <span class="chip-count">📦 ${l.openEventCount} 次开箱</span>
        </span>
        <span>发起于 ${fmtDateTime(l.createdAt).slice(0, 10)}</span>
      </div>
    </article>`;
  }).join('');
  wrap.querySelectorAll('.loan-card').forEach((card) => {
    card.addEventListener('click', () => openDetail(card.dataset.id));
  });
}

/* ---------------- 借展详情 ---------------- */

async function openDetail(id, backgroundRefresh = false) {
  state.detailLoanId = id;
  const { loan } = await api('/api/loans/' + id);
  const u = state.user;
  const st = STATUS_MAP[loan.status];
  const isMuseum = u.role === 'museum';
  const isAdmin = u.role === 'admin';

  const steps = STEP_ORDER.map((s, i) => {
    const cur = STEP_ORDER.indexOf(loan.status);
    const cls = i < cur ? 'done' : i === cur ? (i === 0 ? 'done current' : 'current') : '';
    return `<div class="step ${cls}">${STEP_LABELS[i]}</div>`;
  }).join('');

  const actions = [];
  if ((u.role === 'warehouse' || isAdmin) && loan.status === 'pending_packing') {
    actions.push(`<button class="btn btn-primary" id="actPack">✔ 确认装箱</button>`);
  }
  if ((u.role === 'logistics' || isAdmin) && loan.status === 'packed') {
    actions.push(`<button class="btn btn-primary" id="actShip">🚚 确认发运</button>`);
  }
  if ((u.role === 'logistics' || isAdmin) && loan.status === 'in_transit') {
    actions.push(`<button class="btn btn-gold" id="actArrive">🏛 到馆签收</button>`);
  }
  if ((u.role === 'logistics' || isAdmin) && ['packed', 'in_transit', 'arrived'].includes(loan.status)) {
    actions.push(`<button class="btn btn-outline" id="actEnv">🌡 回传温湿度</button>`);
  }
  if (!isMuseum || loan.status !== 'pending_packing') {
    actions.push(`<button class="btn btn-outline" id="actOpen">📷 登记开箱记录</button>`);
  }

  const envRows = loan.envLogs.length
    ? loan.envLogs.map((e) => `
      <tr>
        <td class="env-num">${esc(e.temp.toFixed(1))} ℃</td>
        <td class="env-num">${esc(e.humidity.toFixed(1))} %RH</td>
        <td>${esc(e.location || '—')}</td>
        <td>${esc(e.note || '—')}</td>
        <td>${esc(e.operatorName)}<br><span class="tl-time">${fmtDateTime(e.at)}</span></td>
      </tr>`).join('')
    : `<tr><td colspan="5" class="empty" style="padding:24px">暂无温湿度记录</td></tr>`;

  const openItems = loan.openEvents.length
    ? loan.openEvents.map((o) => `
      <div class="open-item">
        <div class="open-head">
          <div class="open-stage">${esc(o.stage)}</div>
          <div class="open-meta">${fmtDateTime(o.at)} · 记录人 ${esc(o.operatorName)}</div>
        </div>
        <div class="open-meta">在场人员：<b>${esc(o.persons)}</b>${o.witness ? '　｜　见证/监督：' + esc(o.witness) : ''}</div>
        ${o.note ? `<div class="open-note">${esc(o.note)}</div>` : ''}
        <div class="photo-thumbs">
          ${o.photos.map((p) => `<img class="photo-thumb" data-ph="${p.id}" src="/api/photos/${encodeURIComponent(p.id)}" alt="${esc(p.originalName)}" title="${esc(p.originalName)}">`).join('')}
        </div>
      </div>`).join('')
    : `<div class="empty" style="padding:20px">尚无开箱记录——任何一次开箱都必须在此留证</div>`;

  const timeline = loan.timeline.map((t) => `
    <li class="t-${esc(t.type)}">
      <div class="tl-title">${esc(t.title)}</div>
      <div class="tl-detail">${esc(t.detail || '')}</div>
      <div class="tl-time">${fmtDateTime(t.at)} · ${esc(t.operatorName)}</div>
    </li>`).join('');

  openModal(`借展单 ${esc(loan.loanNo)}`, `
    ${isMuseum ? `<div class="isolation-note">🔒 您正在以外部展馆身份查看，仅可见本馆借到的文物；保险金额等馆方内部信息已隐藏。</div>` : ''}
    <div class="detail-status-row">
      <span class="status ${st.cls}">${st.label}</span>
      <span class="artifact-code">${esc(loan.artifactCode)}${loan.artifactName ? ' · ' + esc(loan.artifactName) : ''}</span>
    </div>
    <div class="steps">${steps}</div>

    ${actions.length ? `<div class="action-bar">${actions.join('')}</div>` : ''}

    <div class="section-title">借展信息</div>
    <div class="detail-grid">
      <div class="cell"><div class="k">文物编号</div><div class="v">${esc(loan.artifactCode)}</div></div>
      <div class="cell"><div class="k">文物名称</div><div class="v">${esc(loan.artifactName || '—')}</div></div>
      ${!isMuseum ? `<div class="cell"><div class="k">保险金额</div><div class="v money">${fmtMoney(loan.insuredValue)}</div></div>` : ''}
      <div class="cell"><div class="k">借入展馆</div><div class="v">${esc(loan.museumName)}</div></div>
      <div class="cell"><div class="k">展期开始</div><div class="v">${esc(loan.startDate)}</div></div>
      <div class="cell"><div class="k">展期结束</div><div class="v">${esc(loan.endDate)}</div></div>
      <div class="cell full"><div class="k">环境要求（温湿度 / 光照 / 防震等）</div><div class="v">${esc(loan.envRequirement)}</div></div>
      ${loan.remark ? `<div class="cell full"><div class="k">备注</div><div class="v">${esc(loan.remark)}</div></div>` : ''}
      ${loan.shipper ? `<div class="cell"><div class="k">承运方</div><div class="v">${esc(loan.shipper)}</div></div>` : ''}
      ${loan.signedBy ? `<div class="cell"><div class="k">到馆签收人</div><div class="v">${esc(loan.signedBy)}</div></div>` : ''}
    </div>

    <div class="section-title">🌡 温湿度记录（物流回传）</div>
    <table class="env-table">
      <thead><tr><th>温度</th><th>湿度</th><th>位置</th><th>备注</th><th>回传人/时间</th></tr></thead>
      <tbody>${envRows}</tbody>
    </table>

    <div class="section-title">📦 开箱留证（人员 + 照片，缺一不可）</div>
    ${openItems}

    <div class="section-title">流转时间线</div>
    <ul class="timeline">${timeline}</ul>
  `, true);

  // 绑定图片预览
  $('#modalBody').querySelectorAll('.photo-thumb').forEach((img) => {
    img.addEventListener('click', () => showPhoto(img.dataset.ph));
  });
  // 绑定动作
  const bind = (id, fn) => { const el = $('#' + id); if (el) el.addEventListener('click', fn); };
  bind('actPack', () => packForm(loan));
  bind('actShip', () => shipForm(loan));
  bind('actArrive', () => arriveForm(loan));
  bind('actEnv', () => envForm(loan));
  bind('actOpen', () => openEventForm(loan));
}

/* ---------------- 发起借展 ---------------- */

$('#newLoanBtn').addEventListener('click', () => {
  const today = new Date().toISOString().slice(0, 10);
  const opts = state.museums.map((m) => `<option value="${m.id}">${esc(m.org)}（联络人 ${esc(m.name)}）</option>`).join('');
  openModal('发起文物借展', `
    <form id="loanForm">
      <div class="form-row">
        <label>文物编号 <span class="required-mark">*</span>
          <input name="artifactCode" required placeholder="如 TANG-CAI-0173">
        </label>
        <label>文物名称
          <input name="artifactName" placeholder="选填，便于识别">
        </label>
      </div>
      <div class="form-row">
        <label>保险金额（元）<span class="required-mark">*</span>
          <input name="insuredValue" type="number" min="1" step="1" required placeholder="如 8000000">
          <div class="field-hint">保险金额仅馆方角色可见，外部展馆不可见</div>
        </label>
        <label>借入展馆 <span class="required-mark">*</span>
          <select name="museumId" required>
            <option value="">请选择外部展馆</option>
            ${opts}
          </select>
        </label>
      </div>
      <label>环境要求 <span class="required-mark">*</span>
        <textarea name="envRequirement" required placeholder="温度、湿度、照度、防震、包装材料等要求"></textarea>
      </label>
      <div class="form-row">
        <label>展期开始 <span class="required-mark">*</span>
          <input name="startDate" type="date" required value="${today}">
        </label>
        <label>展期结束 <span class="required-mark">*</span>
          <input name="endDate" type="date" required>
        </label>
      </div>
      <label>备注
        <textarea name="remark" placeholder="选填"></textarea>
      </label>
      <div class="form-error" id="loanFormErr"></div>
      <div style="display:flex;gap:10px;margin-top:16px">
        <button type="button" class="btn btn-ghost" id="loanCancel">取消</button>
        <button type="submit" class="btn btn-primary" style="flex:1">提交借展单</button>
      </div>
    </form>`);
  $('#loanCancel').addEventListener('click', () => { state.detailLoanId = null; closeModal(); });
  $('#loanForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const payload = Object.fromEntries(fd.entries());
    const btn = e.target.querySelector('button[type=submit]');
    btn.disabled = true;
    try {
      await api('/api/loans', { method: 'POST', body: JSON.stringify(payload) });
      toast('借展单已发起，等待库房装箱', 'ok');
      state.detailLoanId = null;
      closeModal();
      await loadLoans();
    } catch (err) {
      $('#loanFormErr').textContent = err.message;
      btn.disabled = false;
    }
  });
});

/* ---------------- 照片选择组件 ---------------- */

function photoInputHtml(id) {
  return `
    <label>现场照片 <span class="required-mark">*</span>（至少 1 张，单张 ≤ 10MB，最多 9 张）
      <input type="file" id="${id}" accept="image/*,.svg" multiple>
    </label>
    <div class="photo-preview" id="${id}Preview"></div>`;
}
function bindPhotoPicker(inputId) {
  const input = $('#' + inputId);
  const preview = $('#' + inputId + 'Preview');
  input.addEventListener('change', () => {
    for (const f of input.files) {
      if (state.pendingFiles.length >= 9) { toast('最多上传 9 张照片'); break; }
      state.pendingFiles.push(f);
    }
    input.value = '';
    renderPending();
  });
  function renderPending() {
    preview.innerHTML = state.pendingFiles.map((f, i) => `
      <div class="pv">
        <img src="${URL.createObjectURL(f)}" alt="">
        <button type="button" class="rm" data-i="${i}">×</button>
      </div>`).join('');
    preview.querySelectorAll('.rm').forEach((b) => b.addEventListener('click', () => {
      state.pendingFiles.splice(Number(b.dataset.i), 1);
      renderPending();
    }));
  }
  renderPending();
}

function buildOpenPayload(formEl, extra = {}) {
  const fd = new FormData(formEl);
  for (const [k, v] of Object.entries(extra)) fd.set(k, v);
  state.pendingFiles.forEach((f) => fd.append('photos', f));
  return fd;
}

/* ---------------- 库房装箱 ---------------- */

function packForm(loan) {
  openModal('库房确认装箱 · ' + loan.loanNo, `
    <div class="isolation-note">装箱前如发生开箱点交，<b>必须登记在场人员并上传现场照片</b>；未开箱可直接封箱。</div>
    <form id="packForm">
      <div class="form-row">
        <label>开箱环节
          <input name="stage" value="库房点交（装箱前开箱）">
        </label>
        <label>在场人员 <span class="required-mark">*</span>
          <input name="persons" placeholder="如 王库房、陈策展（多人顿号分隔）">
        </label>
      </div>
      <label>见证/监督人员
        <input name="witness" placeholder="选填，如外馆随员、保卫处人员">
      </label>
      <label>点交情况说明
        <textarea name="note" placeholder="文物状况、包装方式等"></textarea>
      </label>
      ${photoInputHtml('packPhotos')}
      <div class="form-error" id="packErr"></div>
      <div style="display:flex;gap:10px;margin-top:16px">
        <button type="button" class="btn btn-ghost" id="packBack">返回</button>
        <button type="submit" class="btn btn-primary" style="flex:1">确认装箱并留证</button>
      </div>
    </form>`);
  state.pendingFiles = [];
  bindPhotoPicker('packPhotos');
  $('#packBack').addEventListener('click', () => openDetail(loan.id, true));
  $('#packForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const persons = e.target.elements.persons.value.trim();
    if ((persons || state.pendingFiles.length) && (!persons || state.pendingFiles.length === 0)) {
      $('#packErr').textContent = '任何一次开箱都必须同时记录在场人员并至少上传 1 张照片';
      return;
    }
    try {
      await api('/api/loans/' + loan.id + '/pack', { method: 'POST', body: buildOpenPayload(e.target) });
      toast('装箱已确认', 'ok');
      closeModal();
      await loadLoans();
    } catch (err) { $('#packErr').textContent = err.message; }
  });
}

/* ---------------- 物流发运 ---------------- */

function shipForm(loan) {
  openModal('物流确认发运 · ' + loan.loanNo, `
    <form id="shipForm">
      <label>承运方名称 <span class="required-mark">*</span>
        <input name="shipper" required placeholder="如 华协文物运输（上海）有限公司" value="${esc(loan.shipper || '')}">
      </label>
      <div class="upload-hint">发运后请在运输途中持续回传温湿度数据。</div>
      <div class="form-error" id="shipErr"></div>
      <div style="display:flex;gap:10px;margin-top:16px">
        <button type="button" class="btn btn-ghost" id="shipBack">返回</button>
        <button type="submit" class="btn btn-primary" style="flex:1">确认发运</button>
      </div>
    </form>`);
  $('#shipBack').addEventListener('click', () => openDetail(loan.id, true));
  $('#shipForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('/api/loans/' + loan.id + '/ship', {
        method: 'POST',
        body: JSON.stringify({ shipper: e.target.elements.shipper.value.trim() }),
      });
      toast('文物已启运', 'ok');
      closeModal();
      await loadLoans();
    } catch (err) { $('#shipErr').textContent = err.message; }
  });
}

/* ---------------- 到馆签收 ---------------- */

function arriveForm(loan) {
  openModal('到馆签收 · ' + loan.loanNo, `
    <form id="arriveForm">
      <div class="isolation-note">文物运抵 <b>${esc(loan.museumName)}</b>，登记签收人后状态更新为「已到馆签收」。开箱验收请另记开箱留证。</div>
      <label>签收人 <span class="required-mark">*</span>
        <input name="signedBy" required placeholder="外馆接收人姓名">
      </label>
      <div class="form-error" id="arriveErr"></div>
      <div style="display:flex;gap:10px;margin-top:16px">
        <button type="button" class="btn btn-ghost" id="arriveBack">返回</button>
        <button type="submit" class="btn btn-gold" style="flex:1">确认到馆签收</button>
      </div>
    </form>`);
  $('#arriveBack').addEventListener('click', () => openDetail(loan.id, true));
  $('#arriveForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('/api/loans/' + loan.id + '/arrive', {
        method: 'POST', body: JSON.stringify({ signedBy: e.target.elements.signedBy.value.trim() }),
      });
      toast('到馆签收完成', 'ok');
      closeModal();
      await loadLoans();
    } catch (err) { $('#arriveErr').textContent = err.message; }
  });
}

/* ---------------- 温湿度回传 ---------------- */

function envForm(loan) {
  openModal('回传温湿度 · ' + loan.loanNo, `
    <form id="envForm">
      <div class="form-row">
        <label>温度（℃）<span class="required-mark">*</span>
          <input name="temp" type="number" step="0.1" min="-50" max="80" required placeholder="如 20.5">
        </label>
        <label>相对湿度（%RH）<span class="required-mark">*</span>
          <input name="humidity" type="number" step="0.1" min="0" max="100" required placeholder="如 52.0">
        </label>
      </div>
      <label>当前位置
        <input name="location" placeholder="如 运输途中 · G42 常州段 / 博物馆卸货区">
      </label>
      <label>备注
        <textarea name="note" placeholder="选填，如 数据正常、已开箱等"></textarea>
      </label>
      <div class="form-error" id="envErr"></div>
      <div style="display:flex;gap:10px;margin-top:16px">
        <button type="button" class="btn btn-ghost" id="envBack">返回</button>
        <button type="submit" class="btn btn-primary" style="flex:1">提交温湿度记录</button>
      </div>
    </form>`);
  $('#envBack').addEventListener('click', () => openDetail(loan.id, true));
  $('#envForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('/api/loans/' + loan.id + '/env-logs', {
        method: 'POST', body: buildOpenPayload(e.target),
      });
      toast('温湿度已回传', 'ok');
      closeModal();
      await loadLoans();
    } catch (err) { $('#envErr').textContent = err.message; }
  });
}

/* ---------------- 开箱留证 ---------------- */

function openEventForm(loan) {
  const defaultStage = loan.status === 'arrived' ? '到馆开箱' : loan.status === 'in_transit' ? '运输途中开箱' : '库房点交（装箱前开箱）';
  openModal('开箱留证 · ' + loan.loanNo, `
    <form id="openForm">
      <div class="isolation-note">制度要求：<b>任何一次开箱都必须登记在场人员并拍摄现场照片</b>，二者缺一不可。</div>
      <div class="form-row">
        <label>开箱环节 <span class="required-mark">*</span>
          <input name="stage" value="${esc(defaultStage)}">
        </label>
        <label>在场人员 <span class="required-mark">*</span>
          <input name="persons" required placeholder="如 李运输、周联络（多人顿号分隔）">
        </label>
      </div>
      <label>见证/监督人员
        <input name="witness" placeholder="选填，如 文保员、公证方">
      </label>
      <label>开箱情况说明
        <textarea name="note" placeholder="文物外观、包装状态、与点交单核对结果等"></textarea>
      </label>
      ${photoInputHtml('openPhotos')}
      <div class="form-error" id="openErr"></div>
      <div style="display:flex;gap:10px;margin-top:16px">
        <button type="button" class="btn btn-ghost" id="openBack">返回</button>
        <button type="submit" class="btn btn-primary" style="flex:1">提交开箱记录</button>
      </div>
    </form>`);
  state.pendingFiles = [];
  bindPhotoPicker('openPhotos');
  $('#openBack').addEventListener('click', () => openDetail(loan.id, true));
  $('#openForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!e.target.elements.persons.value.trim()) { $('#openErr').textContent = '请填写在场人员'; return; }
    if (state.pendingFiles.length === 0) { $('#openErr').textContent = '请至少上传 1 张开箱现场照片'; return; }
    try {
      await api('/api/loans/' + loan.id + '/open-events', { method: 'POST', body: buildOpenPayload(e.target) });
      toast('开箱记录已留存', 'ok');
      closeModal();
      await loadLoans();
    } catch (err) { $('#openErr').textContent = err.message; }
  });
}

/* ---------------- 启动：恢复会话 ---------------- */

(async function init() {
  try {
    const data = await api('/api/me');
    state.user = data.user;
    enterApp();
  } catch {
    $('#loginView').hidden = false;
  }
})();
