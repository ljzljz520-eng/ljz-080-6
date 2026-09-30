// 博物馆文物借展物流台 — API 服务
const express = require('express');
const session = require('express-session');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('./server/db');
const seed = require('./server/seed');

seed.run();

const app = express();
const PORT = process.env.PORT || 3000;
const UPLOAD_DIR = path.join(__dirname, 'server', 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

app.use(express.json({ limit: '2mb' }));
app.use(session({
  name: 'loan_sid',
  secret: process.env.SESSION_SECRET || 'museum-loan-demo-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', maxAge: 1000 * 60 * 60 * 12 }
}));

// ---------- 文件上传（开箱/装箱照片留痕） ----------
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = (path.extname(file.originalname) || '').toLowerCase().replace(/[^.a-z0-9]/g, '');
    cb(null, crypto.randomBytes(16).toString('hex') + (ext || '.jpg'));
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024, files: 8 },
  fileFilter: (req, file, cb) => {
    if (/^image\//.test(file.mimetype)) cb(null, true);
    else cb(new Error('仅允许上传图片文件'));
  }
});

// ---------- 常量 ----------
const STATUSES = ['requested', 'packed', 'shipped', 'arrived', 'returned', 'cancelled'];
const STATUS_LABEL = {
  requested: '待装箱', packed: '已装箱', shipped: '在途',
  arrived: '已到馆', returned: '已归还', cancelled: '已取消'
};
const ROLE_LABEL = { curator: '策展人', warehouse: '库房', logistics: '物流方', museum: '外部展馆' };

// ---------- 工具 ----------
function d() { return db.load(); }

function recordEvent(loan, type, actorName, desc) {
  const at = new Date().toISOString();
  d().events.push({ id: db.nowId('ev'), loanId: loan.id, type, actor: actorName, at, desc });
  loan.updatedAt = at;
}

function serializeLoan(loan) {
  const m = d().museums.find(x => x.id === loan.borrowerId);
  const u = d().users.find(x => x.id === loan.createdBy);
  return {
    ...loan,
    borrowerName: m ? m.name : '',
    createdByName: u ? u.name : ''
  };
}

function requireAuth(req, res, next) {
  const uid = req.session.userId;
  const user = uid && d().users.find(x => x.id === uid);
  if (!user) return res.status(401).json({ error: '未登录或会话已过期' });
  req.user = user;
  next();
}
function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: '当前角色无权执行此操作' });
    next();
  };
}
function findLoan(req, res) {
  const loan = d().loans.find(l => l.id === req.params.id);
  if (!loan) { res.status(404).json({ error: '借展单不存在' }); return null; }
  return loan;
}
// 外部展馆只能访问自己借到的文物
function assertCanView(req, res, loan) {
  if (req.user.role === 'museum' && loan.borrowerId !== req.user.museumId) {
    res.status(404).json({ error: '借展单不存在' }); // 不暴露他人单据的存在
    return false;
  }
  return true;
}
function assertCanOperate(req, res, loan) {
  if (!assertCanView(req, res, loan)) return false;
  if (req.user.role === 'museum' && loan.borrowerId !== req.user.museumId) {
    res.status(403).json({ error: '只能操作本馆借到的文物' }); return false;
  }
  return true;
}
function assertStatus(req, res, loan, ...allowed) {
  if (!allowed.includes(loan.status)) {
    res.status(409).json({ error: `当前状态「${STATUS_LABEL[loan.status]}」不允许此操作` });
    return false;
  }
  return true;
}
function badRequest(res, msg) { return res.status(400).json({ error: msg }); }
function num(v, field, min, max, required = true) {
  if (v === '' || v === null || v === undefined) {
    if (required) return { err: `缺少参数：${field}` };
    return { val: undefined };
  }
  const n = Number(v);
  if (!Number.isFinite(n)) return { err: `${field} 必须是数字` };
  if (n < min || n > max) return { err: `${field} 必须在 ${min} ~ ${max} 之间` };
  return { val: n };
}
function str(v, field, max = 500, required = true) {
  if (v === undefined || v === null || String(v).trim() === '') {
    if (required) return { err: `缺少参数：${field}` };
    return { val: '' };
  }
  const s = String(v).trim();
  if (s.length > max) return { err: `${field} 长度不能超过 ${max} 字` };
  return { val: s };
}

// ---------- 认证 ----------
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body || {};
  const user = d().users.find(u => u.username === String(username || '').trim());
  if (!user || user.password !== String(password || '')) {
    return res.status(401).json({ error: '用户名或密码错误' });
  }
  req.session.userId = user.id;
  const museum = user.museumId ? d().museums.find(m => m.id === user.museumId) : null;
  res.json({ id: user.id, username: user.username, name: user.name, role: user.role, roleLabel: ROLE_LABEL[user.role], museumId: user.museumId, museumName: museum ? museum.name : null });
});
app.post('/api/auth/logout', (req, res) => req.session.destroy(() => res.json({ ok: true })));
app.get('/api/auth/me', requireAuth, (req, res) => {
  const u = req.user;
  const museum = u.museumId ? d().museums.find(m => m.id === u.museumId) : null;
  res.json({ id: u.id, username: u.username, name: u.name, role: u.role, roleLabel: ROLE_LABEL[u.role], museumId: u.museumId, museumName: museum ? museum.name : null });
});

// ---------- 基础数据 ----------
app.get('/api/museums', requireAuth, (req, res) => {
  const list = d().museums.map(m => ({ id: m.id, name: m.name, contact: m.contact, phone: m.phone, address: m.address }));
  res.json(list);
});

// ---------- 借展单列表 ----------
app.get('/api/loans', requireAuth, (req, res) => {
  let loans = d().loans.slice();
  if (req.user.role === 'museum') loans = loans.filter(l => l.borrowerId === req.user.museumId);
  loans.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  res.json(loans.map(serializeLoan));
});

// ---------- 借展单详情（含时间线） ----------
app.get('/api/loans/:id', requireAuth, (req, res) => {
  const loan = findLoan(req, res); if (!loan) return;
  if (!assertCanView(req, res, loan)) return;
  const events = d().events
    .filter(e => e.loanId === loan.id)
    .sort((a, b) => a.at.localeCompare(b.at));
  res.json({ ...serializeLoan(loan), events });
});

// ---------- 策展人发起借展 ----------
app.post('/api/loans', requireAuth, requireRole('curator'), (req, res) => {
  const b = req.body || {};
  const checks = {
    artifactNo: str(b.artifactNo, '文物编号', 40),
    artifactName: str(b.artifactName, '文物名称', 80),
    dynasty: str(b.dynasty, '年代', 40, false),
    borrowerId: str(b.borrowerId, '借入展馆'),
    startDate: str(b.startDate, '展期开始日'),
    endDate: str(b.endDate, '展期结束日'),
    vibration: str(b.requirements && b.requirements.vibration, '防震/搬运要求', 300),
  };
  for (const k of Object.keys(checks)) if (checks[k].err) return badRequest(res, checks[k].err);

  const museum = d().museums.find(m => m.id === checks.borrowerId.val);
  if (!museum) return badRequest(res, '借入展馆不存在');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(checks.startDate.val) || !/^\d{4}-\d{2}-\d{2}$/.test(checks.endDate.val))
    return badRequest(res, '展期日期格式应为 YYYY-MM-DD');
  if (checks.startDate.val >= checks.endDate.val) return badRequest(res, '展期结束日必须晚于开始日');

  const insurance = num(b.insuranceAmount, '保险金额', 0, 1e12);
  if (insurance.err) return badRequest(res, insurance.err);
  const r = b.requirements || {};
  const tMin = num(r.tempMin, '温度下限', -20, 40), tMax = num(r.tempMax, '温度上限', -20, 40);
  const hMin = num(r.humMin, '湿度下限', 0, 100), hMax = num(r.humMax, '湿度上限', 0, 100);
  const lux = num(r.lightLux, '照度上限', 0, 100000);
  for (const c of [tMin, tMax, hMin, hMax, lux]) if (c.err) return badRequest(res, c.err);
  if (tMin.val >= tMax.val) return badRequest(res, '温度下限必须小于上限');
  if (hMin.val >= hMax.val) return badRequest(res, '湿度下限必须小于上限');
  const extra = str(r.extra || '', '其他环境要求', 500, false);
  if (extra.err) return badRequest(res, extra.err);

  const notes = str(b.notes || '', '备注', 500, false);
  if (notes.err) return badRequest(res, notes.err);

  const id = db.nextLoanId();
  const at = new Date().toISOString();
  const loan = {
    id,
    artifactNo: checks.artifactNo.val,
    artifactName: checks.artifactName.val,
    dynasty: checks.dynasty.val,
    insuranceAmount: insurance.val,
    requirements: {
      tempMin: tMin.val, tempMax: tMax.val,
      humMin: hMin.val, humMax: hMax.val,
      lightLux: lux.val,
      vibration: checks.vibration.val,
      extra: extra.val
    },
    startDate: checks.startDate.val,
    endDate: checks.endDate.val,
    borrowerId: museum.id,
    status: 'requested',
    notes: notes.val,
    createdBy: req.user.id,
    createdAt: at, updatedAt: at,
    packed: null, shipped: null, arrival: null, returnShipment: null,
    trackings: [], openings: []
  };
  d().loans.push(loan);
  recordEvent(loan, 'created', req.user.name, `策展人发起借展：${loan.artifactNo} 借往「${museum.name}」，展期 ${loan.startDate} 至 ${loan.endDate}`);
  db.persistNow();
  res.status(201).json(serializeLoan(loan));
});

// ---------- 库房确认装箱 ----------
app.post('/api/loans/:id/pack', requireAuth, requireRole('warehouse'), upload.array('photos', 8), (req, res) => {
  const loan = findLoan(req, res); if (!loan) return;
  if (!assertStatus(req, res, loan, 'requested')) return;
  const b = req.body || {};
  const caseNo = str(b.caseNo, '箱号', 40), sealNo = str(b.sealNo, '铅封号', 40),
        packer = str(b.packer, '装箱负责人', 40), condition = str(b.condition, '文物现状', 500);
  for (const c of [caseNo, sealNo, packer, condition]) if (c.err) return badRequest(res, c.err);
  if (!req.files || !req.files.length) return badRequest(res, '装箱必须上传至少一张照片留痕');

  loan.packed = {
    at: new Date().toISOString(), by: req.user.id,
    packer: packer.val, caseNo: caseNo.val, sealNo: sealNo.val, condition: condition.val,
    photos: req.files.map(f => '/uploads/' + f.filename)
  };
  loan.status = 'packed';
  recordEvent(loan, 'packed', req.user.name, `库房确认装箱：箱号 ${caseNo.val}，铅封 ${sealNo.val}，留痕 ${req.files.length} 张照片`);
  db.persistNow();
  res.json(serializeLoan(loan));
});

// ---------- 库房发货 ----------
app.post('/api/loans/:id/ship', requireAuth, requireRole('warehouse'), (req, res) => {
  const loan = findLoan(req, res); if (!loan) return;
  if (!assertStatus(req, res, loan, 'packed')) return;
  const b = req.body || {};
  const carrier = str(b.carrier, '承运方', 80), trackingId = str(b.trackingId, '运单号', 60),
        driver = str(b.driver, '司机/押运', 40, false);
  for (const c of [carrier, trackingId, driver]) if (c.err) return badRequest(res, c.err);

  loan.shipped = { at: new Date().toISOString(), by: req.user.id, carrier: carrier.val, trackingId: trackingId.val, driver: driver.val };
  loan.status = 'shipped';
  recordEvent(loan, 'shipped', req.user.name, `文物发运：${carrier.val}，运单号 ${trackingId.val}`);
  db.persistNow();
  res.json(serializeLoan(loan));
});

// ---------- 物流回传温湿度/位置 ----------
app.post('/api/loans/:id/trackings', requireAuth, requireRole('logistics'), (req, res) => {
  const loan = findLoan(req, res); if (!loan) return;
  if (!assertStatus(req, res, loan, 'shipped', 'arrived', 'returned')) return;
  const b = req.body || {};
  const location = str(b.location, '当前位置', 120), note = str(b.note || '', '备注', 300, false);
  if (location.err) return badRequest(res, location.err);
  if (note.err) return badRequest(res, note.err);
  const t = num(b.temperature, '温度', -20, 60), h = num(b.humidity, '湿度', 0, 100);
  if (t.err) return badRequest(res, t.err);
  if (h.err) return badRequest(res, h.err);

  const r = loan.requirements;
  const alarm = t.val < r.tempMin || t.val > r.tempMax || h.val < r.humMin || h.val > r.humMax;
  const rec = {
    id: db.nowId('tk'), at: new Date().toISOString(), location: location.val,
    temperature: t.val, humidity: h.val, note: note.val, by: req.user.id, alarm
  };
  loan.trackings.push(rec);
  if (alarm) {
    recordEvent(loan, 'tracking_alarm', req.user.name,
      `温湿度告警 · ${location.val}：${t.val}℃ / ${h.val}%，超出约定区间 ${r.tempMin}-${r.tempMax}℃、${r.humMin}-${r.humMax}%`);
  } else {
    recordEvent(loan, 'tracking', req.user.name, `温湿度回传 · ${location.val}：${t.val}℃ / ${h.val}%`);
  }
  db.persistNow();
  res.status(201).json(rec);
});

// ---------- 到馆签收 ----------
app.post('/api/loans/:id/arrive', requireAuth, requireRole('logistics'), (req, res) => {
  const loan = findLoan(req, res); if (!loan) return;
  if (!assertStatus(req, res, loan, 'shipped')) return;
  const b = req.body || {};
  const location = str(b.location, '到馆地点', 120), receiver = str(b.receiver, '签收人', 40);
  if (location.err) return badRequest(res, location.err);
  if (receiver.err) return badRequest(res, receiver.err);

  loan.arrival = {
    at: new Date().toISOString(), by: req.user.id,
    location: location.val, receiver: receiver.val,
    trackingId: loan.shipped ? loan.shipped.trackingId : ''
  };
  loan.status = 'arrived';
  recordEvent(loan, 'arrived', req.user.name, `到馆签收：${location.val}，签收人 ${receiver.val}`);
  db.persistNow();
  res.json(serializeLoan(loan));
});

// ---------- 开箱记录（任何一次开箱都必须留下人员与照片） ----------
app.post('/api/loans/:id/openings', requireAuth, upload.array('photos', 8), (req, res) => {
  const loan = findLoan(req, res); if (!loan) return;
  if (!assertCanOperate(req, res, loan)) return;
  if (!assertStatus(req, res, loan, 'packed', 'shipped', 'arrived', 'returned')) return;
  const b = req.body || {};
  const scene = str(b.scene, '开箱场景', 20);
  const personnel = str(b.personnel, '在场人员', 300);
  const witness = str(b.witness || '', '见证人', 80, false);
  const note = str(b.note || '', '状况说明', 500, false);
  const allowedScenes = ['arrival', 'inspection', 'repack', 'return'];
  if (!allowedScenes.includes(scene.val)) return badRequest(res, '开箱场景不合法');
  for (const c of [personnel, witness, note]) if (c.err) return badRequest(res, c.err);
  if (!req.files || !req.files.length) return badRequest(res, '任何一次开箱都必须上传照片留痕');

  const rec = {
    id: db.nowId('op'),
    at: new Date().toISOString(),
    scene: scene.val,
    personnel: personnel.val,
    witness: witness.val,
    note: note.val,
    photos: req.files.map(f => '/uploads/' + f.filename),
    by: req.user.id,
    byRole: req.user.role
  };
  loan.openings.push(rec);
  const sceneLabel = { arrival: '到馆开箱', inspection: '展中检查开箱', repack: '撤展复装', return: '归还点交开箱' }[scene.val];
  recordEvent(loan, 'opened', req.user.name, `${sceneLabel}：在场人员 ${personnel.val}，留痕 ${req.files.length} 张照片`);
  db.persistNow();
  res.status(201).json(rec);
});

// ---------- 归还：物流从展馆提货发运 ----------
app.post('/api/loans/:id/return-ship', requireAuth, requireRole('logistics', 'warehouse'), (req, res) => {
  const loan = findLoan(req, res); if (!loan) return;
  if (!assertStatus(req, res, loan, 'arrived')) return;
  const b = req.body || {};
  const trackingId = str(b.trackingId, '返程运单号', 60);
  if (trackingId.err) return badRequest(res, trackingId.err);
  loan.returnShipment = { at: new Date().toISOString(), by: req.user.id, trackingId: trackingId.val };
  loan.status = 'returned';
  recordEvent(loan, 'returned', req.user.name, `撤展归还发运，返程运单号 ${trackingId.val}（等待本馆库房点收入库）`);
  db.persistNow();
  res.json(serializeLoan(loan));
});

// ---------- 错误处理 ----------
app.use('/api', (err, req, res, next) => {
  if (err instanceof multer.MulterError) return res.status(400).json({ error: '上传失败：' + err.message });
  if (err) return res.status(400).json({ error: err.message || '请求错误' });
  next();
});

app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '7d' }));
app.use((req, res, next) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/uploads')) return next();
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => console.log(`博物馆文物借展物流台已启动: http://localhost:${PORT}`));
