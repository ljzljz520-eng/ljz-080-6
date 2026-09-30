const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

/* ---------------- 极简 JSON 数据库 ---------------- */

let db = null;
const seqMap = {
  loanSeq: (n) => `JZ-${new Date().getFullYear()}-${String(n).padStart(4, '0')}`,
};

function save() {
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB_FILE);
}

function load() {
  if (fs.existsSync(DB_FILE)) {
    db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } else {
    db = seed();
    save();
  }
  return db;
}

function now() { return new Date().toISOString(); }
function daysFromNow(d) {
  const t = new Date();
  t.setDate(t.getDate() + d);
  return t.toISOString();
}
function daysAgo(d) { return daysFromNow(-d); }

function uid(prefix) {
  return prefix + '_' + crypto.randomBytes(8).toString('hex');
}

/* ---------------- 演示占位照片（SVG） ---------------- */

function svgPlaceholder(name, color) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480" viewBox="0 0 640 480">
<rect width="640" height="480" fill="${color}"/>
<rect x="24" y="24" width="592" height="432" fill="none" stroke="#ffffff" stroke-width="3" stroke-dasharray="10 8"/>
<g fill="#ffffff">
  <rect x="232" y="150" width="176" height="140" rx="8" opacity="0.9"/>
  <rect x="252" y="170" width="136" height="100" rx="4" fill="${color}"/>
  <circle cx="320" cy="206" r="20" fill="#ffffff" opacity="0.85"/>
  <path d="M262 262 L300 224 L330 250 L356 230 L378 262 Z" fill="${color}" opacity="0.7"/>
</g>
<text x="320" y="360" font-family="sans-serif" font-size="26" fill="#ffffff" text-anchor="middle" font-weight="bold">${name}</text>
<text x="320" y="396" font-family="sans-serif" font-size="16" fill="#e8ecf3" text-anchor="middle">演示照片占位 · 请实际上传</text>
</svg>`;
  const filename = uid('photo') + '.svg';
  fs.writeFileSync(path.join(UPLOAD_DIR, filename), svg);
  return {
    id: uid('ph'),
    filename,
    originalName: name + '.svg',
    mime: 'image/svg+xml',
    size: Buffer.byteLength(svg),
    uploadedAt: now(),
  };
}

/* ---------------- 初始数据 ---------------- */

function seed() {
  const hash = bcrypt.hashSync('123456', 10);
  const mkUser = (username, name, role, org) => ({
    id: uid('u'), username, password: hash, name, role, org: org || null,
  });

  const users = [
    mkUser('curator', '陈策展', 'curator'),
    mkUser('warehouse', '王库房', 'warehouse'),
    mkUser('logistics', '李运输', 'logistics'),
    mkUser('museum', '周联络', 'museum', '苏州河美术馆'),
    mkUser('museum2', '赵联络', 'museum', '临安城市展览馆'),
    mkUser('admin', '系统管理员', 'admin'),
  ];
  const by = (u) => u.id;
  const curator = users[0], warehouse = users[1], logistics = users[2], museum = users[3];

  const l1Photos = svgPlaceholder('装箱点交现场', '#3f628f');
  const l1Open = svgPlaceholder('到馆开箱核验', '#2f7d62');
  const l2Photos = svgPlaceholder('出库包装过程', '#5a5470');

  const loans = [
    {
      id: uid('l'),
      loanNo: 'JZ-' + new Date().getFullYear() + '-0001',
      artifactCode: 'TANG-CAI-0173',
      artifactName: '唐三彩骆驼载乐俑',
      insuredValue: 8000000,
      envRequirement: '温度 18–22℃；相对湿度 50–55%RH；避免直射光，照度≤150lx；防震等级 A',
      museumId: museum.id,
      museumName: museum.org,
      startDate: daysAgo(3).slice(0, 10),
      endDate: daysFromNow(60).slice(0, 10),
      status: 'arrived',
      remark: '赴苏州河美术馆「丝路遗珍」专题展',
      createdAt: daysAgo(10),
      createdBy: curator.id,
      packedAt: daysAgo(2), packedBy: warehouse.id,
      shipper: '华协文物运输（上海）有限公司',
      shippedAt: daysAgo(1), shippedBy: logistics.id,
      arrivedAt: daysAgo(0), arrivedBy: logistics.id, signedBy: '周联络',
    },
    {
      id: uid('l'),
      loanNo: 'JZ-' + new Date().getFullYear() + '-0002',
      artifactCode: 'MING-HUA-0042',
      artifactName: '明·沈周《云山图》立轴',
      insuredValue: 12000000,
      envRequirement: '温度 19–21℃；相对湿度 50–55%RH；照度≤50lx，紫外为零；无酸材料包装',
      museumId: users[4].id,
      museumName: users[4].org,
      startDate: daysFromNow(7).slice(0, 10),
      endDate: daysFromNow(47).slice(0, 10),
      status: 'packed',
      remark: '书画类，采用无酸囊匣，运输全程减振',
      createdAt: daysAgo(5),
      createdBy: curator.id,
      packedAt: daysAgo(1), packedBy: warehouse.id,
      shipper: null, shippedAt: null, shippedBy: null,
      arrivedAt: null, arrivedBy: null, signedBy: null,
    },
    {
      id: uid('l'),
      loanNo: 'JZ-' + new Date().getFullYear() + '-0003',
      artifactCode: 'QING-CI-2051',
      artifactName: '清乾隆 粉彩缠枝莲纹瓶',
      insuredValue: 3500000,
      envRequirement: '温度 20℃ 左右；相对湿度 45–55%RH；避免剧烈震动与温湿度波动',
      museumId: museum.id,
      museumName: museum.org,
      startDate: daysFromNow(20).slice(0, 10),
      endDate: daysFromNow(80).slice(0, 10),
      status: 'pending_packing',
      remark: '等待库房安排装箱',
      createdAt: daysAgo(1),
      createdBy: curator.id,
      packedAt: null, packedBy: null,
      shipper: null, shippedAt: null, shippedBy: null,
      arrivedAt: null, arrivedBy: null, signedBy: null,
    },
  ];

  const timeline = [
    { id: uid('t'), loanId: loans[0].id, type: 'created', title: '策展人发起借展',
      detail: '录入文物信息、保险金额、环境要求与展期', operatorId: curator.id, operatorName: curator.name, at: daysAgo(10) },
    { id: uid('t'), loanId: loans[0].id, type: 'packed', title: '库房确认装箱',
      detail: '完成点交与包装，照片 1 张已留存', operatorId: warehouse.id, operatorName: warehouse.name, at: daysAgo(2),
      meta: { openEventId: null, photos: [l1Photos.id] } },
    { id: uid('t'), loanId: loans[0].id, type: 'shipped', title: '物流发运',
      detail: '承运方：华协文物运输（上海）有限公司', operatorId: logistics.id, operatorName: logistics.name, at: daysAgo(1) },
    { id: uid('t'), loanId: loans[0].id, type: 'arrived', title: '到馆签收',
      detail: '签收人：周联络（苏州河美术馆）', operatorId: logistics.id, operatorName: logistics.name, at: daysAgo(0),
      meta: { signedBy: '周联络' } },
    { id: uid('t'), loanId: loans[1].id, type: 'created', title: '策展人发起借展',
      detail: '录入文物信息、保险金额、环境要求与展期', operatorId: curator.id, operatorName: curator.name, at: daysAgo(5) },
    { id: uid('t'), loanId: loans[1].id, type: 'packed', title: '库房确认装箱',
      detail: '完成点交与包装，照片 1 张已留存', operatorId: warehouse.id, operatorName: warehouse.name, at: daysAgo(1),
      meta: { photos: [l2Photos.id] } },
    { id: uid('t'), loanId: loans[2].id, type: 'created', title: '策展人发起借展',
      detail: '录入文物信息、保险金额、环境要求与展期', operatorId: curator.id, operatorName: curator.name, at: daysAgo(1) },
  ];

  const envLogs = [
    { id: uid('e'), loanId: loans[0].id, temp: 20.4, humidity: 52.1, location: '运输途中 · G42 沪蓉高速常州段',
      note: '厢体内数据正常', operatorId: logistics.id, operatorName: logistics.name, at: daysAgo(1) },
    { id: uid('e'), loanId: loans[0].id, temp: 21.0, humidity: 53.4, location: '抵达苏州河美术馆卸货区',
      note: '等候点交', operatorId: logistics.id, operatorName: logistics.name, at: daysAgo(0) },
  ];

  const openEvents = [
    {
      id: uid('o'), loanId: loans[0].id, stage: '库房点交（装箱前开箱）',
      persons: '王库房、陈策展', witness: '苏州河美术馆随员 赵佳',
      note: '点交状况良好，器物无损伤，随后封箱。',
      photos: [l1Photos], operatorId: warehouse.id, operatorName: warehouse.name, at: daysAgo(2),
    },
    {
      id: uid('o'), loanId: loans[0].id, stage: '到馆开箱',
      persons: '李运输、周联络', witness: '苏州河美术馆文保员 孙宁',
      note: '开箱核验与出库记录一致，外观完好，温湿度达标。',
      photos: [l1Open], operatorId: museum.id, operatorName: '周联络', at: daysAgo(0),
    },
    {
      id: uid('o'), loanId: loans[1].id, stage: '库房点交（装箱前开箱）',
      persons: '王库房', witness: '陈策展',
      note: '立轴状况良好，无酸囊匣封箱。',
      photos: [l2Photos], operatorId: warehouse.id, operatorName: warehouse.name, at: daysAgo(1),
    },
  ];

  return {
    counters: { loan: 3 },
    users,
    loans,
    timeline,
    envLogs,
    openEvents,
    meta: { seqMap },
  };
}

/* ---------------- 数据访问 ---------------- */

load();

function getUserByName(username) {
  return db.users.find((u) => u.username === username);
}
function getUserById(id) {
  return db.users.find((u) => u.id === id);
}
function allUsers() { return db.users; }

function listLoans({ museumId } = {}) {
  let rows = [...db.loans].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  if (museumId) rows = rows.filter((l) => l.museumId === museumId);
  return rows;
}
function getLoan(id) { return db.loans.find((l) => l.id === id); }
function getLoanByNo(no) { return db.loans.find((l) => l.loanNo === no); }

function nextLoanNo() {
  db.counters.loan += 1;
  return seqMap.loanSeq(db.counters.loan);
}
function insertLoan(loan) {
  db.loans.push(loan);
  save();
}
function updateLoan(id, patch) {
  const l = getLoan(id);
  if (!l) throw new Error('借展单不存在');
  Object.assign(l, patch);
  save();
  return l;
}

function addTimeline(entry) {
  const row = { id: uid('t'), at: now(), ...entry };
  db.timeline.push(row);
  save();
  return row;
}
function timelineOf(loanId) {
  return db.timeline.filter((t) => t.loanId === loanId).sort((a, b) => a.at.localeCompare(b.at));
}

function addEnvLog(row) {
  const rec = { id: uid('e'), at: now(), ...row };
  db.envLogs.push(rec);
  save();
  return rec;
}
function envLogsOf(loanId) {
  return db.envLogs.filter((e) => e.loanId === loanId).sort((a, b) => b.at.localeCompare(a.at));
}

function addOpenEvent(row) {
  const rec = { id: uid('o'), at: now(), ...row };
  db.openEvents.push(rec);
  save();
  return rec;
}
function openEventsOf(loanId) {
  return db.openEvents.filter((o) => o.loanId === loanId).sort((a, b) => a.at.localeCompare(b.at));
}
function getPhoto(photoId) {
  for (const o of db.openEvents) {
    const p = (o.photos || []).find((x) => x.id === photoId);
    if (p) return { photo: p, openEvent: o };
  }
  return null;
}
function getOpenEvent(id) { return db.openEvents.find((o) => o.id === id); }

module.exports = {
  save, UPLOAD_DIR,
  getUserByName, getUserById, allUsers,
  listLoans, getLoan, getLoanByNo, nextLoanNo, insertLoan, updateLoan,
  addTimeline, timelineOf,
  addEnvLog, envLogsOf,
  addOpenEvent, openEventsOf, getOpenEvent, getPhoto,
};
