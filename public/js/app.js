/* 博物馆文物借展物流台 — 前端 SPA（原生 JS） */
(function () {
  'use strict';

  // ---------------- 基础工具 ----------------
  const $ = (sel, root = document) => root.querySelector(sel);
  const el = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function toast(msg, type = '') {
    const t = $('#toast');
    t.textContent = msg;
    t.className = 'toast ' + type;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.add('hidden'), 2600);
  }

  async function api(path, opts = {}) {
    const init = { method: opts.method || 'GET', headers: {} };
    if (opts.body instanceof FormData) {
      init.body = opts.body;
    } else if (opts.body !== undefined) {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    const resp = await fetch(path, init);
    let data = null;
    try { data = await resp.json(); } catch (e) { /* ignore */ }
    if (!resp.ok) throw new Error((data && data.error) || '请求失败 (' + resp.status + ')');
    return data;
  }

  // ---------------- 全局状态 ----------------
  const state = {
    user: null,
    museums: [],
    route: '',
    statusFilter: 'all',
  };

  const STATUS_LABEL = { requested: '待装箱', packed: '已装箱', shipped: '在途', arrived: '已到馆', returned: '已归还', cancelled: '已取消' };
  const SCENE_LABEL = { arrival: '到馆开箱', inspection: '展中检查开箱', repack: '撤展复装', return: '归还点交开箱' };
  const STEPS = [
    { key: 'requested', label: '发起借展' },
    { key: 'packed', label: '库房装箱' },
    { key: 'shipped', label: '发运在途' },
    { key: 'arrived', label: '到馆签收' },
    { key: 'returned', label: '归还' },
  ];

  const fmtMoney = (n) => '¥' + Number(n || 0).toLocaleString('zh-CN');
  const fmtDT = (s) => s ? new Date(s).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';
  const fmtDTFull = (s) => s ? new Date(s).toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';
  const fmtDate = (s) => s || '—';
  const byId = (id, list) => (list || []).find(x => x.id === id);

  function museumName(id) { const m = byId(id, state.museums); return m ? m.name : '—'; }
  function userName(id, loan) {
    // 详情里可从事件 actor 反查；简单起见返回映射
    const map = { u_cur: '李清照', u_wh1: '赵守库', u_log: '孙承运', u_m1: '王馆长', u_m2: '陈主任' };
    return map[id] || (id || '');
  }
  function inRange(v, min, max) { return v >= min && v <= max; }

  // ---------------- 登录 / 登出 ----------------
  async function init() {
    bindGlobal();
    try {
      state.user = await api('/api/auth/me');
      await loadMuseums();
      showApp();
    } catch (e) {
      showLogin();
    }
    handleRoute();
  }

  function bindGlobal() {
    $('#login-form').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const f = ev.target;
      const errBox = $('#login-error');
      errBox.classList.add('hidden');
      try {
        state.user = await api('/api/auth/login', { method: 'POST', body: { username: f.username.value, password: f.password.value } });
        await loadMuseums();
        showApp();
        location.hash = '#/loans';
        toast('欢迎，' + state.user.name, 'success');
      } catch (e) {
        errBox.textContent = e.message;
        errBox.classList.remove('hidden');
      }
    });
    document.querySelectorAll('.demo-accounts button').forEach(btn => {
      btn.addEventListener('click', () => {
        $('#login-form').username.value = btn.dataset.u;
        $('#login-form').password.value = btn.dataset.p;
      });
    });
    $('#logout-btn').addEventListener('click', async () => {
      await api('/api/auth/logout', { method: 'POST' }).catch(() => {});
      state.user = null;
      location.hash = '';
      showLogin();
    });
    $('#lightbox').addEventListener('click', () => $('#lightbox').classList.add('hidden'));
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { $('#lightbox').classList.add('hidden'); closeModal(); }
    });
    window.addEventListener('hashchange', handleRoute);
  }

  async function loadMuseums() {
    try { state.museums = await api('/api/museums'); } catch (e) { state.museums = []; }
  }

  function showLogin() {
    $('#login-view').classList.remove('hidden');
    $('#app-view').classList.add('hidden');
  }
  function showApp() {
    $('#login-view').classList.add('hidden');
    $('#app-view').classList.remove('hidden');
    const u = state.user;
    $('#user-name').textContent = u.name;
    const role = $('#user-role');
    role.textContent = u.roleLabel + (u.museumName ? ' · ' + u.museumName : '');
    role.className = 'role-badge ' + u.role;
    $('#nav-new').classList.toggle('hidden', u.role !== 'curator');
  }

  // ---------------- 路由 ----------------
  function handleRoute() {
    if (!state.user) return;
    const hash = location.hash || '#/loans';
    const path = hash.replace(/^#/, '') || '/loans';
    state.route = path;
    document.querySelectorAll('.topnav a').forEach(a => a.classList.toggle('active', path.startsWith(a.dataset.route)));

    const main = $('#main');
    main.innerHTML = '';
    const m = path.match(/^\/loans\/([\w-]+)$/);
    if (path === '/new' && state.user.role === 'curator') renderNew();
    else if (m) renderDetail(m[1]);
    else renderList();
  }
  const go = (hash) => { location.hash = hash; };

  // ---------------- 列表页 ----------------
  async function renderList() {
    const main = $('#main');
    main.appendChild(el('<div id="list-loading" class="card"><p class="muted">加载中…</p></div>'));
    let loans;
    try { loans = await api('/api/loans'); } catch (e) { $('#list-loading').innerHTML = '<div class="empty">加载失败：' + esc(e.message) + '</div>'; return; }

    const counts = { all: loans.length, requested: 0, packed: 0, shipped: 0, arrived: 0, returned: 0 };
    loans.forEach(l => { counts[l.status] = (counts[l.status] || 0) + 1; });
    const alarms = loans.filter(l => l.trackings.some(t => t.alarm)).length;

    const head = el(`
      <div class="page-head">
        <div>
          <h2>借展单</h2>
          <div class="sub">${state.user.role === 'museum' ? '仅显示本馆借到的文物 · 数据隔离' : '全部借展流程一览'}</div>
        </div>
        ${state.user.role === 'curator' ? '<button class="btn btn-primary" id="btn-new">＋ 发起借展</button>' : ''}
      </div>`);
    head.querySelector('#btn-new')?.addEventListener('click', () => go('#/new'));

    const stats = el(`
      <div class="stat-row">
        <div class="stat-box"><div class="n">${counts.all}</div><div class="l">借展单总数</div></div>
        <div class="stat-box"><div class="n">${counts.requested}</div><div class="l">待装箱</div></div>
        <div class="stat-box"><div class="n">${counts.shipped}</div><div class="l">在途</div></div>
        <div class="stat-box"><div class="n">${counts.arrived}</div><div class="l">已到馆</div></div>
        <div class="stat-box ${alarms ? 'alarm' : ''}"><div class="n">${alarms}</div><div class="l">温湿度告警单据</div></div>
      </div>`);

    const filters = ['all', 'requested', 'packed', 'shipped', 'arrived', 'returned'];
    const filterBar = el('<div class="filter-bar">' + filters.map(f =>
      `<button data-f="${f}" class="${state.statusFilter === f ? 'active' : ''}">${f === 'all' ? '全部' : STATUS_LABEL[f]}${f !== 'all' && counts[f] ? ' ' + counts[f] : ''}</button>`
    ).join('') + '</div>');
    filterBar.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
      state.statusFilter = b.dataset.f;
      renderList();
    }));

    const rows = loans
      .filter(l => state.statusFilter === 'all' || l.status === state.statusFilter)
      .map(l => {
        const alarm = l.trackings.some(t => t.alarm);
        const lastTk = l.trackings[l.trackings.length - 1];
        return `
        <tr data-id="${l.id}" style="cursor:pointer">
          <td class="mono">${l.id}</td>
          <td>
            <div><b>${esc(l.artifactName)}</b></div>
            <div class="muted mono" style="font-size:12px">${esc(l.artifactNo)}${l.dynasty ? ' · ' + esc(l.dynasty) : ''}</div>
          </td>
          <td>${state.user.role === 'museum' ? '本馆' : esc(l.borrowerName)}</td>
          <td class="num">${fmtMoney(l.insuranceAmount)}</td>
          <td style="font-size:12.5px">${fmtDate(l.startDate)}<br><span class="muted">至 ${fmtDate(l.endDate)}</span></td>
          <td>
            ${lastTk ? `<span class="${lastTk.alarm ? 'temp-val alarm' : ''}">${lastTk.temperature}℃</span> / <span class="${lastTk.alarm ? 'hum-val alarm' : ''}">${lastTk.humidity}%</span>` : '<span class="muted">—</span>'}
            ${alarm ? '<span class="badge-alarm">告警</span>' : ''}
          </td>
          <td><span class="status ${l.status}">${STATUS_LABEL[l.status]}</span></td>
          <td class="muted" style="font-size:12px">${fmtDT(l.updatedAt)}</td>
        </tr>`;
      }).join('');

    const card = el(`
      <div class="card" style="padding:0;overflow:hidden">
        <table class="data-table">
          <thead><tr>
            <th>单号</th><th>文物</th><th>借入展馆</th><th class="num">保险金额</th>
            <th>展期</th><th>最新温湿度</th><th>状态</th><th>更新时间</th>
          </tr></thead>
          <tbody>${rows || '<tr><td colspan="8" class="empty">暂无符合条件的借展单</td></tr>'}</tbody>
        </table>
      </div>`);
    card.querySelectorAll('tbody tr[data-id]').forEach(tr => {
      tr.addEventListener('click', () => go('#/loans/' + tr.dataset.id));
    });

    $('#list-loading')?.remove();
    main.append(head, stats, filterBar, card);
  }

  // ---------------- 发起借展（策展人） ----------------
  function renderNew() {
    const main = $('#main');
    const museumOpts = state.museums.map(m => `<option value="${m.id}">${esc(m.name)}</option>`).join('');
    const view = el(`
      <div>
        <div class="page-head">
          <div><h2>发起文物借展</h2><div class="sub">录入文物、保险与环境要求后，流转至库房安排装箱</div></div>
          <button class="btn" id="btn-back">← 返回列表</button>
        </div>
        <form id="loan-form">
          <div class="card">
            <h3>文物与借入方</h3>
            <div class="form-grid">
              <div class="form-field"><label>文物编号<span class="req">*</span></label><input name="artifactNo" required placeholder="如 GW-MING-0317"></div>
              <div class="form-field"><label>文物名称<span class="req">*</span></label><input name="artifactName" required placeholder="如 青花缠枝莲纹梅瓶"></div>
              <div class="form-field"><label>年代</label><input name="dynasty" placeholder="如 明·永乐"></div>
              <div class="form-field"><label>借入展馆<span class="req">*</span></label><select name="borrowerId" required><option value="">请选择…</option>${museumOpts}</select></div>
              <div class="form-field"><label>保险金额（元）<span class="req">*</span></label><input name="insuranceAmount" type="number" min="1" step="1" required placeholder="如 6800000"></div>
              <div class="form-field"><label>备注</label><input name="notes" placeholder="展览名称/展厅位置等（可选）"></div>
            </div>
          </div>
          <div class="card">
            <h3>环境与运输要求</h3>
            <div class="form-grid">
              <div class="form-field"><label>温度下限（℃）<span class="req">*</span></label><input name="tempMin" type="number" step="0.1" value="18" required></div>
              <div class="form-field"><label>温度上限（℃）<span class="req">*</span></label><input name="tempMax" type="number" step="0.1" value="22" required></div>
              <div class="form-field"><label>相对湿度下限（%）<span class="req">*</span></label><input name="humMin" type="number" step="1" value="50" required></div>
              <div class="form-field"><label>相对湿度上限（%）<span class="req">*</span></label><input name="humMax" type="number" step="1" value="55" required></div>
              <div class="form-field"><label>照度上限（lux）<span class="req">*</span></label><input name="lightLux" type="number" step="1" value="150" required></div>
              <div class="form-field full"><label>防震 / 搬运要求<span class="req">*</span></label><input name="vibration" required placeholder="如 防震搬运，倾角小于 15°，禁止叠压"></div>
              <div class="form-field full"><label>其他环境要求</label><textarea name="extra" placeholder="包装材料、静置要求、禁忌等（可选）"></textarea></div>
            </div>
          </div>
          <div class="card">
            <h3>展期</h3>
            <div class="form-grid">
              <div class="form-field"><label>开始日期<span class="req">*</span></label><input name="startDate" type="date" required></div>
              <div class="form-field"><label>结束日期<span class="req">*</span></label><input name="endDate" type="date" required></div>
            </div>
            <div class="form-actions">
              <button type="button" class="btn" id="btn-cancel">取消</button>
              <button type="submit" class="btn btn-primary">提交借展申请</button>
            </div>
          </div>
        </form>
      </div>`);
    view.querySelector('#btn-back').addEventListener('click', () => go('#/loans'));
    view.querySelector('#btn-cancel').addEventListener('click', () => go('#/loans'));
    view.querySelector('#loan-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const payload = {
        artifactNo: fd.get('artifactNo'), artifactName: fd.get('artifactName'), dynasty: fd.get('dynasty'),
        borrowerId: fd.get('borrowerId'), insuranceAmount: Number(fd.get('insuranceAmount')), notes: fd.get('notes'),
        startDate: fd.get('startDate'), endDate: fd.get('endDate'),
        requirements: {
          tempMin: Number(fd.get('tempMin')), tempMax: Number(fd.get('tempMax')),
          humMin: Number(fd.get('humMin')), humMax: Number(fd.get('humMax')),
          lightLux: Number(fd.get('lightLux')), vibration: fd.get('vibration'), extra: fd.get('extra'),
        }
      };
      try {
        const loan = await api('/api/loans', { method: 'POST', body: payload });
        toast('借展单 ' + loan.id + ' 已创建，等待库房装箱', 'success');
        go('#/loans/' + loan.id);
      } catch (err) { toast(err.message, 'error'); }
    });
    main.appendChild(view);
  }

  // ---------------- 详情页 ----------------
  async function renderDetail(id) {
    const main = $('#main');
    main.appendChild(el('<div class="card"><p class="muted">加载中…</p></div>'));
    let loan;
    try { loan = await api('/api/loans/' + id); } catch (e) {
      main.innerHTML = '';
      main.appendChild(el(`<div class="card empty"><div class="big">🔍</div>${esc(e.message)}<div style="margin-top:14px"><a class="btn" href="#/loans">返回列表</a></div></div>`));
      return;
    }
    main.innerHTML = '';
    const r = loan.requirements;
    const curStepIdx = loan.status === 'cancelled' ? -1 : STEPS.findIndex(s => s.key === loan.status);

    const view = el('<div></div>');

    // 头部
    const head = el(`
      <div class="page-head">
        <div style="flex:1">
          <div class="detail-head">
            <div>
              <div class="muted mono" style="font-size:12.5px">借展单号 ${loan.id}</div>
              <div class="title">${esc(loan.artifactName)}</div>
              <div class="sub">${esc(loan.artifactNo)}${loan.dynasty ? ' · ' + esc(loan.dynasty) : ''}　|　借入方：${esc(loan.borrowerName)}　|　发起人：${esc(loan.createdByName)}</div>
            </div>
            <div class="detail-actions" id="action-bar"></div>
          </div>
        </div>
      </div>`);
    view.appendChild(head);

    // 步骤条
    const stepper = el(`
      <div class="card">
        <div class="stepper">
          ${STEPS.map((s, i) => {
            const cls = curStepIdx > i || (s.key === 'returned' && loan.status === 'returned') ? 'done'
              : i === curStepIdx ? 'current' : '';
            return `<div class="step ${cls}"><div class="dot"></div><div class="lbl">${s.label}</div></div>`;
          }).join('')}
        </div>
      </div>`);
    view.appendChild(stepper);

    // 基本信息
    const info = el(`
      <div class="card">
        <h3>借展信息</h3>
        <div class="kv-grid">
          <div class="kv"><div class="k">保险金额</div><div class="v" style="color:var(--cinnabar)">${fmtMoney(loan.insuranceAmount)}</div></div>
          <div class="kv"><div class="k">展期</div><div class="v">${fmtDate(loan.startDate)} 至 ${fmtDate(loan.endDate)}</div></div>
          <div class="kv"><div class="k">当前状态</div><div class="v"><span class="status ${loan.status}">${STATUS_LABEL[loan.status]}</span></div></div>
          <div class="kv"><div class="k">创建时间</div><div class="v">${fmtDTFull(loan.createdAt)}</div></div>
          ${loan.notes ? `<div class="kv" style="grid-column:1/-1"><div class="k">备注</div><div class="v">${esc(loan.notes)}</div></div>` : ''}
        </div>
      </div>`);
    view.appendChild(info);

    // 环境要求
    const reqCard = el(`
      <div class="card">
        <h3>环境要求（物流回传将自动比对）</h3>
        <div class="req-strip">
          <div class="req-item"><div class="k">温度区间</div><div class="v">${r.tempMin} ~ ${r.tempMax} ℃</div></div>
          <div class="req-item"><div class="k">相对湿度</div><div class="v">${r.humMin} ~ ${r.humMax} %</div></div>
          <div class="req-item"><div class="k">照度上限</div><div class="v">${r.lightLux} lux</div></div>
        </div>
        <div style="margin-top:12px;font-size:13px"><span class="muted">防震/搬运：</span>${esc(r.vibration)}</div>
        ${r.extra ? `<div style="margin-top:6px;font-size:13px"><span class="muted">其他要求：</span>${esc(r.extra)}</div>` : ''}
      </div>`);
    view.appendChild(reqCard);

    // 物流信息
    const shipCard = el(`<div class="card"><h3>装箱与物流</h3>${logisticsHtml(loan)}</div>`);
    view.appendChild(shipCard);

    // 温湿度回传
    const tkCard = renderTrackings(loan);
    view.appendChild(tkCard);

    // 开箱记录
    view.appendChild(renderOpenings(loan));

    // 时间线
    const evCard = el(`
      <div class="card">
        <h3>全程时间线</h3>
        <ul class="timeline">
          ${loan.events.slice().reverse().map(ev => `
            <li class="tp-${ev.type}">
              <div class="t-time">${fmtDTFull(ev.at)}</div>
              <div class="t-desc">${esc(ev.desc)}</div>
              <div class="t-actor">操作人：${esc(ev.actor)}</div>
            </li>`).join('')}
        </ul>
      </div>`);
    view.appendChild(evCard);

    main.appendChild(view);
    bindActions(loan);
  }

  function logisticsHtml(loan) {
    const p = loan.packed, s = loan.shipped, a = loan.arrival, ret = loan.returnShipment;
    const block = (title, lines, photos) => `
      <div style="margin-bottom:14px">
        <div style="font-weight:600;margin-bottom:4px">${title}</div>
        ${lines.length ? `<div class="kv-grid">${lines.map(([k, v]) => `<div class="kv"><div class="k">${k}</div><div class="v">${v}</div></div>`).join('')}</div>` : '<div class="muted" style="font-size:13px">尚未记录</div>'}
        ${photos && photos.length ? `<div class="thumbs">${photos.map(src => thumbHtml(src)).join('')}</div>` : ''}
      </div>`;
    return [
      block('① 库房装箱', p ? [
        ['箱号', esc(p.caseNo)], ['铅封号', esc(p.sealNo)], ['装箱负责人', esc(p.packer)],
        ['装箱时间', fmtDTFull(p.at)], ['文物现状', esc(p.condition)]
      ] : [], p ? p.photos : null),
      block('② 发运', s ? [
        ['承运方', esc(s.carrier)], ['运单号', '<span class="mono">' + esc(s.trackingId) + '</span>'],
        ['司机/押运', esc(s.driver || '—')], ['发运时间', fmtDTFull(s.at)]
      ] : [], null),
      block('③ 到馆签收', a ? [
        ['到馆地点', esc(a.location)], ['签收人', esc(a.receiver)],
        ['签收时间', fmtDTFull(a.at)], ['运单号', '<span class="mono">' + esc(a.trackingId) + '</span>']
      ] : [], null),
      block('④ 归还', ret ? [
        ['返程运单号', '<span class="mono">' + esc(ret.trackingId) + '</span>'], ['发运时间', fmtDTFull(ret.at)]
      ] : [], null),
    ].join('');
  }

  function renderTrackings(loan) {
    const rows = loan.trackings.slice().reverse().map(t => {
      const r = loan.requirements;
      const tAlarm = !inRange(t.temperature, r.tempMin, r.tempMax);
      const hAlarm = !inRange(t.humidity, r.humMin, r.humMax);
      return `
        <tr class="track-row ${t.alarm ? 'alarm' : ''}">
          <td class="muted" style="white-space:nowrap">${fmtDTFull(t.at)}</td>
          <td>${esc(t.location)}</td>
          <td><span class="track-metrics">
            <span class="temp-val ${tAlarm ? 'alarm' : ''}">🌡 ${t.temperature}℃</span>
            <span class="hum-val ${hAlarm ? 'alarm' : ''}">💧 ${t.humidity}%</span>
            ${t.alarm ? '<span class="badge-alarm">超出环境要求</span>' : '<span class="badge-ok">正常</span>'}
          </span></td>
          <td class="muted">${esc(t.note || '—')}</td>
        </tr>`;
    }).join('');
    return el(`
      <div class="card">
        <h3>物流温湿度回传 <span class="muted" style="font-weight:400;font-size:12px">（要求 ${loan.requirements.tempMin}-${loan.requirements.tempMax}℃ / ${loan.requirements.humMin}-${loan.requirements.humMax}%）</span></h3>
        ${loan.trackings.length ? `
        <div style="overflow-x:auto">
        <table class="data-table">
          <thead><tr><th>时间</th><th>位置</th><th>温湿度</th><th>备注</th></tr></thead>
          <tbody>${rows}</tbody>
        </table></div>` : '<div class="empty" style="padding:24px">暂无回传记录，文物发运后由物流方上报</div>'}
      </div>`);
  }

  function renderOpenings(loan) {
    const card = el(`
      <div class="card">
        <h3>开箱留痕 <span class="muted" style="font-weight:400;font-size:12px">制度要求：任何一次开箱必须记录在场人员并上传照片</span></h3>
        <div id="opening-list"></div>
      </div>`);
    const list = $('#opening-list', card);
    if (!loan.openings.length) {
      list.appendChild(el('<div class="empty" style="padding:24px"><div class="big">📦</div>尚无开箱记录</div>'));
      return card;
    }
    loan.openings.slice().reverse().forEach(o => {
      list.appendChild(el(`
        <div class="opening-card">
          <div class="opening-head">
            <span class="opening-scene">${SCENE_LABEL[o.scene] || o.scene}</span>
            <span class="muted" style="font-size:12px">${fmtDTFull(o.at)} · 记录人 ${esc(userName(o.by, loan))}</span>
          </div>
          <div class="opening-people"><b>在场人员：</b>${esc(o.personnel)}</div>
          ${o.witness ? `<div class="opening-people"><b>见证人：</b>${esc(o.witness)}</div>` : ''}
          ${o.note ? `<div style="font-size:13px;margin-top:4px"><span class="muted">状况说明：</span>${esc(o.note)}</div>` : ''}
          <div class="thumbs">${o.photos.map(src => thumbHtml(src)).join('')}</div>
        </div>`));
    });
    return card;
  }

  function thumbHtml(src) {
    return `<img src="${esc(src)}" loading="lazy" alt="留痕照片" data-src="${esc(src)}">`;
  }

  // ---------------- 操作按钮与弹窗 ----------------
  function bindActions(loan) {
    const role = state.user.role;
    const bar = $('#action-bar');
    const addBtn = (txt, cls, fn) => {
      const b = el(`<button class="btn ${cls}">${txt}</button>`);
      b.addEventListener('click', fn);
      bar.appendChild(b);
    };

    const back = el('<a class="btn" href="#/loans">← 列表</a>');
    bar.appendChild(back);

    // 库房：待装箱 → 装箱；已装箱 → 发货
    if (role === 'warehouse' && loan.status === 'requested') {
      addBtn('确认装箱', 'btn-jade', () => openPackModal(loan));
    }
    if (role === 'warehouse' && loan.status === 'packed') {
      addBtn('安排发运', 'btn-primary', () => openShipModal(loan));
    }
    // 物流：在途 → 回传温湿度、到馆签收；已到馆 → 归还发运
    if (role === 'logistics' && ['shipped', 'arrived', 'returned'].includes(loan.status)) {
      addBtn('回传温湿度', 'btn-jade', () => openTrackingModal(loan));
    }
    if (role === 'logistics' && loan.status === 'shipped') {
      addBtn('到馆签收', 'btn-primary', () => openArriveModal(loan));
    }
    if ((role === 'logistics' || role === 'warehouse') && loan.status === 'arrived') {
      addBtn('撤展归还发运', 'btn', () => openReturnModal(loan));
    }
    // 开箱：库房/物流/借入展馆均可（展馆仅限本馆单据），装箱之后任何状态
    if (['warehouse', 'logistics', 'museum'].includes(role) && ['packed', 'shipped', 'arrived', 'returned'].includes(loan.status)) {
      addBtn('📷 开箱登记', 'btn-primary', () => openOpeningModal(loan));
    }
  }

  // ---- 通用弹窗 ----
  function openModal(title, bodyHtml, { wide = false, onSubmit, submitText = '提交', submitClass = 'btn-primary' } = {}) {
    const root = $('#modal-root');
    const modal = el(`
      <div class="modal-mask">
        <div class="modal ${wide ? 'wide' : ''}">
          <div class="modal-head"><h3>${title}</h3><button class="modal-close" type="button">×</button></div>
          <div class="modal-body">${bodyHtml}</div>
          <div class="modal-foot">
            <button type="button" class="btn modal-cancel">取消</button>
            <button type="button" class="btn ${submitClass} modal-submit">${submitText}</button>
          </div>
        </div>
      </div>`);
    modal.querySelector('.modal-close').addEventListener('click', closeModal);
    modal.querySelector('.modal-cancel').addEventListener('click', closeModal);
    modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });
    modal.querySelector('.modal-submit').addEventListener('click', () => onSubmit && onSubmit(modal));
    root.appendChild(modal);
    return modal;
  }
  function closeModal() { $('#modal-root').innerHTML = ''; }

  function uploaderHtml(name, label, hint) {
    return `
      <div class="uploader">
        <label class="up-label">📷 ${label}<input type="file" name="${name}" accept="image/*" multiple required></label>
        <div class="up-hint">${hint}</div>
        <div class="thumbs preview-${name}"></div>
      </div>`;
  }
  function bindPreview(modal, name) {
    const input = modal.querySelector(`input[name=${name}]`);
    const box = modal.querySelector('.preview-' + name);
    input.addEventListener('change', () => {
      box.innerHTML = '';
      Array.from(input.files || []).forEach(file => {
        const url = URL.createObjectURL(file);
        const img = el(`<img src="${url}" alt="预览">`);
        box.appendChild(img);
      });
    });
  }
  async function submitModal(modal, url, fdName, redirectId) {
    const form = modal.querySelector('form');
    const fd = new FormData(form);
    const btn = modal.querySelector('.modal-submit');
    btn.disabled = true;
    try {
      await api(url, { method: 'POST', body: fd });
      closeModal();
      toast('操作成功', 'success');
      if (redirectId) renderDetailRefresh(redirectId);
    } catch (e) {
      toast(e.message, 'error');
      btn.disabled = false;
    }
  }
  async function submitJson(modal, url, payload, redirectId) {
    const btn = modal.querySelector('.modal-submit');
    btn.disabled = true;
    try {
      await api(url, { method: 'POST', body: payload });
      closeModal();
      toast('操作成功', 'success');
      if (redirectId) renderDetailRefresh(redirectId);
    } catch (e) {
      toast(e.message, 'error');
      btn.disabled = false;
    }
  }
  function renderDetailRefresh(id) {
    // 重新渲染详情（保持 hash 不变，手动触发）
    renderDetail(id);
  }

  // ---- 装箱 ----
  function openPackModal(loan) {
    const modal = openModal('库房确认装箱 · ' + loan.id, `
      <form id="pack-form">
        <div class="form-grid">
          <div class="form-field"><label>箱号<span class="req">*</span></label><input name="caseNo" required placeholder="如 CASE-A-03"></div>
          <div class="form-field"><label>铅封号<span class="req">*</span></label><input name="sealNo" required placeholder="如 SEAL-8802"></div>
          <div class="form-field full"><label>装箱负责人<span class="req">*</span></label><input name="packer" required value="${esc(state.user.name)}"></div>
          <div class="form-field full"><label>文物现状 / 包装说明<span class="req">*</span></label><textarea name="condition" required placeholder="点交现状、囊匣与缓冲材料情况"></textarea></div>
          <div class="form-field full">${uploaderHtml('photos', '上传装箱照片（必传，可多选）', '至少 1 张：整体装箱、铅封、文物现状等')}</div>
        </div>
      </form>`, {
      submitText: '确认装箱并流转',
      wide: true,
      onSubmit: (m) => submitModal(m, '/api/loans/' + loan.id + '/pack', 'photos', loan.id)
    });
    bindPreview(modal, 'photos');
  }

  // ---- 发货 ----
  function openShipModal(loan) {
    openModal('安排文物发运 · ' + loan.id, `
      <form id="ship-form">
        <div class="form-grid">
          <div class="form-field full"><label>承运方<span class="req">*</span></label><input name="carrier" required placeholder="如 顺丰特运 · 文物专车"></div>
          <div class="form-field"><label>运单号<span class="req">*</span></label><input name="trackingId" required placeholder="如 SF-MU-20260930-0201"></div>
          <div class="form-field"><label>司机 / 押运</label><input name="driver" placeholder="姓名（可选）"></div>
        </div>
      </form>`, {
      submitText: '确认发运',
      onSubmit: (m) => submitJson(m, '/api/loans/' + loan.id + '/ship', {
        carrier: m.querySelector('[name=carrier]').value,
        trackingId: m.querySelector('[name=trackingId]').value,
        driver: m.querySelector('[name=driver]').value,
      }, loan.id)
    });
  }

  // ---- 温湿度回传 ----
  function openTrackingModal(loan) {
    const r = loan.requirements;
    const modal = openModal('物流温湿度回传 · ' + loan.id, `
      <form id="tk-form">
        <div class="form-hint" style="margin-bottom:10px">约定区间：${r.tempMin}~${r.tempMax}℃，${r.humMin}~${r.humMax}%。超出区间将自动标记告警并写入时间线。</div>
        <div class="form-grid">
          <div class="form-field full"><label>当前位置<span class="req">*</span></label><input name="location" required placeholder="如 沪蓉高速常州服务区 / 苏州收货月台"></div>
          <div class="form-field"><label>温度（℃）<span class="req">*</span></label><input name="temperature" type="number" step="0.1" required></div>
          <div class="form-field"><label>相对湿度（%）<span class="req">*</span></label><input name="humidity" type="number" step="1" required></div>
          <div class="form-field full"><label>备注</label><input name="note" placeholder="车况、异常处置等（可选）"></div>
        </div>
      </form>`, {
      submitText: '提交回传',
      submitClass: 'btn-jade',
      onSubmit: (m) => submitJson(m, '/api/loans/' + loan.id + '/trackings', {
        location: m.querySelector('[name=location]').value,
        temperature: Number(m.querySelector('[name=temperature]').value),
        humidity: Number(m.querySelector('[name=humidity]').value),
        note: m.querySelector('[name=note]').value,
      }, loan.id)
    });
  }

  // ---- 到馆签收 ----
  function openArriveModal(loan) {
    openModal('到馆签收 · ' + loan.id, `
      <form id="arrive-form">
        <div class="form-grid">
          <div class="form-field full"><label>到馆地点<span class="req">*</span></label><input name="location" required value="${esc(loan.borrowerName + ' 文物收货区')}"></div>
          <div class="form-field full"><label>签收人<span class="req">*</span></label><input name="receiver" required placeholder="借入馆签收负责人姓名"></div>
        </div>
        <div class="form-hint">签收后借入展馆可查看单据；任何开箱须另行登记并拍照留痕。</div>
      </form>`, {
      submitText: '确认签收',
      onSubmit: (m) => submitJson(m, '/api/loans/' + loan.id + '/arrive', {
        location: m.querySelector('[name=location]').value,
        receiver: m.querySelector('[name=receiver]').value,
      }, loan.id)
    });
  }

  // ---- 归还发运 ----
  function openReturnModal(loan) {
    openModal('撤展归还发运 · ' + loan.id, `
      <form id="ret-form">
        <div class="form-grid">
          <div class="form-field full"><label>返程运单号<span class="req">*</span></label><input name="trackingId" required placeholder="返程文物专车运单号"></div>
        </div>
        <div class="form-hint">归还运输途中仍可由物流方回传温湿度。</div>
      </form>`, {
      submitText: '确认归还发运',
      onSubmit: (m) => submitJson(m, '/api/loans/' + loan.id + '/return-ship', {
        trackingId: m.querySelector('[name=trackingId]').value,
      }, loan.id)
    });
  }

  // ---- 开箱登记（任何一次开箱都要留下人员和照片） ----
  function openOpeningModal(loan) {
    const sceneOpts = [
      ['arrival', '到馆开箱'], ['inspection', '展中检查开箱'], ['repack', '撤展复装'], ['return', '归还点交开箱']
    ].map(([v, t]) => `<option value="${v}">${t}</option>`).join('');
    const defaultPersonnel = state.user.role === 'museum'
      ? state.user.name + '、（请补全所有在场人员）'
      : state.user.name + '、（请补全所有在场人员）';
    const modal = openModal('开箱登记 · ' + loan.id, `
      <form id="open-form">
        <div class="form-hint" style="margin-bottom:10px;color:var(--cinnabar)">⚠ 制度留痕要求：任何一次开箱都必须如实登记全部在场人员并上传现场照片。</div>
        <div class="form-grid">
          <div class="form-field"><label>开箱场景<span class="req">*</span></label><select name="scene" required>${sceneOpts}</select></div>
          <div class="form-field"><label>见证人</label><input name="witness" placeholder="监理/第三方（可选）"></div>
          <div class="form-field full"><label>在场人员（逐一列明）<span class="req">*</span></label><input name="personnel" required value="${esc(defaultPersonnel)}"></div>
          <div class="form-field full"><label>状况说明</label><textarea name="note" placeholder="铅封是否完好、器物状况、异常情况等"></textarea></div>
          <div class="form-field full">${uploaderHtml('photos', '上传开箱现场照片（必传，可多选）', '至少 1 张：建议含铅封状态、开箱全景、器物细节')}</div>
        </div>
      </form>`, {
      submitText: '提交开箱记录',
      wide: true,
      onSubmit: (m) => submitModal(m, '/api/loans/' + loan.id + '/openings', 'photos', loan.id)
    });
    bindPreview(modal, 'photos');
  }

  // 图片事件委托：点击缩略图放大
  document.addEventListener('click', (e) => {
    if (e.target.tagName === 'IMG' && e.target.dataset.src) {
      const lb = $('#lightbox');
      lb.querySelector('img').src = e.target.dataset.src;
      lb.classList.remove('hidden');
    }
  });

  init();
})();
