// 轻量 JSON 文件持久化（零外部依赖，适合演示/单机部署）
// 生产环境可替换为 SQLite/PostgreSQL，接口保持不变。
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

function emptyData() {
  return {
    meta: { createdAt: new Date().toISOString(), loanSeq: 0 },
    users: [],
    museums: [],
    loans: [],
    events: [],
  };
}

let data = null;

function load() {
  if (data) return data;
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (fs.existsSync(DB_FILE)) {
    data = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } else {
    data = emptyData();
  }
  return data;
}

let saveTimer = null;
function save() {
  // 同步写临时文件后原子替换，避免并发请求写坏数据
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, DB_FILE);
}

function persist() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(save, 0);
}
function persistNow() {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  save();
}

function nextLoanId() {
  const d = load();
  // 以库中已有单号的最大序号为准，避免与种子数据/手工单号冲突
  const maxSeq = d.loans.reduce((m, l) => {
    const mm = /^JY(\d+)$/.exec(l.id || '');
    return mm ? Math.max(m, parseInt(mm[1], 10)) : m;
  }, d.meta.loanSeq || 0);
  d.meta.loanSeq = maxSeq + 1;
  persistNow();
  return 'JY' + String(d.meta.loanSeq).padStart(4, '0');
}

function nowId(prefix) {
  return prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

module.exports = { load, persist, persistNow, nextLoanId, nowId };
