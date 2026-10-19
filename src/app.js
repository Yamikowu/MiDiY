import { controls, groups, getControl } from './controls.js';
import { changedBytes, hex, reportHex, summarizeCapture, normalizeImport } from './analysis.js';

const $ = id => document.getElementById(id);
const VID = 0x17cc;
const PID = 0x1700;
const MAX_REPORTS = 100000;
let device = null;
let selected = 'PAD_1';
let activeCapture = null;
let lastByReport = new Map();
let displayRows = [];
let session = freshSession();

function freshSession() {
  return { schema: 'mpa-session-v1', appVersion: '1.0.0', createdAt: new Date().toISOString(), device: null, reports: [], captures: [] };
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

function toast(message) {
  $('toast').textContent = message;
  $('toast').classList.add('visible');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => $('toast').classList.remove('visible'), 4000);
}

function controlButton(id, extra = '') {
  const control = getControl(id);
  return `<button type="button" class="hw-button ${extra}" data-control="${id}" aria-label="選取 ${escapeHtml(control.label)}">${escapeHtml(control.label)}</button>`;
}

function renderHardware() {
  $('hardware').innerHTML = `
    <div class="device-topline"><span>MASCHINE</span><b>MIKRO <i>MK3</i></b></div>
    <div class="device-upper">
      <div class="hw-section browser-zone"><small>BROWSER</small>${groups[0].controls.map(id => controlButton(id)).join('')}</div>
      <div class="hw-section edit-zone"><small>EDIT / DISPLAY</small><div class="screen">MIKRO MK3 <span>▮▮▮▮▮</span></div><div class="edit-grid">${['PLUG_IN','SAMPLING','VOLUME','SWING','TEMPO','ARROW_LEFT','ARROW_RIGHT'].map(id => controlButton(id)).join('')}<div class="encoder-cluster">${controlButton('ENCODER_ROTATE', 'encoder')}${controlButton('ENCODER_PUSH', 'push')}</div></div></div>
    </div>
    <div class="device-lower">
      <div class="left-side"><div class="hw-section performance-zone"><small>PERFORMANCE</small><div class="mini-grid">${['PITCH','MOD','PERFORM','NOTES'].map(id => controlButton(id)).join('')}</div>${controlButton('SMART_STRIP', 'strip')}<div class="mini-grid">${['GROUP','AUTO','LOCK','NOTE_REPEAT'].map(id => controlButton(id)).join('')}</div></div><div class="hw-section transport-zone"><small>TRANSPORT</small><div class="mini-grid">${groups[3].controls.map(id => controlButton(id)).join('')}</div></div></div>
      <div class="right-side"><div class="hw-section padmode-zone"><small>PAD INPUT MODE</small><div class="padmode-grid">${groups[5].controls.map(id => controlButton(id)).join('')}</div></div><div class="pad-area"><div class="mode-grid">${groups[4].controls.map(id => controlButton(id)).join('')}</div><div class="pads">${[13,14,15,16,9,10,11,12,5,6,7,8,1,2,3,4].map(n => controlButton(`PAD_${n}`, 'pad')).join('')}</div></div></div>
    </div><div class="device-bottomline">NATIVE INSTRUMENTS <span>USB CONTROLLER / 17CC:1700</span></div>`;
  $('hardware').addEventListener('click', event => {
    const button = event.target.closest('[data-control]');
    if (button) selectControl(button.dataset.control);
  });
  selectControl(selected);
}

function selectControl(id) {
  if (!getControl(id) || activeCapture) return;
  selected = id;
  const control = getControl(id);
  $('selected-name').textContent = control.label;
  $('selected-instruction').textContent = control.instruction;
  document.querySelectorAll('[data-control]').forEach(button => button.classList.toggle('selected', button.dataset.control === id));
  renderCaptureResult(session.captures.findLast(capture => capture.controlId === id));
}

function updateUI() {
  const connected = Boolean(device?.opened);
  $('device-status').textContent = connected ? `● 已連線 ${device.productName || 'Mikro MK3'}` : '● 尚未連線';
  $('device-status').classList.toggle('connected', connected);
  $('connect').disabled = connected;
  $('disconnect').disabled = !connected;
  $('start-capture').disabled = !connected || Boolean(activeCapture) || session.reports.length >= MAX_REPORTS;
  $('stop-capture').disabled = !activeCapture;
  $('capture-indicator').textContent = activeCapture ? '● RECORDING' : 'READY';
  $('capture-indicator').classList.toggle('recording', Boolean(activeCapture));
  $('metric-device').textContent = connected ? '已連線' : '等待連線';
  $('metric-reports').textContent = session.reports.length.toLocaleString();
  $('metric-captures').textContent = String(session.captures.length);
  $('metric-coverage').textContent = `${new Set(session.captures.filter(capture => capture.samples.length).map(capture => capture.controlId)).size} / ${controls.length}`;
  document.querySelectorAll('[data-control]').forEach(button => button.classList.toggle('captured', session.captures.some(capture => capture.controlId === button.dataset.control && capture.samples.length)));
  renderCaptureList();
}

async function connect() {
  if (!('hid' in navigator)) return toast('此瀏覽器不支援 WebHID；請使用支援 WebHID 的桌面瀏覽器。');
  try {
    const devices = await navigator.hid.requestDevice({ filters: [{ vendorId: VID, productId: PID }] });
    if (!devices.length) return;
    const chosen = devices[0];
    if (!chosen.opened) await chosen.open();
    device = chosen;
    chosen.addEventListener('inputreport', onInput);
    session.device = { vendorId: chosen.vendorId, productId: chosen.productId, productName: chosen.productName || '', connectedAt: new Date().toISOString() };
    updateUI();
    toast('已連接裝置。請先讓控制器靜止，再開始逐項擷取。');
  } catch (error) { toast(`連接失敗：${error.message}`); }
}

async function disconnect() {
  if (!device) return;
  if (activeCapture) stopCapture();
  const current = device;
  device = null;
  current.removeEventListener('inputreport', onInput);
  try { if (current.opened) await current.close(); } catch (error) { toast(`關閉裝置失敗：${error.message}`); }
  lastByReport.clear();
  updateUI();
}

function onInput(event) {
  const bytes = Array.from(new Uint8Array(event.data.buffer, event.data.byteOffset, event.data.byteLength));
  const reportId = event.reportId;
  const previous = lastByReport.get(reportId) || [];
  const changes = changedBytes(previous, bytes);
  lastByReport.set(reportId, bytes);
  const record = { time: new Date().toISOString(), t: Math.round(performance.now() * 1000) / 1000, reportId, bytes, changedOffsets: changes.map(change => change.offset) };
  if (session.reports.length >= MAX_REPORTS) {
    if (device) void disconnect();
    toast('已達 100,000 筆上限，請匯出資料後清空工作階段。');
    updateUI();
    return;
  }
  session.reports.push(record);
  if (activeCapture) activeCapture.samples.push(record);
  displayRows.unshift(record);
  if (displayRows.length > 100) displayRows.pop();
  if (!$('pause-log').checked) renderReportRows();
  $('metric-reports').textContent = session.reports.length.toLocaleString();
}

function renderReportRows() {
  $('report-rows').innerHTML = displayRows.length ? displayRows.map(record => `<tr><td>${escapeHtml(new Date(record.time).toLocaleTimeString('zh-TW', { hour12: false, fractionalSecondDigits: 3 }))}</td><td>0x${hex(record.reportId)}</td><td>${record.bytes.length}</td><td>${record.changedOffsets.length ? record.changedOffsets.map(offset => `+${offset}`).join(', ') : '—'}</td><td class="raw">${reportHex(record.bytes)}</td></tr>`).join('') : '<tr><td colspan="5" class="table-empty">等待 HID Input Report…</td></tr>';
}

function startCapture() {
  if (!device?.opened || activeCapture) return;
  activeCapture = { id: crypto.randomUUID(), controlId: selected, startedAt: new Date().toISOString(), endedAt: null, note: '', baseline: Object.fromEntries([...lastByReport.entries()]), samples: [] };
  $('capture-note').value = '';
  $('capture-result').className = 'result active';
  $('capture-result').textContent = '正在記錄。請依照提示操作實體控制器，完成後按「停止並分析」。';
  updateUI();
}

function stopCapture() {
  if (!activeCapture) return;
  activeCapture.endedAt = new Date().toISOString();
  activeCapture.note = $('capture-note').value.trim();
  activeCapture.candidates = summarizeCapture(activeCapture);
  session.captures.push(activeCapture);
  const finished = activeCapture;
  activeCapture = null;
  renderCaptureResult(finished);
  updateUI();
  toast(finished.samples.length ? `已保存 ${finished.samples.length} 筆報告。` : '擷取期間沒有收到 Input Report；可重新操作再試。');
}

function renderCaptureResult(capture) {
  const element = $('capture-result');
  if (!capture) { element.className = 'result empty'; element.textContent = '連接裝置並完成一筆擷取後，這裡會顯示候選報告 ID 與位元組偏移。'; return; }
  const candidates = capture.candidates || summarizeCapture(capture);
  element.className = 'result';
  element.innerHTML = `<div class="result-title"><span>CAPTURE SUMMARY</span><strong>${capture.samples.length} reports · ${candidates.length} candidates</strong></div>${candidates.length ? `<div class="candidate-list">${candidates.slice(0, 12).map(candidate => `<div><b>0x${hex(candidate.reportId)}</b><span>byte +${candidate.offset}</span><small>${candidate.count}× · ${candidate.values.slice(0, 8).map(hex).join(' / ')}${candidate.values.length > 8 ? ' …' : ''}</small></div>`).join('')}</div>` : '<p>沒有觀察到位元組變化。</p>'}`;
}

function renderCaptureList() {
  $('capture-list').innerHTML = session.captures.length ? [...session.captures].reverse().map(capture => `<button class="capture-item" data-capture="${escapeHtml(capture.id)}"><span><b>${escapeHtml(getControl(capture.controlId)?.label || capture.controlId)}</b><small>${escapeHtml(new Date(capture.startedAt).toLocaleString('zh-TW'))}${capture.note ? ` · ${escapeHtml(capture.note)}` : ''}</small></span><strong>${capture.samples.length} <small>reports</small></strong></button>`).join('') : '<div class="list-empty">還沒有擷取記錄。</div>';
}

function download(filename, contents, type) {
  const link = document.createElement('a');
  const url = URL.createObjectURL(new Blob([contents], { type }));
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportJson() {
  download(`mpa-session-${new Date().toISOString().replace(/[:.]/g, '-')}.json`, JSON.stringify(session, null, 2), 'application/json');
}

function csvCell(value) { return `"${String(value ?? '').replaceAll('"', '""')}"`; }
function exportCsv() {
  const rows = [['capture_id','control_id','control_label','started_at','report_count','report_id','byte_offset','change_count','values_hex','note']];
  for (const capture of session.captures) {
    const candidates = capture.candidates || summarizeCapture(capture);
    for (const candidate of candidates) rows.push([capture.id,capture.controlId,getControl(capture.controlId)?.label || '',capture.startedAt,capture.samples.length,`0x${hex(candidate.reportId)}`,candidate.offset,candidate.count,candidate.values.map(hex).join(' '),capture.note]);
  }
  download('mpa-candidates.csv', rows.map(row => row.map(csvCell).join(',')).join('\r\n'), 'text/csv;charset=utf-8');
}

async function importJson(file) {
  try {
    const parsed = normalizeImport(JSON.parse(await file.text()));
    if (!window.confirm('匯入會取代目前工作階段。請先匯出需要保留的資料。確定繼續？')) return;
    if (device) await disconnect();
    session = parsed;
    displayRows = session.reports.slice(-100).reverse();
    lastByReport = new Map();
    for (const record of session.reports) lastByReport.set(record.reportId, record.bytes);
    renderReportRows();
    renderCaptureResult(session.captures.findLast(capture => capture.controlId === selected));
    updateUI();
    toast('已匯入工作階段。');
  } catch (error) { toast(`匯入失敗：${error.message}`); }
}

$('connect').addEventListener('click', connect);
$('disconnect').addEventListener('click', disconnect);
$('start-capture').addEventListener('click', startCapture);
$('stop-capture').addEventListener('click', stopCapture);
$('clear-log').addEventListener('click', () => { displayRows = []; renderReportRows(); });
$('pause-log').addEventListener('change', () => { if (!$('pause-log').checked) renderReportRows(); });
$('export-json').addEventListener('click', exportJson);
$('export-csv').addEventListener('click', exportCsv);
$('import-json').addEventListener('change', event => { const file = event.target.files[0]; if (file) importJson(file); event.target.value = ''; });
$('reset-session').addEventListener('click', () => { if (!window.confirm('確定清空目前工作階段？尚未匯出的原始報告與擷取記錄都會移除。')) return; if (activeCapture) activeCapture = null; session = freshSession(); displayRows = []; lastByReport.clear(); renderReportRows(); renderCaptureResult(); updateUI(); toast('工作階段已清空。'); });
$('capture-list').addEventListener('click', event => { const button = event.target.closest('[data-capture]'); if (!button || activeCapture) return; const capture = session.captures.find(item => item.id === button.dataset.capture); if (capture) { selectControl(capture.controlId); renderCaptureResult(capture); } });
if ('hid' in navigator) navigator.hid.addEventListener('disconnect', event => { if (event.device === device) { device.removeEventListener('inputreport', onInput); if (activeCapture) stopCapture(); device = null; lastByReport.clear(); updateUI(); toast('裝置已拔除。'); } });
renderHardware();
renderReportRows();
updateUI();
