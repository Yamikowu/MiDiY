export const hex = value => value.toString(16).toUpperCase().padStart(2, '0');
export const reportHex = bytes => bytes.map(hex).join(' ');

export function changedBytes(before = [], after = []) {
  const changes = [];
  for (let offset = 0; offset < Math.max(before.length, after.length); offset++) {
    if (before[offset] !== after[offset]) changes.push({ offset, before: before[offset] ?? null, after: after[offset] ?? null });
  }
  return changes;
}

export function summarizeCapture(capture) {
  const byKey = new Map();
  const samples = capture.samples || [];
  const lastByReport = new Map(Object.entries(capture.baseline || {}).map(([id, bytes]) => [Number(id), bytes]));
  for (const sample of samples) {
    const previous = lastByReport.get(sample.reportId) || [];
    for (const change of changedBytes(previous, sample.bytes)) {
      const key = `${sample.reportId}:${change.offset}`;
      const record = byKey.get(key) || { reportId: sample.reportId, offset: change.offset, count: 0, values: new Set(), min: 255, max: 0 };
      record.count++;
      if (change.after !== null) {
        record.values.add(change.after);
        record.min = Math.min(record.min, change.after);
        record.max = Math.max(record.max, change.after);
      }
      byKey.set(key, record);
    }
    lastByReport.set(sample.reportId, sample.bytes);
  }
  return [...byKey.values()].sort((a, b) => b.count - a.count || a.reportId - b.reportId || a.offset - b.offset).map(record => ({
    reportId: record.reportId,
    offset: record.offset,
    count: record.count,
    values: [...record.values].sort((a, b) => a - b),
    range: record.values.size ? [record.min, record.max] : null
  }));
}

export function normalizeImport(value) {
  if (!value || !['midiy-session-v1', 'mpa-session-v1'].includes(value.schema) || !Array.isArray(value.captures) || !Array.isArray(value.reports)) throw new Error('不是有效的 MiDiY v1 工作階段檔案。');
  if (value.reports.length > 100000) throw new Error('工作階段超過 100,000 筆報告上限。');
  const validReport = report => Number.isInteger(report?.reportId) && report.reportId >= 0 && report.reportId <= 255 && Array.isArray(report.bytes) && report.bytes.every(byte => Number.isInteger(byte) && byte >= 0 && byte <= 255);
  for (const report of value.reports) {
    if (!validReport(report)) throw new Error('工作階段含有無效 HID 報告。');
  }
  for (const capture of value.captures) {
    if (!capture || typeof capture.id !== 'string' || typeof capture.controlId !== 'string' || !Array.isArray(capture.samples) || !capture.samples.every(validReport) || !capture.baseline || typeof capture.baseline !== 'object' || Object.values(capture.baseline).some(bytes => !Array.isArray(bytes) || bytes.some(byte => !Number.isInteger(byte) || byte < 0 || byte > 255))) throw new Error('工作階段含有無效擷取記錄。');
    capture.candidates = summarizeCapture(capture);
  }
  return { ...value, schema: 'midiy-session-v1' };
}
