import { controls, getControl } from '../devices/mikro-mk3/controls.js';
import { hex, reportHex, summarizeCapture, normalizeImport } from './analysis.js';
import { renderHardware } from '../devices/mikro-mk3/hardware-view.js';
import { CaptureSession, MAX_REPORTS } from './capture-session.js';

export function mountTesting(runtime, toast) {
  const $ = id => document.getElementById(id);
  const model = new CaptureSession();
  let selected = 'PAD_1';
  let device = runtime.snapshot.device;
  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
  }

  function selectControl(id) {
    if (!getControl(id) || model.activeCapture) return;
    selected = id;
    const control = getControl(id);
    $('selected-name').textContent = control.label;
    $('selected-instruction').textContent = control.instruction;
    $('hardware').querySelectorAll('[data-control]').forEach(button => {
      button.classList.toggle('selected', button.dataset.control === id);
      button.setAttribute('aria-pressed', String(button.dataset.control === id));
    });
    renderCaptureResult(model.session.captures.findLast(capture => capture.controlId === id));
  }

  function updateUI() {
    const connected = Boolean(device);
    $('start-capture').disabled = !connected || Boolean(model.activeCapture) || model.session.reports.length >= MAX_REPORTS;
    $('stop-capture').disabled = !model.activeCapture;
    $('capture-indicator').textContent = model.activeCapture ? '● RECORDING' : 'READY';
    $('capture-indicator').classList.toggle('recording', Boolean(model.activeCapture));
    $('metric-device').textContent = connected ? '已連線' : '等待連線';
    $('metric-reports').textContent = model.session.reports.length.toLocaleString();
    $('metric-captures').textContent = String(model.session.captures.length);
    $('metric-coverage').textContent = `${new Set(model.session.captures.filter(capture => capture.samples.length).map(capture => capture.controlId)).size} / ${controls.length}`;
    $('hardware').querySelectorAll('[data-control]').forEach(button => button.classList.toggle('captured', model.session.captures.some(capture => capture.controlId === button.dataset.control && capture.samples.length)));
    renderCaptureList();
  }

  function onInput(report) {
    const result = model.receive(report);
    if (!result.recorded) {
      if (result.firstFull) {
        if (model.activeCapture) stopCapture();
        toast('錄製已達 100,000 筆上限；MIDI 轉譯繼續運作。請匯出後清空工作階段。'); updateUI();
      }
      return;
    }
    if (!$('pause-log').checked) renderReportRows();
    $('metric-reports').textContent = model.session.reports.length.toLocaleString();
  }

  function renderReportRows() {
    $('report-rows').innerHTML = model.displayRows.length ? model.displayRows.map(record => `<tr><td>${escapeHtml(new Date(record.time).toLocaleTimeString('zh-TW', { hour12: false, fractionalSecondDigits: 3 }))}</td><td>0x${hex(record.reportId)}</td><td>${record.bytes.length}</td><td>${record.changedOffsets.length ? record.changedOffsets.map(offset => `+${offset}`).join(', ') : '—'}</td><td class="raw">${reportHex(record.bytes)}</td></tr>`).join('') : '<tr><td colspan="5" class="table-empty">等待 HID Input Report…</td></tr>';
  }

  function startCapture() {
    if (!device || model.activeCapture) return;
    model.start(selected);
    $('capture-result').className = 'result active';
    $('capture-result').textContent = '正在記錄。請依照提示操作實體控制器，完成後按「停止並分析」。';
    updateUI();
  }

  function stopCapture() {
    if (!model.activeCapture) return;
    const finished = model.stop($('capture-note').value);
    $('capture-note').value = '';
    renderCaptureResult(finished);
    updateUI();
    toast(finished.samples.length ? `已保存 ${finished.samples.length} 筆報告。` : '擷取期間沒有收到 Input Report；可重新操作再試。');
  }

  function renderCaptureResult(capture) {
    const element = $('capture-result');
    if (!capture) { element.className = 'result empty'; element.textContent = '連接裝置並完成一筆擷取後，這裡會顯示候選報告 ID 與位元組偏移。'; return; }
    const candidates = capture.candidates || summarizeCapture(capture);
    element.className = 'result';
    element.innerHTML = `<div class="result-title"><span>CAPTURE SUMMARY</span><strong>${capture.samples.length} reports · ${candidates.length} candidates</strong></div>${capture.note ? `<p>操作備註：${escapeHtml(capture.note)}</p>` : ''}${candidates.length ? `<div class="candidate-list">${candidates.slice(0, 12).map(candidate => `<div><b>0x${hex(candidate.reportId)}</b><span>byte +${candidate.offset}</span><small>${candidate.count}× · ${candidate.values.slice(0, 8).map(hex).join(' / ')}${candidate.values.length > 8 ? ' …' : ''}</small></div>`).join('')}</div>` : '<p>沒有觀察到位元組變化。</p>'}`;
  }

  function renderCaptureList() {
    $('capture-list').innerHTML = model.session.captures.length ? [...model.session.captures].reverse().map(capture => `<button class="capture-item" data-capture="${escapeHtml(capture.id)}"><span><b>${escapeHtml(getControl(capture.controlId)?.label || capture.controlId)}</b><small>${escapeHtml(new Date(capture.startedAt).toLocaleString('zh-TW'))}${capture.note ? ` · ${escapeHtml(capture.note)}` : ''}</small></span><strong>${capture.samples.length} <small>reports</small></strong></button>`).join('') : '<div class="list-empty">還沒有擷取記錄。</div>';
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
    download(`midiy-session-${new Date().toISOString().replace(/[:.]/g, '-')}.json`, JSON.stringify(model.session, null, 2), 'application/json');
  }

  function csvCell(value) { return `"${String(value ?? '').replaceAll('"', '""')}"`; }
  function exportCsv() {
    const rows = [['capture_id','control_id','control_label','started_at','report_count','report_id','byte_offset','change_count','values_hex','note']];
    for (const capture of model.session.captures) {
      const candidates = capture.candidates || summarizeCapture(capture);
      for (const candidate of candidates) rows.push([capture.id,capture.controlId,getControl(capture.controlId)?.label || '',capture.startedAt,capture.samples.length,`0x${hex(candidate.reportId)}`,candidate.offset,candidate.count,candidate.values.map(hex).join(' '),capture.note]);
    }
    download('midiy-candidates.csv', rows.map(row => row.map(csvCell).join(',')).join('\r\n'), 'text/csv;charset=utf-8');
  }

  async function importJson(file) {
    try {
      const parsed = normalizeImport(JSON.parse(await file.text()));
      if (!window.confirm('匯入會取代目前工作階段。請先匯出需要保留的資料。確定繼續？')) return;
      if (device) await runtime.disconnect();
      model.import(parsed);
      renderReportRows();
      renderCaptureResult(model.session.captures.findLast(capture => capture.controlId === selected));
      updateUI();
      toast('已匯入工作階段。');
    } catch (error) { toast(`匯入失敗：${error.message}`); }
  }

  $('start-capture').addEventListener('click', startCapture);
  $('stop-capture').addEventListener('click', stopCapture);
  $('clear-log').addEventListener('click', () => { model.displayRows = []; renderReportRows(); });
  $('pause-log').addEventListener('change', () => { if (!$('pause-log').checked) renderReportRows(); });
  $('export-json').addEventListener('click', exportJson);
  $('export-csv').addEventListener('click', exportCsv);
  $('import-json').addEventListener('change', event => { const file = event.target.files[0]; if (file) importJson(file); event.target.value = ''; });
  $('reset-session').addEventListener('click', () => { if (!window.confirm('確定清空目前工作階段？尚未匯出的原始報告與擷取記錄都會移除。')) return; model.reset(); renderReportRows(); renderCaptureResult(); updateUI(); toast('工作階段已清空。'); });
  $('capture-list').addEventListener('click', event => { const button = event.target.closest('[data-capture]'); if (!button || model.activeCapture) return; const capture = model.session.captures.find(item => item.id === button.dataset.capture); if (capture) { selectControl(capture.controlId); renderCaptureResult(capture); } });
  renderHardware($('hardware'), selectControl);
  selectControl(selected);
  $('testing-decoded').innerHTML = `<div class="section-heading"><div><p class="eyebrow">DECODED INPUT</p><h2>即時解碼</h2></div><span id="midi-count" class="section-note">0 MIDI 訊息</span></div><label class="switch"><input id="midi-pressure-events" type="checkbox">顯示 Pad 壓力事件</label><pre id="midi-events" aria-live="off">等待控制器輸入…</pre>`;
  let rows = [], frame = 0;
  function addEvent(text) {
    rows.unshift(text); rows.length = Math.min(40, rows.length);
    if (!frame) frame = requestAnimationFrame(() => {
      frame = 0; $('midi-events').textContent = rows.join('\n');
      $('midi-count').textContent = `${runtime.snapshot.midiCount} MIDI 訊息`;
    });
  }
  const unsubscribe = runtime.subscribe(event => {
    if (event.type === 'raw') onInput(event.report);
    else if (event.type === 'decoded' && (event.event.kind !== 'pad' || event.event.event !== 'aftertouch' || $('midi-pressure-events').checked)) addEvent(JSON.stringify(event.event));
    else if (event.type === 'midi') addEvent(`${event.delivered ? 'MIDI →' : '預覽 MIDI'} ${event.messages.map(m => m.map(v => v.toString(16).padStart(2, '0')).join(' ')).join(' | ')}`);
    else if (event.type === 'diagnostic') addEvent(`⚠ ${event.message}`);
    else if (event.type === 'state') {
      const previous = device; device = event.state.device;
      if (previous && !device) { if (model.activeCapture) stopCapture(); model.lastByReport.clear(); }
      if (!previous && device) model.session.device = { vendorId: device.vendorId, productId: device.productId,
        productName: device.productName, connectedAt: new Date().toISOString() };
      if (Boolean(previous) !== Boolean(device)) updateUI();
    }
  });
  renderReportRows(); updateUI();
  return () => { unsubscribe(); if (frame) cancelAnimationFrame(frame); };
}
