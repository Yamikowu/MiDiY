import { VENDOR_ID, PRODUCT_ID, type OutputReport } from '@midiy/mikro-core';

export function outputReports(collections: readonly HIDCollectionInfo[]): HIDReportInfo[] {
  return collections.flatMap(c => [...(c.outputReports ?? []), ...outputReports(c.children ?? [])]);
}
export class WebHidAdapter {
  device: HIDDevice | null = null;
  private writes: Promise<void> = Promise.resolve();
  private generation = 0;
  private closing: Promise<void> | null = null;
  constructor(private readonly receive: (event: HIDInputReportEvent) => void,
    private readonly lost: () => void, private readonly api: HID | undefined = navigator.hid) {
    api?.addEventListener('disconnect', event => {
      if (event.device !== this.device) return;
      this.device.removeEventListener('inputreport', this.receive);
      this.device = null; this.generation++; this.lost();
    });
  }
  async connect(): Promise<HIDDevice | null> {
    if (this.closing) await this.closing;
    if (!this.api) throw new Error('此瀏覽器不支援 WebHID');
    if (this.device?.opened) return this.device;
    let devices = (await this.api.getDevices()).filter(d => d.vendorId === VENDOR_ID && d.productId === PRODUCT_ID);
    if (!devices.length) devices = await this.api.requestDevice({ filters: [{ vendorId: VENDOR_ID, productId: PRODUCT_ID }] });
    if (!devices.length) return null;
    const device = devices.find(d => outputReports(d.collections).some(r => r.reportId === 0x80)) ?? devices[0];
    if (!device.opened) await device.open();
    this.generation++; this.device = device;
    device.addEventListener('inputreport', this.receive);
    return device;
  }
  send(report: OutputReport): Promise<void> {
    if (this.closing) return Promise.reject(new Error('HID 連線正在關閉'));
    return this.enqueue(report);
  }
  private enqueue(report: OutputReport): Promise<void> {
    const device = this.device, generation = this.generation;
    if (!device?.opened) return Promise.reject(new Error('HID 裝置尚未連線'));
    const descriptor = outputReports(device.collections).find(r => r.reportId === report.reportId);
    if (!descriptor) return Promise.reject(new Error(`裝置未宣告 Output Report 0x${report.reportId.toString(16)}`));
    const bits = (descriptor.items ?? []).reduce((sum, item) => sum + (item.reportSize ?? 0) * (item.reportCount ?? 0), 0);
    if (Math.ceil(bits / 8) !== report.data.length) return Promise.reject(new Error(`Output Report 長度不符：descriptor ${Math.ceil(bits / 8)} / payload ${report.data.length}`));
    const bytes = Uint8Array.from(report.data);
    const task = this.writes.catch(() => {}).then(async () => {
      if (this.device !== device || generation !== this.generation || !device.opened) throw new Error('HID 連線已變更，取消舊輸出');
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
    device.removeEventListener('inputreport', this.receive);
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
