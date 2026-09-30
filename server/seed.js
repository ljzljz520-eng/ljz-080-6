// 演示数据初始化：仅在 data/db.json 不存在时执行
const fs = require('fs');
const path = require('path');
const db = require('./db');

const UPLOAD_DIR = path.join(__dirname, 'uploads');

function genSvg(name, bg, fg = '#ffffff') {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600">
<rect width="800" height="600" fill="${bg}"/>
<text x="400" y="290" font-size="34" fill="${fg}" text-anchor="middle" font-family="sans-serif">${name}</text>
<text x="400" y="340" font-size="20" fill="${fg}" text-anchor="middle" font-family="sans-serif" opacity="0.8">演示留痕照片 · 自动生成</text>
</svg>`;
  return Buffer.from(svg);
}

function writePhoto(filename, label, bg) {
  if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  const fp = path.join(UPLOAD_DIR, filename);
  if (!fs.existsSync(fp)) fs.writeFileSync(fp, genSvg(label, bg));
}

function run() {
  const data = db.load();
  if (data.users.length) return false;

  data.museums.push(
    { id: 'm1', name: '苏州吴韵博物馆', contact: '王馆长', phone: '0512-66001100', address: '苏州市姑苏区人民路 88 号', createdAt: ts(-40) },
    { id: 'm2', name: '南海海洋文明馆', contact: '陈主任', phone: '0755-22008800', address: '深圳市南山区望海路 1 号', createdAt: ts(-40) }
  );

  // 四种角色账号；演示环境密码明文（生产请使用哈希）
  data.users.push(
    { id: 'u_cur', username: 'curator',  password: 'demo123', name: '李清照', role: 'curator',  museumId: null },
    { id: 'u_wh1', username: 'keeper',   password: 'demo123', name: '赵守库', role: 'warehouse', museumId: null },
    { id: 'u_log', username: 'logistics',password: 'demo123', name: '孙承运', role: 'logistics', museumId: null },
    { id: 'u_m1',  username: 'museum1',  password: 'demo123', name: '王馆长', role: 'museum',    museumId: 'm1' },
    { id: 'u_m2',  username: 'museum2',  password: 'demo123', name: '陈主任', role: 'museum',    museumId: 'm2' }
  );

  // 借展单 1：在途，含装箱、多条温湿度回传（含一条告警）、一次到馆开箱
  const l1Photos = ['seed_l1_open_1.svg'];
  writePhoto('seed_l1_open_1.svg', '到馆开箱 · 青花缠枝莲纹梅瓶', '#2e6f6b');
  data.loans.push({
    id: 'JY0001',
    artifactNo: 'GW-MING-0317',
    artifactName: '青花缠枝莲纹梅瓶',
    dynasty: '明·永乐',
    insuranceAmount: 6800000,
    requirements: {
      tempMin: 18, tempMax: 22,
      humMin: 50, humMax: 55,
      lightLux: 150, vibration: '防震搬运，倾角小于 15°，禁止叠压',
      extra: '无酸纸包裹，定制囊匣；展柜需恒湿缓冲材料'
    },
    startDate: '2026-10-10',
    endDate: '2027-01-15',
    borrowerId: 'm1',
    status: 'arrived',
    notes: '借展用于《瓷韵华章》特展主展厅 C 位',
    createdBy: 'u_cur',
    createdAt: ts(-30), updatedAt: ts(-2),
    packed: null,
    shipped: null,
    arrival: {
      location: '苏州吴韵博物馆 文物收货区',
      receiver: '王馆长',
      at: ts(-2), by: 'u_log', trackingId: 'SF-MU-20260928-0091'
    },
    returnShipment: null,
    trackings: [
      { id: db.nowId('tk'), at: ts(-6), location: '南京转运中心', temperature: 20.1, humidity: 52, note: '高速服务区夜间停靠', by: 'u_log', alarm: false },
      { id: db.nowId('tk'), at: ts(-5), location: '宁合高速 K180', temperature: 23.6, humidity: 47, note: '正午暴晒，已调整空调', by: 'u_log', alarm: true },
      { id: db.nowId('tk'), at: ts(-3), location: '苏州收货月台', temperature: 20.4, humidity: 53, note: '车况正常', by: 'u_log', alarm: false }
    ],
    openings: [
      { id: db.nowId('op'), at: ts(-1), scene: 'arrival', personnel: '王馆长、赵守库、押运员孙承运', witness: '苏州文博监理 周工', note: '箱体铅封完好，开箱点交无误', photos: l1Photos.map(f => '/uploads/' + f), by: 'u_m1' }
    ]
  });

  // 借展单 2：已发货在途，含装箱、温湿度回传，尚未签收
  const l2Photos = ['seed_l2_pack_1.svg', 'seed_l2_pack_2.svg'];
  writePhoto('seed_l2_pack_1.svg', '装箱 · 青铜错金银带钩（整体）', '#8a5a2b');
  writePhoto('seed_l2_pack_2.svg', '装箱 · 铅封与囊匣细节', '#8a5a2b');
  data.loans.push({
    id: 'JY0002',
    artifactNo: 'GW-HAN-0086',
    artifactName: '青铜错金银带钩',
    dynasty: '西汉',
    insuranceAmount: 2200000,
    requirements: {
      tempMin: 19, tempMax: 21,
      humMin: 45, humMax: 50,
      lightLux: 50, vibration: '轻拿轻放，避免震动；禁止与挥发性材料同箱',
      extra: '青铜病害稳定中，需 RH 稳定 ±3%'
    },
    startDate: '2026-10-15',
    endDate: '2026-12-20',
    borrowerId: 'm2',
    status: 'shipped',
    notes: '《海丝·金属器》单元重点展品',
    createdBy: 'u_cur',
    createdAt: ts(-12), updatedAt: ts(-1),
    packed: { at: ts(-8), by: 'u_wh1', packer: '赵守库', caseNo: 'CASE-B-07', sealNo: 'SEAL-7721', condition: '现状完好，已按囊匣定制装箱', photos: l2Photos.map(f => '/uploads/' + f) },
    shipped: { at: ts(-4), by: 'u_wh1', carrier: '顺丰特运 · 文物专车', trackingId: 'SF-MU-20260929-0144', driver: '马安全' },
    arrival: null,
    returnShipment: null,
    trackings: [
      { id: db.nowId('tk'), at: ts(-3), location: '京港澳高速 保定段', temperature: 20.0, humidity: 48, note: '路况良好', by: 'u_log', alarm: false },
      { id: db.nowId('tk'), at: ts(-1), location: '武汉转运站', temperature: 20.8, humidity: 49, note: '例行检查', by: 'u_log', alarm: false }
    ],
    openings: []
  });

  // 借展单 3：待库房装箱
  data.loans.push({
    id: 'JY0003',
    artifactNo: 'GW-SONG-1024',
    artifactName: '摹本《清明上河图》卷（复制件特批借展）',
    dynasty: '宋摹',
    insuranceAmount: 1500000,
    requirements: {
      tempMin: 18, tempMax: 20,
      humMin: 50, humMax: 55,
      lightLux: 50, vibration: '卷轴平放，禁止挤压',
      extra: '避光运输，开包后须静置 24 小时再展开'
    },
    startDate: '2026-11-01',
    endDate: '2027-02-28',
    borrowerId: 'm1',
    status: 'requested',
    notes: '跨年《长卷上的城市》展',
    createdBy: 'u_cur',
    createdAt: ts(-1), updatedAt: ts(-1),
    packed: null, shipped: null, arrival: null, returnShipment: null,
    trackings: [], openings: []
  });

  // 时间线事件
  ev(data, 'JY0001', 'created', '李清照', ts(-30), '策展人发起借展');
  ev(data, 'JY0001', 'packed', '赵守库', ts(-9), '库房完成装箱并铅封（箱号 CASE-A-02 / 铅封 6630）');
  ev(data, 'JY0001', 'shipped', '赵守库', ts(-7), '文物专车发运，运单号 SF-MU-20260928-0091');
  ev(data, 'JY0001', 'tracking', '孙承运', ts(-6), '温湿度回传 · 南京转运中心 20.1℃ / 52%');
  ev(data, 'JY0001', 'tracking_alarm', '孙承运', ts(-5), '温湿度告警 · 23.6℃ / 47% 超出约定区间');
  ev(data, 'JY0001', 'tracking', '孙承运', ts(-3), '温湿度回传 · 苏州收货月台 20.4℃ / 53%');
  ev(data, 'JY0001', 'arrived', '孙承运', ts(-2), '到馆签收：苏州吴韵博物馆，签收人 王馆长');
  ev(data, 'JY0001', 'opened', '王馆长', ts(-1), '到馆开箱点交，留痕 1 张照片');

  ev(data, 'JY0002', 'created', '李清照', ts(-12), '策展人发起借展');
  ev(data, 'JY0002', 'packed', '赵守库', ts(-8), '库房完成装箱（箱号 CASE-B-07 / 铅封 7721），留痕 2 张照片');
  ev(data, 'JY0002', 'shipped', '赵守库', ts(-4), '文物专车发运，运单号 SF-MU-20260929-0144');
  ev(data, 'JY0002', 'tracking', '孙承运', ts(-3), '温湿度回传 · 保定段 20.0℃ / 48%');
  ev(data, 'JY0002', 'tracking', '孙承运', ts(-1), '温湿度回传 · 武汉转运站 20.8℃ / 49%');

  ev(data, 'JY0003', 'created', '李清照', ts(-1), '策展人发起借展，等待库房装箱');

  db.persistNow();
  return true;
}

function ts(daysAgo) {
  return new Date(Date.UTC(2026, 8, 30, 4, 0, 0) - daysAgo * 86400000).toISOString();
}
function ev(data, loanId, type, actor, at, desc) {
  data.events.push({ id: db.nowId('ev'), loanId, type, actor, at, desc });
}

module.exports = { run };

if (require.main === module) {
  const ok = run();
  console.log(ok ? '种子数据已写入 server/data/db.json' : '数据已存在，跳过');
}
