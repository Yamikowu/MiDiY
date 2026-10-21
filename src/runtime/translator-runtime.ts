import { toIssue, type Issue } from './issues';
import { MappingEngine, BUTTON_IDS, createDefaultProfile, parseProfile, type Profile, type InputEvent,
  type MidiMessage, type OutputReport, type PadVelocityCurve } from '@midiy/mikro-core';
import type { ControllerInput, MidiOutput, DeviceInfo, MidiStatus, RawReport } from './contracts';
import type { MikroDriver, PerformanceState } from '../devices/mikro-mk3/driver';

export interface RuntimeSnapshot {
  device: DeviceInfo | null; midi: MidiStatus; activeModeId: string;
  activePads: string[]; pressedButtons: string[]; ledEnabled: boolean;
  lightReport: OutputReport; ledStatus: string; ledIssue: Issue | null; midiCount: number;
}
export type RuntimeEvent =
  | { type: 'state'; state: RuntimeSnapshot }
  | { type: 'raw'; report: RawReport }
  | { type: 'decoded'; event: InputEvent }
  | { type: 'mode' }
  | { type: 'midi'; messages: MidiMessage[]; delivered: boolean }
  | { type: 'diagnostic'; message: string }
  | ({ type: 'error' } & Issue)
  | { type: 'disconnected' };

type RuntimeListener = (event: RuntimeEvent) => void | Promise<void>;

/** Single-device runtime. No browser globals, UI, clock or persistence ownership. */
export class TranslatorRuntime {
  private engine: MappingEngine;
  private profile: Profile;
  private performance: PerformanceState = { activePads: new Set(), pressedButtons: new Set(), stripRaw: 0 };
  private listeners = new Set<RuntimeListener>();
  private ledEnabled = false;
  private pendingLed: OutputReport | null = null;
  private writingLed = false;
  private ledGeneration = 0;
  private closing: Promise<void> | null = null;
  private connecting: Promise<DeviceInfo | null> | null = null;
  private ledStatus = '';
  private ledIssue: Issue | null = null;
  private midiCount = 0;
  constructor(private readonly input: ControllerInput, private readonly output: MidiOutput,
    private readonly driver: MikroDriver, profile: Profile = createDefaultProfile()) {
    this.profile = parseProfile(profile); this.engine = new MappingEngine(this.profile);
    input.bind(report => this.receive(report), () => {
      this.stopLights(); this.resetPerformance(); this.publish(); this.emit({ type: 'disconnected' });
    });
    output.bind(() => this.publish(), () => {
      const messages = this.engine.flush();
      this.refreshLights();
      this.emit({ type: 'error', code: 'midi_output_lost', message: 'MIDI 輸出埠已離線；已清除演奏狀態，接收端若仍有聲音請使用其 Panic。' });
      return messages;
    });
  }
  subscribe(listener: RuntimeListener): () => void {
    this.listeners.add(listener); return () => { this.listeners.delete(listener); };
  }
  private emit(event: RuntimeEvent) {
    // Research/rendering failures must not interrupt performance or mutate another subscriber's data.
    for (const listener of this.listeners) {
      try {
        const pending = listener(structuredClone(event));
        if (pending) void pending.catch(() => {});
      } catch { /* Subscriber owns its failure. */ }
    }
  }
  get activeModeId() { return this.engine.activeModeId; }
  get snapshot(): RuntimeSnapshot {
    const mode = this.profile.modes.find(m => m.id === this.engine.activeModeId)!;
    return structuredClone({ device: this.input.info, midi: this.output.status,
      activeModeId: this.engine.activeModeId, activePads: [...this.performance.activePads],
      pressedButtons: [...this.performance.pressedButtons], ledEnabled: this.ledEnabled,
      lightReport: this.driver.lights(mode, { ...this.performance,
        litButtons: new Set(BUTTON_IDS.filter(id => this.engine.isButtonLightOn(id))) }),
      ledStatus: this.ledStatus, ledIssue: this.ledIssue, midiCount: this.midiCount });
  }
  private publish() { this.emit({ type: 'state', state: this.snapshot }); }
  private dispatch(messages: MidiMessage[]) {
    let delivered = false;
    try { this.output.send(messages); delivered = Boolean(this.output.status.output); }
    catch (error) { this.emit({ type: 'error', code: 'midi_send_failed', detail: toIssue(error), message: `MIDI 發送失敗：${String(error)}` }); }
    if (delivered) this.midiCount += messages.length;
    if (messages.length) this.emit({ type: 'midi', messages, delivered });
  }
  private receive(report: RawReport) {
    if (this.closing) return;
    const decoded = this.driver.decode(report);
    let lightsChanged = false;
    for (const event of decoded.events) {
      if (event.kind === 'pad') {
        const wasActive = this.performance.activePads.has(event.controlId);
        if ((event.event === 'note-on' || event.event === 'press-on') && event.raw > 0) this.performance.activePads.add(event.controlId);
        if (event.event === 'note-off' || event.event === 'press-off') this.performance.activePads.delete(event.controlId);
        lightsChanged ||= wasActive !== this.performance.activePads.has(event.controlId);
      } else if (event.kind === 'button') {
        lightsChanged = true;
        if (event.pressed) this.performance.pressedButtons.add(event.controlId);
        else this.performance.pressedButtons.delete(event.controlId);
      } else if (event.kind === 'strip') {
        this.performance.stripRaw = Math.max(0, Math.min(200, event.raw)); lightsChanged = true;
      }
      const result = this.engine.process(event); this.dispatch(result.messages);
      if (result.modeChanged) { lightsChanged = true; this.performance.activePads.clear(); this.emit({ type: 'mode' }); }
      this.emit({ type: 'decoded', event });
    }
    if (lightsChanged) this.refreshLights();
    if (decoded.events.length) this.publish();
    for (const message of decoded.diagnostics) this.emit({ type: 'diagnostic', message });
    this.emit({ type: 'raw', report });
  }
  applyProfile(profile: Profile, restart = false) {
    const next = parseProfile(profile);
    if (restart) {
      this.resetPerformance(); this.engine = new MappingEngine(next);
    } else { this.dispatch(this.engine.reconfigure(next)); this.performance.activePads.clear(); }
    this.profile = next; this.refreshLights(); this.publish();
  }
  setVelocityCurve(curve: PadVelocityCurve) {
    const next = parseProfile({ ...this.profile, padVelocityCurve: curve });
    this.profile = next; this.engine.profile.padVelocityCurve = curve;
  }
  updateFeedback(profile: Profile) {
    const next = parseProfile(profile);
    // This operation only updates feedback settings, preserving held MIDI ownership.
    for (const mode of this.profile.modes) {
      const source = next.modes.find(m => m.id === mode.id)!;
      mode.buttonLight = source.buttonLight; mode.toggleButtonLight = source.toggleButtonLight; mode.padOnBrightness = source.padOnBrightness; mode.padOffBrightness = source.padOffBrightness;
    }
    this.refreshLights(); this.publish();
  }
  switchMode(id: string) {
    this.dispatch(this.engine.switchMode(id).messages); this.performance.activePads.clear();
    this.refreshLights(); this.publish();
  }
  enableMidi() { return this.output.enable(); }
  async selectOutput(id: string) {
    const messages = this.engine.flush(); this.refreshLights();
    await this.output.select(id, messages); this.publish();
  }
  connect(): Promise<DeviceInfo | null> {
    if (this.connecting) return this.connecting;
    this.connecting = (async () => {
      if (this.closing) await this.closing;
      if (this.input.info) return this.input.info;
      this.resetPerformance();
      const device = await this.input.connect(); this.ledStatus = ''; this.ledIssue = null; this.publish(); return device;
    })().finally(() => { this.connecting = null; });
    return this.connecting;
  }
  private stopLights() {
    this.ledEnabled = false; this.ledGeneration++; this.pendingLed = null; this.input.cancelPending();
  }
  setLedEnabled(enabled: boolean) {
    const supported = this.input.info?.outputReportIds.includes(this.driver.definition.input.preferredOutputReportId);
    const wasEnabled = this.ledEnabled;
    this.stopLights(); this.ledStatus = ''; this.ledIssue = null;
    this.ledEnabled = enabled && Boolean(supported) && !this.closing;
    if (this.ledEnabled) this.refreshLights();
    else if (wasEnabled && supported && this.input.info && !this.closing) this.queueReport(this.driver.allOff());
    this.publish();
  }
  private refreshLights() {
    if (this.ledEnabled) this.queueReport(this.snapshot.lightReport);
  }
  private queueReport(report: OutputReport) {
    if (!this.input.info || this.closing) return;
    this.pendingLed = report;
    if (!this.writingLed) void this.pumpLights();
  }
  private async pumpLights() {
    this.writingLed = true;
    while (this.pendingLed) {
      const report = this.pendingLed, generation = this.ledGeneration; this.pendingLed = null;
      try {
        await this.input.send(report);
        if (generation === this.ledGeneration) {
          this.ledStatus = `已送出 0x${report.reportId.toString(16)} / ${report.data.length} bytes。請確認實體燈光。`;
          this.ledIssue = { code: 'led_sent', message: this.ledStatus, params: { p0: report.reportId.toString(16), p1: report.data.length } };
        }
      } catch (error) {
        if (generation === this.ledGeneration) {
          this.stopLights(); this.ledStatus = `LED 發送失敗：${String(error)}`;
          this.ledIssue = { code: 'led_send_failed', message: this.ledStatus, detail: toIssue(error) };
        }
      }
      this.publish();
    }
    this.writingLed = false;
  }
  private resetPerformance() {
    this.dispatch(this.engine.reset()); this.driver.reset();
    this.performance.activePads.clear(); this.performance.pressedButtons.clear(); this.performance.stripRaw = 0;
  }
  panic() { this.resetPerformance(); this.refreshLights(); this.publish(); }
  disconnect(): Promise<void> {
    if (this.closing) return this.closing;
    const reset = this.ledEnabled ? this.driver.allOff() : undefined;
    this.stopLights(); this.resetPerformance();
    this.closing = (async () => {
      if (this.connecting) await this.connecting;
      await this.input.disconnect(reset);
    })().finally(() => { this.closing = null; this.ledStatus = ''; this.ledIssue = null; this.publish(); });
    this.publish(); return this.closing;
  }
}
