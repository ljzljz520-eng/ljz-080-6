const path = require('path');
const fs = require('fs');
const express = require('express');
const session = require('express-session');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const db = require('./lib/db');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: 'museum-loan-logistics-secret-2026',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', maxAge: 1000 * 60 * 60 * 8 },
}));

/* ---------------- 照片上传（multer） ---------------- */

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml']);
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, db.UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase().replace(/[^.a-z0-9]/g, '');
    cb(null, 'photo_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10) + ext);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024, files: 9 },
  fileFilter: (req, file, cb) => {
    if (ALLOWED_MIME.has(file.mimetype)) cb(null, true);
    else cb(new Error('仅支持 JPG / PNG / WEBP / GIF / SVG 图片'));
  },
});

/* ---------------- 鉴权与 RBAC ---------------- */

const ROLE_NAMES = {
  curator: '策展人', warehouse: '库房', logistics: '物流方', museum: '外部展馆', admin: '管理员',
};

function requireAuth(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: '未登录或会话已过期' });
  next();
}
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.session.user) return res.status(401).json({ error: '未登录或会话已过期' });
    if (!roles.includes(req.session.user.role)) return res.status(403).json({ error: '无权限执行此操作' });
    next();
  };
}
// 外部展馆仅可访问本馆借展单
function loadLoanScoped(req, res, next) {
  const loan = db.getLoan(req.params.id);
  if (!loan) return res.status(404).json({ error: '借展单不存在' });
  if (req.session.user.role === 'museum' && loan.museumId !== req.session.user.id) {
    return res.status(403).json({ error: '只能查看本馆的借展文物' });
  }
  req.loan = loan;
  next();
}

function serializeLoan(loan, viewer) {
  const isMuseum = viewer && viewer.role === 'museum';
  const out = { ...loan };
  if (isMuseum) delete out.insuredValue; // 外部展馆不展示保险金额
  out.timeline = db.timelineOf(loan.id);
  out.envLogs = db.envLogsOf(loan.id);
  out.openEvents = db.openEventsOf(loan.id).map((o) => ({
    ...o,
    photos: o.photos.map((p) => ({ id: p.id, originalName: p.originalName })),
  }));
  return out;
}

/* ---------------- 认证接口 ---------------- */

app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: '请输入账号和密码' });
  const user = db.getUserByName(String(username).trim());
  if (!user || !bcrypt.compareSync(String(password), user.password)) {
    return res.status(401).json({ error: '账号或密码错误' });
  }
  req.session.user = { id: user.id, username: user.username, name: user.name, role: user.role, org: user.org };
  res.json({ user: req.session.user, roleName: ROLE_NAMES[user.role] });
});

app.post('/api/logout', (req, res) => req.session.destroy(() => res.json({ ok: true })));

app.get('/api/me', requireAuth, (req, res) => {
  res.json({ user: req.session.user, roleName: ROLE_NAMES[req.session.user.role] });
});

app.get('/api/museums', requireRole('curator', 'admin'), (req, res) => {
  const museums = db.allUsers()
    .filter((u) => u.role === 'museum')
    .map((u) => ({ id: u.id, org: u.org, name: u.name }));
  res.json({ museums });
});

/* ---------------- 借展单：发起 / 列表 / 详情 ---------------- */

app.get('/api/loans', requireAuth, (req, res) => {
  const u = req.session.user;
  const loans = db.listLoans(u.role === 'museum' ? { museumId: u.id } : {})
    .map((l) => {
      const row = { ...l };
      if (u.role === 'museum') delete row.insuredValue;
      row.openEventCount = db.openEventsOf(l.id).length;
      row.envLogCount = db.envLogsOf(l.id).length;
      return row;
    });
  res.json({ loans });
});

app.get('/api/loans/:id', requireAuth, loadLoanScoped, (req, res) => {
  res.json({ loan: serializeLoan(req.loan, req.session.user) });
});

app.post('/api/loans', requireRole('curator', 'admin'), (req, res) => {
  const b = req.body || {};
  const required = ['artifactCode', 'insuredValue', 'envRequirement', 'startDate', 'endDate', 'museumId'];
  const labels = {
    artifactCode: '文物编号', insuredValue: '保险金额', envRequirement: '环境要求',
    startDate: '展期开始日', endDate: '展期结束日', museumId: '借入展馆',
  };
  for (const k of required) {
    if (b[k] === undefined || b[k] === null || String(b[k]).trim() === '') {
      return res.status(400).json({ error: `请填写${labels[k]}` });
    }
  }
  const insuredValue = Math.round(Number(b.insuredValue));
  if (!Number.isFinite(insuredValue) || insuredValue <= 0) {
    return res.status(400).json({ error: '保险金额必须为大于 0 的数字（元）' });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(b.startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(b.endDate)) {
    return res.status(400).json({ error: '展期日期格式不正确' });
  }
  if (b.endDate < b.startDate) return res.status(400).json({ error: '展期结束日不能早于开始日' });

  const museum = db.getUserById(b.museumId);
  if (!museum || museum.role !== 'museum') return res.status(400).json({ error: '借入展馆无效' });

  const u = req.session.user;
  const loan = {
    id: 'l_' + Math.random().toString(36).slice(2, 12) + Date.now().toString(36),
    loanNo: db.nextLoanNo(),
    artifactCode: String(b.artifactCode).trim(),
    artifactName: String(b.artifactName || '').trim(),
    insuredValue,
    envRequirement: String(b.envRequirement).trim(),
    museumId: museum.id,
    museumName: museum.org,
    startDate: b.startDate,
    endDate: b.endDate,
    status: 'pending_packing',
    remark: String(b.remark || '').trim(),
    createdAt: new Date().toISOString(),
    createdBy: u.id,
    packedAt: null, packedBy: null,
    shipper: null, shippedAt: null, shippedBy: null,
    arrivedAt: null, arrivedBy: null, signedBy: null,
  };
  db.insertLoan(loan);
  db.addTimeline({
    loanId: loan.id, type: 'created', title: '策展人发起借展',
    detail: `文物 ${loan.artifactCode}${loan.artifactName ? '（' + loan.artifactName + '）' : ''} · 借入方 ${museum.org} · 展期 ${loan.startDate} 至 ${loan.endDate}`,
    operatorId: u.id, operatorName: u.name,
  });
  res.status(201).json({ loan: serializeLoan(db.getLoan(loan.id), u) });
});

/* ---------------- 库房：确认装箱（可同时留存点交开箱记录） ---------------- */

app.post('/api/loans/:id/pack', requireRole('warehouse', 'admin'), upload.array('photos', 9), (req, res) => {
  const loan = db.getLoan(req.params.id);
  if (!loan) return res.status(404).json({ error: '借展单不存在' });
  if (loan.status !== 'pending_packing') return res.status(400).json({ error: '当前状态不可装箱（仅待装箱可操作）' });

  const u = req.session.user;
  const b = req.body || {};
  let openEvent = null;
  const photos = (req.files || []).map((f) => ({
    id: 'ph_' + Math.random().toString(36).slice(2, 12),
    filename: f.filename, originalName: f.originalname, mime: f.mimetype, size: f.size,
    uploadedAt: new Date().toISOString(),
  }));

  // 装箱前若有开箱点交，必须留人员 + 照片
  if ((b.persons && String(b.persons).trim()) || photos.length) {
    if (!b.persons || !String(b.persons).trim() || photos.length === 0) {
      cleanup(photos);
      return res.status(400).json({ error: '任何一次开箱都必须记录在场人员并至少上传 1 张照片' });
    }
    openEvent = db.addOpenEvent({
      loanId: loan.id,
      stage: String(b.stage || '库房点交（装箱前开箱）'),
      persons: String(b.persons).trim(),
      witness: String(b.witness || '').trim(),
      note: String(b.note || '').trim(),
      photos, operatorId: u.id, operatorName: u.name,
    });
  }

  db.updateLoan(loan.id, { status: 'packed', packedAt: new Date().toISOString(), packedBy: u.id });
  db.addTimeline({
    loanId: loan.id, type: 'packed', title: '库房确认装箱',
    detail: openEvent
      ? `已完成点交装箱；开箱点交人员：${openEvent.persons}，照片 ${photos.length} 张已留存`
      : '库房确认完成包装封箱（未开箱）',
    operatorId: u.id, operatorName: u.name,
    meta: openEvent ? { openEventId: openEvent.id, photos: photos.map((p) => p.id) } : undefined,
  });
  res.json({ loan: serializeLoan(db.getLoan(loan.id), u), openEvent });
});

/* ---------------- 物流：发运 / 到馆签收 / 温湿度回传 ---------------- */

app.post('/api/loans/:id/ship', requireRole('logistics', 'admin'), (req, res) => {
  const loan = db.getLoan(req.params.id);
  if (!loan) return res.status(404).json({ error: '借展单不存在' });
  if (loan.status !== 'packed') return res.status(400).json({ error: '当前状态不可发运（仅已装箱可操作）' });
  const shipper = String((req.body && req.body.shipper) || '').trim();
  if (!shipper) return res.status(400).json({ error: '请填写承运方名称' });
  const u = req.session.user;
  db.updateLoan(loan.id, { status: 'in_transit', shipper, shippedAt: new Date().toISOString(), shippedBy: u.id });
  db.addTimeline({
    loanId: loan.id, type: 'shipped', title: '物流发运',
    detail: `承运方：${shipper}，文物启运`,
    operatorId: u.id, operatorName: u.name,
  });
  res.json({ loan: serializeLoan(db.getLoan(loan.id), u) });
});

app.post('/api/loans/:id/arrive', requireRole('logistics', 'admin'), (req, res) => {
  const loan = db.getLoan(req.params.id);
  if (!loan) return res.status(404).json({ error: '借展单不存在' });
  if (loan.status !== 'in_transit') return res.status(400).json({ error: '当前状态不可签收（仅运输中可操作）' });
  const signedBy = String((req.body && req.body.signedBy) || '').trim();
  if (!signedBy) return res.status(400).json({ error: '请填写到馆签收人' });
  const u = req.session.user;
  db.updateLoan(loan.id, { status: 'arrived', arrivedAt: new Date().toISOString(), arrivedBy: u.id, signedBy });
  db.addTimeline({
    loanId: loan.id, type: 'arrived', title: '到馆签收',
    detail: `文物运抵 ${loan.museumName}，签收人：${signedBy}`,
    operatorId: u.id, operatorName: u.name,
    meta: { signedBy },
  });
  res.json({ loan: serializeLoan(db.getLoan(loan.id), u) });
});

app.post('/api/loans/:id/env-logs', requireRole('logistics', 'admin'), upload.none(), (req, res) => {
  const loan = db.getLoan(req.params.id);
  if (!loan) return res.status(404).json({ error: '借展单不存在' });
  if (!['packed', 'in_transit', 'arrived'].includes(loan.status)) {
    return res.status(400).json({ error: '装箱后方可回传温湿度' });
  }
  const temp = Number(req.body.temp);
  const humidity = Number(req.body.humidity);
  if (!Number.isFinite(temp) || temp < -50 || temp > 80) return res.status(400).json({ error: '温度数值不合法（-50 ~ 80℃）' });
  if (!Number.isFinite(humidity) || humidity < 0 || humidity > 100) return res.status(400).json({ error: '湿度数值不合法（0 ~ 100%RH）' });
  const u = req.session.user;
  const rec = db.addEnvLog({
    loanId: loan.id, temp, humidity,
    location: String(req.body.location || '').trim(),
    note: String(req.body.note || '').trim(),
    operatorId: u.id, operatorName: u.name,
  });
  db.addTimeline({
    loanId: loan.id, type: 'env', title: '温湿度回传',
    detail: `${temp.toFixed(1)}℃ / ${humidity.toFixed(1)}%RH${rec.location ? ' · ' + rec.location : ''}`,
    operatorId: u.id, operatorName: u.name,
    meta: { envLogId: rec.id, temp, humidity },
  });
  res.status(201).json({ envLog: rec });
});

/* ---------------- 开箱留证：任何一次开箱，人员 + 照片缺一不可 ---------------- */

app.post('/api/loans/:id/open-events', requireAuth, loadLoanScoped,
  upload.array('photos', 9), (req, res) => {
    const loan = req.loan;
    const b = req.body || {};
    const persons = String(b.persons || '').trim();
    if (!persons) return res.status(400).json({ error: '任何一次开箱都必须记录在场人员' });
    if (!req.files || req.files.length === 0) return res.status(400).json({ error: '任何一次开箱都必须至少上传 1 张照片' });
    if (loan.status === 'pending_packing' && req.session.user.role !== 'warehouse' && req.session.user.role !== 'admin') {
      return res.status(400).json({ error: '文物尚未装箱，不能开箱' });
    }

    const photos = req.files.map((f) => ({
      id: 'ph_' + Math.random().toString(36).slice(2, 12),
      filename: f.filename, originalName: f.originalname, mime: f.mimetype, size: f.size,
      uploadedAt: new Date().toISOString(),
    }));
    const u = req.session.user;
    const rec = db.addOpenEvent({
      loanId: loan.id,
      stage: String(b.stage || '到馆开箱').trim(),
      persons,
      witness: String(b.witness || '').trim(),
      note: String(b.note || '').trim(),
      photos, operatorId: u.id, operatorName: u.name,
    });
    db.addTimeline({
      loanId: loan.id, type: 'open', title: '开箱记录',
      detail: `${rec.stage}｜在场：${persons}｜照片 ${photos.length} 张`,
      operatorId: u.id, operatorName: u.name,
      meta: { openEventId: rec.id, photos: photos.map((p) => p.id) },
    });
    res.status(201).json({
      openEvent: { ...rec, photos: rec.photos.map((p) => ({ id: p.id, originalName: p.originalName })) },
    });
  });

/* ---------------- 照片访问：鉴权 + 馆际隔离 ---------------- */

app.get('/api/photos/:photoId', requireAuth, (req, res) => {
  const found = db.getPhoto(req.params.photoId);
  if (!found) return res.status(404).json({ error: '照片不存在' });
  const loan = db.getLoan(found.openEvent.loanId);
  const u = req.session.user;
  if (u.role === 'museum' && loan.museumId !== u.id) {
    return res.status(403).json({ error: '无权访问该照片' });
  }
  const file = path.join(db.UPLOAD_DIR, path.basename(found.photo.filename));
  if (!fs.existsSync(file)) return res.status(404).json({ error: '照片文件丢失' });
  res.setHeader('Cache-Control', 'private, max-age=300');
  res.sendFile(file);
});

function cleanup(photos) {
  for (const p of photos) {
    try { fs.unlinkSync(path.join(db.UPLOAD_DIR, p.filename)); } catch { /* ignore */ }
  }
}

/* ---------------- 静态前端 ---------------- */

app.use(express.static(path.join(__dirname, 'public')));

/* ---------------- 错误处理（含 multer 上传错误） ---------------- */

app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? '单张照片不能超过 10MB' : '文件上传失败：' + err.message });
  }
  if (err) return res.status(400).json({ error: err.message || '请求处理失败' });
  next();
});

app.listen(PORT, () => {
  console.log(`博物馆文物借展物流台已启动: http://localhost:${PORT}`);
});
