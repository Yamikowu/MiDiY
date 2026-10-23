import { t, l, onLocaleChange, translateLabel, getLocale, formatError } from '../i18n/index';
import { controls, getControl } from '../devices/mikro-mk3/controls.js';
import { hex, reportHex, summarizeCapture, normalizeImport } from './analysis.js';
import { renderHardware, refreshHardwareLabels } from '../devices/mikro-mk3/hardware-view.js';
import { CaptureSession, MAX_REPORTS } from './capture-session.js';

export function mountTesting(runtime, toast) {
  const $ = id => document.getElementById(id);
  const model = new CaptureSession();
  let selected = 'PAD_1';
  let displayedCapture = null;
  let device = runtime.snapshot.device;
  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
  }

  function selectControl(id) {
    if (!getControl(id) || model.activeCapture) return;
    selected = id;
    const control = getControl(id);
    $('selected-name').textContent = translateLabel(control.label);
    $('selected-instruction').textContent = translateLabel(control.instruction);
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
    $('metric-device').textContent = connected ? t('connected_2') : t('waiting_for_connection');
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
        toast(t('recording_reached_100_000_reports_midi_translation_continues_export_and')); updateUI();
      }
      return;
    }
    if (!$('pause-log').checked) renderReportRows();
    $('metric-reports').textContent = model.session.reports.length.toLocaleString();
  }

  function renderReportRows() {
    $('report-rows').innerHTML = model.displayRows.length ? model.displayRows.map(record => `<tr><td>${escapeHtml(new Date(record.time).toLocaleTimeString(getLocale(), { hour12: false, fractionalSecondDigits: 3 }))}</td><td>0x${hex(record.reportId)}</td><td>${record.bytes.length}</td><td>${record.changedOffsets.length ? record.changedOffsets.map(offset => `+${offset}`).join(', ') : '—'}</td><td class="raw">${reportHex(record.bytes)}</td></tr>`).join('') : `<tr><td colspan="5" class="table-empty">${l('waiting_for_hid_input_report', {})}</td></tr>`;
  }

  function startCapture() {
    if (!device || model.activeCapture) return;
    model.start(selected);
    $('capture-result').className = 'result active';
    $('capture-result').textContent = t('recording_follow_the_control_instructions_then_select_stop_analyze');
    updateUI();
  }

  function stopCapture() {
    if (!model.activeCapture) return;
    const finished = model.stop($('capture-note').value);
    $('capture-note').value = '';
    renderCaptureResult(finished);
    updateUI();
    toast(finished.samples.length ? t('saved_reports', { p0: finished.samples.length }) : t('no_input_reports_received_during_capture_try_the_action_again'));
  }

  function renderCaptureResult(capture) {
    displayedCapture = capture ?? null;
    const element = $('capture-result');
    if (!capture) { element.className = 'result empty'; element.textContent = t('connect_a_device_and_complete_a_capture_to_see_candidate_report_ids_and'); return; }
    const candidates = capture.candidates || summarizeCapture(capture);
    element.className = 'result';
    element.innerHTML = `<div class="result-title"><span>CAPTURE SUMMARY</span><strong>${capture.samples.length} reports · ${candidates.length} candidates</strong></div>${capture.note ? `<p>${l('action_notes_2', { p0: capture.note })}</p>` : ''}${candidates.length ? `<div class="candidate-list">${candidates.slice(0, 12).map(candidate => `<div><b>0x${hex(candidate.reportId)}</b><span>byte +${candidate.offset}</span><small>${candidate.count}× · ${candidate.values.slice(0, 8).map(hex).join(' / ')}${candidate.values.length > 8 ? ' …' : ''}</small></div>`).join('')}</div>` : `<p>${l('no_byte_changes_observed', {})}</p>`}`;
  }

  function renderCaptureList() {
    $('capture-list').innerHTML = model.session.captures.length ? [...model.session.captures].reverse().map(capture => `<button class="capture-item" data-capture="${escapeHtml(capture.id)}"><span><b>${escapeHtml(translateLabel(getControl(capture.controlId)?.label || capture.controlId))}</b><small>${escapeHtml(new Date(capture.startedAt).toLocaleString(getLocale()))}${capture.note ? ` · ${escapeHtml(capture.note)}` : ''}</small></span><strong>${capture.samples.length} <small>reports</small></strong></button>`).join('') : `<div class="list-empty">${l('no_captures_yet', {})}</div>`;
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
    const rows = [['capture_id', 'control_id', 'control_label', 'started_at', 'report_count', 'report_id', 'byte_offset', 'change_count', 'values_hex', 'note']];
    for (const capture of model.session.captures) {
      const candidates = capture.candidates || summarizeCapture(capture);
      for (const candidate of candidates) rows.push([capture.id, capture.controlId, getControl(capture.controlId)?.label || '', capture.startedAt, capture.samples.length, `0x${hex(candidate.reportId)}`, candidate.offset, candidate.count, candidate.values.map(hex).join(' '), capture.note]);
    }
    download('midiy-candidates.csv', rows.map(row => row.map(csvCell).join(',')).join('\r\n'), 'text/csv;charset=utf-8');
  }

  async function importJson(file) {
    try {
      const parsed = normalizeImport(JSON.parse(await file.text()));
      if (!window.confirm(t('import_replaces_the_current_session_export_any_data_you_want_to_keep_fir'))) return;
      if (device) await runtime.disconnect();
      model.import(parsed);
      renderReportRows();
      renderCaptureResult(model.session.captures.findLast(capture => capture.controlId === selected));
      updateUI();
      toast(t('session_imported'));
    } catch (error) { toast(t('import_failed', { p0: formatError(error) })); }
  }

  $('start-capture').addEventListener('click', startCapture);
  $('stop-capture').addEventListener('click', stopCapture);
  $('clear-log').addEventListener('click', () => { model.displayRows = []; renderReportRows(); });
  $('pause-log').addEventListener('change', () => { if (!$('pause-log').checked) renderReportRows(); });
  $('export-json').addEventListener('click', exportJson);
  $('export-csv').addEventListener('click', exportCsv);
  $('import-json').addEventListener('change', event => { const file = event.target.files[0]; if (file) importJson(file); event.target.value = ''; });
  $('reset-session').addEventListener('click', () => { if (!window.confirm(t('clear_this_session_all_unexported_reports_and_captures_will_be_removed'))) return; model.reset(); renderReportRows(); renderCaptureResult(); updateUI(); toast(t('session_cleared')); });
  $('capture-list').addEventListener('click', event => { const button = event.target.closest('[data-capture]'); if (!button || model.activeCapture) return; const capture = model.session.captures.find(item => item.id === button.dataset.capture); if (capture) { selectControl(capture.controlId); renderCaptureResult(capture); } });
  renderHardware($('hardware'), selectControl);
  selectControl(selected);
  $('testing-decoded').innerHTML = `<div class="section-heading"><div><p class="eyebrow">DECODED INPUT</p><h2>${l('decoded_input', {})}</h2></div><span id="midi-count" class="section-note">${l('0_midi_messages', {})}</span></div><label class="switch"><input id="midi-pressure-events" type="checkbox">${l('show_pad_pressure_events', {})}</label><pre id="midi-events" aria-live="off">${l('waiting_for_controller_input', {})}</pre>`;
  let rows = [], frame = 0;
  function addEvent(text) {
    rows.unshift(text); rows.length = Math.min(40, rows.length);
    if (!frame) frame = requestAnimationFrame(() => {
      frame = 0; $('midi-events').textContent = rows.join('\n');
      $('midi-count').textContent = t('midi_messages', { p0: runtime.snapshot.midiCount });
    });
  }
  const unsubscribe = runtime.subscribe(event => {
    if (event.type === 'raw') onInput(event.report);
    else if (event.type === 'decoded' && (event.event.kind !== 'pad' || event.event.event !== 'aftertouch' || $('midi-pressure-events').checked)) addEvent(JSON.stringify(event.event));
    else if (event.type === 'midi') addEvent(`${event.delivered ? 'MIDI →' : t('midi_preview')} ${event.messages.map(m => m.map(v => v.toString(16).padStart(2, '0')).join(' ')).join(' | ')}`);
    else if (event.type === 'diagnostic') addEvent(`⚠ ${event.message}`);
    else if (event.type === 'state') {
      const previous = device; device = event.state.device;
      if (previous && !device) { if (model.activeCapture) stopCapture(); model.lastByReport.clear(); }
      if (!previous && device) model.session.device = {
        vendorId: device.vendorId, productId: device.productId,
        productName: device.productName, connectedAt: new Date().toISOString()
      };
      if (Boolean(previous) !== Boolean(device)) updateUI();
    }
  });
  renderReportRows(); updateUI();
  const unsubscribeLocale = onLocaleChange(() => {
    const control = getControl(selected);
    $('selected-name').textContent = translateLabel(control.label);
    $('selected-instruction').textContent = translateLabel(control.instruction);
    refreshHardwareLabels($('hardware'));
    updateUI();
    if (!$('pause-log').checked) renderReportRows();
    if (model.activeCapture) $('capture-result').textContent = t('recording_follow_the_control_instructions_then_select_stop_analyze');
    else renderCaptureResult(displayedCapture);
    $('midi-count').textContent = t('midi_messages', { p0: runtime.snapshot.midiCount });
  });
  return () => { unsubscribeLocale(); unsubscribe(); if (frame) cancelAnimationFrame(frame); };
}
