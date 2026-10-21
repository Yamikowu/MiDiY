import { TranslatorRuntime } from '../src/runtime/translator-runtime.ts';
import { MikroDriver } from '../src/devices/mikro-mk3/driver.ts';
import type { ControllerInput, RawReport, DeviceInfo, MidiOutput } from '../src/runtime/contracts.ts';
import { createDefaultProfile, type Profile, type MidiMessage, type OutputReport } from '@midiy/mikro-core';

export class FakeInput implements ControllerInput {
  info: DeviceInfo | null = null;
  receive: (report: RawReport) => void = () => {};
  lost = () => {};
  sent: OutputReport[] = [];
  closes = 0;
  bind(receive: (report: RawReport) => void, lost: () => void) { this.receive = receive; this.lost = lost; }
  async connect() { return this.info = { vendorId: 0x17cc, productId: 0x1700, productName: 'Mikro', outputReportIds: [0x80] }; }
  async send(report: OutputReport) { this.sent.push(structuredClone(report)); }
  async disconnect(report?: OutputReport) { if (report) await this.send(report); this.closes++; this.info = null; }
  cancelPending() {}
  report(reportId: number, data: number[]) { this.receive({ reportId, data: Uint8Array.from(data) }); }
  unplug() { this.info = null; this.lost(); }
}
export class FakeMidi implements MidiOutput {
  status = { enabled: false, ports: [{ id: 'a', name: 'a' }, { id: 'b', name: 'b' }], output: null as { id: string; name: string } | null };
  sent: { port: string; message: MidiMessage }[] = [];
  change = () => {};
  lost: () => MidiMessage[] = () => [];
  bind(change: () => void, lost: () => MidiMessage[]) { this.change = change; this.lost = lost; }
  async enable() { this.status.enabled = true; this.change(); }
  async select(id: string, final: MidiMessage[]) {
    this.send(final); this.status.output = id ? { id, name: id } : null; this.change();
  }
  send(messages: readonly MidiMessage[]) {
    if (this.status.output) for (const message of messages) this.sent.push({ port: this.status.output.id, message: [...message] });
  }
}
export function fixture(profile: Profile = createDefaultProfile()) {
  const input = new FakeInput(), midi = new FakeMidi();
  const runtime = new TranslatorRuntime(input, midi, new MikroDriver(), profile);
  return { input, midi, runtime };
}
export const tick = () => new Promise<void>(resolve => setImmediate(resolve));
