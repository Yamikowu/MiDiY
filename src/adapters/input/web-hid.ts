import { AppError } from '../../runtime/issues';
import type { OutputReport } from '../../runtime/contracts';
import type { RawReport, DeviceInfo, InputSelection, ControllerInput } from '../../runtime/contracts';

export function outputReports(collections: readonly HIDCollectionInfo[]): HIDReportInfo[] {
  return collections.flatMap(c => [...(c.outputReports ?? []), ...outputReports(c.children ?? [])]);
}
export class WebHidAdapter implements ControllerInput {
  device: HIDDevice | null = null;
  private writes: Promise<void> = Promise.resolve();
  private generation = 0;
  private closing: Promise<void> | null = null;
  private receive: (report: RawReport) => void = () => {};
  private lost: () => void = () => {};
  private onInput = (event: HIDInputReportEvent) => this.receive({ reportId: event.reportId,
    data: new Uint8Array(event.data.buffer, event.data.byteOffset, event.data.byteLength).slice() });
  bind(receive: (report: RawReport) => void, lost: () => void) { this.receive = receive; this.lost = lost; }
  get info(): DeviceInfo | null {
    return this.device?.opened ? { vendorId: this.device.vendorId, productId: this.device.productId,
      productName: this.device.productName ?? '', outputReportIds: outputReports(this.device.collections).flatMap(r => r.reportId === undefined ? [] : [r.reportId]) } : null;
  }
  cancelPending(): void { this.generation++; }
  constructor(private readonly selection: InputSelection,
    private readonly api: HID | undefined = typeof navigator === 'undefined' ? undefined : navigator.hid) {
    api?.addEventListener('disconnect', event => {
      if (event.device !== this.device) return;
      this.device.removeEventListener('inputreport', this.onInput);
      this.device = null; this.generation++; this.lost();
    });
  }
  async connect(): Promise<DeviceInfo | null> {
    if (this.closing) await this.closing;
    if (!this.api) throw new AppError('webhid_unsupported', '此瀏覽器不支援 WebHID');
    if (this.device?.opened) return this.info;
    let devices = (await this.api.getDevices()).filter(d => d.vendorId === this.selection.vendorId && d.productId === this.selection.productId);
    if (!devices.length) devices = await this.api.requestDevice({ filters: [{ vendorId: this.selection.vendorId, productId: this.selection.productId }] });
    if (!devices.length) return null;
    const device = devices.find(d => outputReports(d.collections).some(r => r.reportId === this.selection.preferredOutputReportId)) ?? devices[0];
    if (!device.opened) await device.open();
    this.generation++; this.device = device;
    device.addEventListener('inputreport', this.onInput);
    return this.info;
  }
  send(report: OutputReport): Promise<void> {
    if (this.closing) return Promise.reject(new AppError('hid_closing', 'HID 連線正在關閉'));
    return this.enqueue(report);
  }
  private enqueue(report: OutputReport): Promise<void> {
    const device = this.device, generation = this.generation;
    if (!device?.opened) return Promise.reject(new AppError('hid_disconnected', 'HID 裝置尚未連線'));
    const descriptor = outputReports(device.collections).find(r => r.reportId === report.reportId);
    if (!descriptor) return Promise.reject(new AppError('hid_output_unavailable', `裝置未宣告 Output Report 0x${report.reportId.toString(16)}`, { p0: report.reportId.toString(16) }));
    const bits = (descriptor.items ?? []).reduce((sum, item) => sum + (item.reportSize ?? 0) * (item.reportCount ?? 0), 0);
    if (Math.ceil(bits / 8) !== report.data.length) return Promise.reject(new AppError('hid_length_mismatch', `Output Report 長度不符：descriptor ${Math.ceil(bits / 8)} / payload ${report.data.length}`, { p0: Math.ceil(bits / 8), p1: report.data.length }));
    const bytes = Uint8Array.from(report.data);
    const task = this.writes.catch(() => {}).then(async () => {
      if (this.device !== device || generation !== this.generation || !device.opened) throw new AppError('hid_stale_write', 'HID 連線已變更，取消舊輸出');
      await device.sendReport(report.reportId, bytes);
    });
    this.writes = task;
    return task;
  }
  disconnect(finalReport?: OutputReport): Promise<void> {
    if (this.closing) return this.closing;
    const device = this.device;
    if (!device) return Promise.resolve();
    // Cancel queued ordinary writes; an in-flight write must settle before reset.
    this.generation++;
    device.removeEventListener('inputreport', this.onInput);
    const reset = finalReport ? this.enqueue(finalReport) : this.writes.catch(() => {});
    this.closing = (async () => {
      try {
        await reset;
      } finally {
        // Even descriptor validation failure must not close over an active write.
        await this.writes.catch(() => {});
        if (this.device === device) { this.device = null; this.generation++; }
        if (device.opened) await device.close();
      }
    })().finally(() => { this.closing = null; });
    return this.closing;
  }
}
