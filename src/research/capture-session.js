import { changedBytes, summarizeCapture, normalizeImport } from './analysis.js';
export const MAX_REPORTS = 100000;
const freshSession = () => ({ schema: 'midiy-session-v1', appVersion: '1.0.0',
  createdAt: new Date().toISOString(), device: null, reports: [], captures: [] });

/** Research state is independent of Mapping, HID events and the DOM. */
export class CaptureSession {
  session = freshSession();
  activeCapture = null;
  lastByReport = new Map();
  displayRows = [];
  recordingFull = false;
  receive({ reportId, data }, time = new Date().toISOString(), t = performance.now()) {
    const bytes = Array.from(data);
    const changes = changedBytes(this.lastByReport.get(reportId) || [], bytes);
    this.lastByReport.set(reportId, bytes);
    if (this.session.reports.length >= MAX_REPORTS) {
      const firstFull = !this.recordingFull; this.recordingFull = true;
      return { recorded: false, firstFull };
    }
    const record = { time, t: Math.round(t * 1000) / 1000, reportId, bytes,
      changedOffsets: changes.map(change => change.offset) };
    this.session.reports.push(record);
    if (this.activeCapture) this.activeCapture.samples.push(record);
    this.displayRows.unshift(record); this.displayRows.length = Math.min(100, this.displayRows.length);
    return { recorded: true, firstFull: false };
  }
  start(controlId) {
    if (this.activeCapture || this.session.reports.length >= MAX_REPORTS) return;
    this.activeCapture = { id: crypto.randomUUID(), controlId, startedAt: new Date().toISOString(),
      endedAt: null, note: '', baseline: Object.fromEntries(this.lastByReport), samples: [] };
  }
  stop(note = '') {
    if (!this.activeCapture) return null;
    const finished = this.activeCapture; finished.endedAt = new Date().toISOString();
    finished.note = note.trim(); finished.candidates = summarizeCapture(finished);
    this.session.captures.push(finished); this.activeCapture = null; return finished;
  }
  reset() {
    this.session = freshSession(); this.activeCapture = null; this.recordingFull = false;
    this.displayRows = []; this.lastByReport.clear();
  }
  import(value) {
    const parsed = normalizeImport(value);
    this.session = parsed; this.activeCapture = null;
    this.recordingFull = parsed.reports.length >= MAX_REPORTS;
    this.displayRows = parsed.reports.slice(-100).reverse(); this.lastByReport.clear();
    for (const report of parsed.reports) this.lastByReport.set(report.reportId, report.bytes);
  }
}
