import type { OutputReport, MidiMessage } from '@midiy/mikro-core';

/** ID is separate from payload; no HIDDevice or browser event crosses this boundary. */
export interface RawReport { reportId: number; data: Uint8Array }
export interface DeviceInfo {
  vendorId: number; productId: number; productName: string; outputReportIds: number[];
}
export interface InputSelection {
  vendorId: number; productId: number; preferredOutputReportId: number;
}
export interface ControllerInput {
  readonly info: DeviceInfo | null;
  bind(receive: (report: RawReport) => void, lost: () => void): void;
  connect(): Promise<DeviceInfo | null>;
  send(report: OutputReport): Promise<void>;
  disconnect(finalReport?: OutputReport): Promise<void>;
  cancelPending(): void;
}
export interface MidiPort { id: string; name: string }
export interface MidiStatus { enabled: boolean; ports: MidiPort[]; output: MidiPort | null }
export interface MidiOutput {
  readonly status: MidiStatus;
  bind(change: () => void, lost: () => MidiMessage[]): void;
  enable(): Promise<void>;
  select(id: string, finalMessages: MidiMessage[]): Promise<void>;
  send(messages: readonly MidiMessage[]): void;
}
