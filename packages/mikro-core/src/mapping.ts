import type { ControlId, InputEvent } from './protocol.js';
import { parseProfile, type Profile, type Mode, type Binding, type PadVelocityCurve } from './profile.js';
export type MidiMessage = number[];
export interface MappingResult { messages: MidiMessage[]; modeChanged: boolean }
const clamp = (n: number) => Math.max(0, Math.min(127, Math.round(n)));
// Software response curves; these are not calibrated NI factory curves.
const VELOCITY_EXPONENT: Record<PadVelocityCurve, number> = {
  'soft-3': 0.5, 'soft-2': 0.65, 'soft-1': 0.8, linear: 1, 'hard-1': 1.25, 'hard-2': 1.5, 'hard-3': 2
};
export function applyPadVelocityCurve(velocity: number, curve: PadVelocityCurve = 'linear'): number {
  const input = clamp(velocity);
  if (input === 0) return 0;
  return Math.max(1, Math.round(127 * (input / 127) ** VELOCITY_EXPONENT[curve]));
}
/** Pure synchronous engine. Caller owns I/O, persistence, timing and disconnection. */
export class MappingEngine {
  profile: Profile;
  activeModeId: string;
  private fixedVelocityEnabled = false;
  private held = new Set<ControlId>();
  private notes = new Map<string, { channel: number; note: number }>();
  private releases = new Map<ControlId, MidiMessage>();
  private pressure = new Map<ControlId, { target: string; message: MidiMessage; reset: MidiMessage }>();
  private pressureSuppressed = new Set<ControlId>();
  private values = new Map<string, number>();
  private stripRaw = new Map<string, number>();
  private stripRemainder = new Map<string, number>();
  constructor(profile: Profile) { this.profile = parseProfile(profile); this.activeModeId = this.profile.initialModeId; }
  get mode(): Mode { return this.profile.modes.find(m => m.id === this.activeModeId)!; }
  /** Local mapping state, independent of physical hold and external MIDI feedback. */
  isButtonLightOn(id: ControlId): boolean {
    const binding = this.mode.bindings[id];
    if (binding?.type === 'fixed-velocity') return this.fixedVelocityEnabled;
    if (binding?.type === 'note' && binding.mode === 'toggle') return this.notes.has(id);
    if (binding?.type === 'cc' && binding.style === 'toggle' ||
      binding?.type === 'button-value' && binding.mode === 'toggle') {
      return this.values.get(`${this.activeModeId}:${id}`) === binding.on;
    }
    return this.held.has(id);
  }
  reconfigure(profile: Profile): MidiMessage[] {
    const next = parseProfile(profile);
    const messages = this.flush();
    this.profile = next;
    if (!next.modes.some(m => m.id === this.activeModeId)) this.activeModeId = next.initialModeId;
    this.values.clear();
    this.stripRaw.clear(); this.stripRemainder.clear();
    return messages;
  }
  flush(): MidiMessage[] {
    this.fixedVelocityEnabled = false;
    const unique = new Map<string, MidiMessage>();
    for (const n of this.notes.values()) unique.set(`${n.channel}:${n.note}`, [0x80 + n.channel - 1, n.note, 0]);
    this.notes.clear();
    const pressureResets = new Map<string, MidiMessage>();
    for (const state of this.pressure.values()) pressureResets.set(state.target, state.reset);
    const result = [...unique.values(), ...this.releases.values(), ...pressureResets.values()];
    this.releases.clear();
    this.pressure.clear();
    this.stripRaw.clear(); this.stripRemainder.clear();
    for (const id of this.held) if (id.startsWith('PAD_')) this.pressureSuppressed.add(id);
    return result;
  }
  reset(): MidiMessage[] { const messages = this.flush(); this.held.clear(); this.pressureSuppressed.clear(); return messages; }
  switchMode(id: string): MappingResult {
    if (!this.profile.modes.some(m => m.id === id)) throw new Error('Unknown mode');
    if (id === this.activeModeId) return { messages: [], modeChanged: false };
    const messages = this.flush();
    this.activeModeId = id;
    return { messages, modeChanged: true };
  }
  process(event: InputEvent): MappingResult {
    const result: MappingResult = { messages: [], modeChanged: false };
    const id = event.controlId;
    let down: boolean | undefined;
    if (event.kind === 'button') down = event.pressed;
    if (event.kind === 'pad') {
      if (event.event === 'aftertouch') {
        result.messages.push(...this.processPressure(event));
        return result;
      }
      down = event.event === 'note-on' || event.event === 'press-on';
      // A zero-filled first triplet must not create a phantom MIDI note.
      if (down && event.raw === 0) return result;
    }
    if (down === false) {
      const wasHeld = this.held.has(id);
      if (event.kind === 'pad') result.messages.push(...this.endPressure(id));
      this.held.delete(id);
      this.pressureSuppressed.delete(id);
      const binding = this.mode.bindings[id];
      const note = this.notes.get(id);
      if (note && !(binding?.type === 'note' && binding.mode === 'toggle')) {
        this.notes.delete(id);
        if (![...this.notes.values()].some(n => n.channel === note.channel && n.note === note.note)) result.messages.push([0x80 + note.channel - 1, note.note, 0]);
      }
      const release = this.releases.get(id);
      if (release) { result.messages.push(release); this.releases.delete(id); }
      if (wasHeld && binding?.type === 'note' && binding.mode === 'toggle' && binding.actionOn === 'up') {
        result.messages.push(...this.toggleNote(binding, id, event));
      }
      if (wasHeld && binding?.type === 'cc' && (binding.style === 'toggle' || binding.style === 'trigger' || binding.style === 'inc') && binding.actionOn === 'up') {
        result.messages.push(...this.buttonCc(binding, id));
      }
      if (wasHeld && binding?.type === 'button-value' && binding.mode !== 'gate' && binding.actionOn === 'up') {
        result.messages.push(...this.buttonValue(binding, id));
      }
      return result;
    }
    if (down === true) {
      if (this.held.has(id)) return result;
      this.held.add(id);
    }
    const binding = this.mode.bindings[id];
    if (!binding || binding.type === 'none') return result;
    if (binding.type === 'mode') return down ? this.switchMode(binding.modeId) : result;
    if (binding.type === 'system') {
      if (down) result.messages.push(this.systemMessage(binding));
      return result;
    }
    if (binding.type === 'fixed-velocity') {
      if (down) this.fixedVelocityEnabled = !this.fixedVelocityEnabled;
      return result;
    }
    const ch = binding.channel - 1;
    if (binding.type === 'note' && down && binding.mode === 'toggle') {
      if (binding.actionOn !== 'up') result.messages.push(...this.toggleNote(binding, id, event));
    } else if (binding.type === 'note' && down) {
      const alreadyPlaying = [...this.notes.values()].some(n => n.channel === binding.channel && n.note === binding.note);
      const velocity = this.noteVelocity(binding, event);
      this.notes.set(id, { channel: binding.channel, note: binding.note });
      if (!alreadyPlaying) result.messages.push([0x90 + ch, binding.note, Math.max(1, velocity)]);
    } else if (binding.type === 'button-value' && down) {
      if (binding.mode === 'gate') {
        result.messages.push(this.buttonValueMessage(binding, binding.on));
        this.releases.set(id, this.buttonValueMessage(binding, binding.off));
      } else if (binding.actionOn !== 'up') result.messages.push(...this.buttonValue(binding, id));
    } else if (binding.type === 'program' && down) result.messages.push([0xc0 + ch, binding.program]);
    else if (binding.type === 'value' && down) {
      const make = (value: number) => binding.output === 'poly-pressure' ? [0xa0 + ch, binding.note!, value]
        : binding.output === 'channel-pressure' ? [0xd0 + ch, value]
        : [0xe0 + ch, value & 0x7f, value >> 7];
      result.messages.push(make(binding.on));
      this.releases.set(id, make(binding.off));
    } else if (binding.type === 'strip-position' && event.kind === 'strip' && event.raw > 0) {
      const amount = Math.max(0, Math.min(1, (event.raw - 1) / 199));
      const value = Math.round(binding.from + amount * (binding.to - binding.from));
      const message = binding.output === 'poly-pressure' ? [0xa0 + ch, binding.note!, value]
        : binding.output === 'channel-pressure' ? [0xd0 + ch, value]
        : binding.output === 'program' ? [0xc0 + ch, value]
        : [0xe0 + ch, value & 0x7f, value >> 7];
      const key = `${this.activeModeId}:${id}`;
      if (this.values.get(key) !== value) result.messages.push(message);
      this.values.set(key, value);
    }
    else if (binding.type === 'cc') {
      const key = `${this.activeModeId}:${id}`;
      let value: number | undefined;
      if (binding.style === 'momentary' && down) {
        value = binding.on; this.releases.set(id, [0xb0 + ch, binding.controller, binding.off]);
      } else if ((binding.style === 'toggle' || binding.style === 'trigger' || binding.style === 'inc') && down && binding.actionOn !== 'up') {
        result.messages.push(...this.buttonCc(binding, id));
        return result;
      } else if (binding.style === 'encoder' && event.kind === 'encoder') {
        let delta = event.delta;
        if (binding.modulus > 0) {
          const m = binding.modulus;
          delta = ((delta % m) + m + m / 2) % m - m / 2;
        }
        value = clamp((this.values.get(key) ?? binding.initial) + delta * binding.step);
      } else if (binding.style === 'strip' && event.kind === 'strip') {
        if (event.raw === 0) { this.stripRaw.delete(key); this.stripRemainder.delete(key); return result; }
        const raw = Math.max(binding.rawMin, Math.min(binding.rawMax, event.raw));
        if (binding.mode === 'relative' || binding.mode === 'relative-offset') {
          const prior = this.stripRaw.get(key);
          this.stripRaw.set(key, raw);
          if (prior === undefined) return result;
          const movement = (raw - prior) * (binding.step ?? 1) * (binding.resolution ?? 25) / (binding.rawMax - binding.rawMin);
          const remainder = this.stripRemainder.get(key) ?? 0;
          const amount = movement + (Math.sign(remainder) === Math.sign(movement) ? remainder : 0);
          const count = Math.trunc(amount);
          this.stripRemainder.set(key, amount - count);
          const data = binding.mode === 'relative-offset' ? count > 0 ? 65 : 63 : count > 0 ? 1 : 127;
          for (let i = 0; i < Math.min(Math.abs(count), 64); i++) result.messages.push([0xb0 + ch, binding.controller, data]);
          return result;
        }
        // Zero is release; absolute Position CC is emitted only while touched.
        value = clamp((binding.from ?? 0) + (raw - binding.rawMin) * ((binding.to ?? 127) - (binding.from ?? 0)) / (binding.rawMax - binding.rawMin));
      }
      if (value !== undefined) {
        if (binding.style === 'momentary' || this.values.get(key) !== value) result.messages.push([0xb0 + ch, binding.controller, value]);
        this.values.set(key, value);
      }
    }
    return result;
  }
  private buttonCc(binding: Extract<Binding, { type: 'cc' }>, id: ControlId): MidiMessage[] {
    if (binding.style !== 'toggle' && binding.style !== 'trigger' && binding.style !== 'inc') return [];
    const key = `${this.activeModeId}:${id}`;
    const previous = this.values.get(key);
    let value: number;
    if (binding.style === 'toggle') value = previous === binding.on ? binding.off : binding.on;
    else if (binding.style === 'trigger') value = binding.value;
    else if (binding.style === 'inc') {
      value = previous === undefined ? binding.step > 0 ? binding.from : binding.to : previous + binding.step;
      if (value > binding.to) value = binding.wrap ? binding.from : binding.to;
      if (value < binding.from) value = binding.wrap ? binding.to : binding.from;
    } else return [];
    this.values.set(key, value);
    return [[0xb0 + binding.channel - 1, binding.controller, value]];
  }
  private noteVelocity(binding: Extract<Binding, { type: 'note' }>, event: InputEvent): number {
    if (event.kind !== 'pad') return 127;
    const fixed = this.mode.bindings.FIXED_VEL;
    if (this.fixedVelocityEnabled && fixed?.type === 'fixed-velocity') return fixed.velocity;
    if (binding.velocity !== 'pad') return binding.velocity;
    const curved = applyPadVelocityCurve(event.velocity, this.profile.padVelocityCurve);
    const min = binding.velocityMin ?? 0, max = binding.velocityMax ?? 127;
    // Note On velocity zero means Note Off. Keep actual hits at least 1.
    return Math.max(1, Math.round(min + curved / 127 * (max - min)));
  }
  private toggleNote(binding: Extract<Binding, { type: 'note' }>, id: ControlId, event: InputEvent): MidiMessage[] {
    const active = this.notes.get(id);
    if (active) {
      this.notes.delete(id);
      return [...this.notes.values()].some(n => n.channel === active.channel && n.note === active.note)
        ? [] : [[0x80 + active.channel - 1, active.note, 0]];
    }
    const shared = [...this.notes.values()].some(n => n.channel === binding.channel && n.note === binding.note);
    const velocity = this.noteVelocity(binding, event);
    this.notes.set(id, { channel: binding.channel, note: binding.note });
    return shared ? [] : [[0x90 + binding.channel - 1, binding.note, Math.max(1, velocity)]];
  }
  private systemMessage(binding: Extract<Binding, { type: 'system' }>): MidiMessage {
    return binding.command === 'song-position'
      ? [0xf2, binding.position! & 0x7f, binding.position! >> 7]
      : [{ start: 0xfa, stop: 0xfc, continue: 0xfb }[binding.command]];
  }
  private buttonValueMessage(binding: Extract<Binding, { type: 'button-value' }>, value: number): MidiMessage {
    const ch = binding.channel - 1;
    if (binding.output === 'poly-pressure') return [0xa0 + ch, binding.note!, value];
    if (binding.output === 'channel-pressure') return [0xd0 + ch, value];
    if (binding.output === 'program') return [0xc0 + ch, value];
    return [0xe0 + ch, value & 0x7f, value >> 7];
  }
  private buttonValue(binding: Extract<Binding, { type: 'button-value' }>, id: ControlId): MidiMessage[] {
    if (binding.mode === 'gate') return [];
    const key = `${this.activeModeId}:${id}`;
    const previous = this.values.get(key);
    let value: number;
    if (binding.mode === 'toggle') value = previous === binding.on ? binding.off : binding.on;
    else if (binding.mode === 'trigger') value = binding.value;
    else if (binding.mode === 'inc') {
      value = previous === undefined ? binding.step > 0 ? binding.from : binding.to : previous + binding.step;
      if (value > binding.to) value = binding.wrap ? binding.from : binding.to;
      if (value < binding.from) value = binding.wrap ? binding.to : binding.from;
    } else return [];
    this.values.set(key, value);
    return [this.buttonValueMessage(binding, value)];
  }
  private endPressure(id: ControlId): MidiMessage[] {
    const messages: MidiMessage[] = [];
    const noteKey = `${id}:press`, note = this.notes.get(noteKey);
    if (note) {
      this.notes.delete(noteKey);
      if (![...this.notes.values()].some(n => n.channel === note.channel && n.note === note.note)) messages.push([0x80 + note.channel - 1, note.note, 0]);
    }
    const state = this.pressure.get(id);
    if (state) {
      this.pressure.delete(id);
      const other = [...this.pressure.values()].filter(p => p.target === state.target).at(-1);
      messages.push(other?.message ?? state.reset);
    }
    return messages;
  }
  private processPressure(event: Extract<InputEvent, { kind: 'pad' }>): MidiMessage[] {
    const binding = this.mode.pressureBindings?.[event.controlId];
    if (!binding || binding.type === 'off') return [];
    if (event.raw === 0) return this.endPressure(event.controlId);
    if (!this.held.has(event.controlId) || this.pressureSuppressed.has(event.controlId)) return [];
    const status = binding.channel - 1;
    if (binding.type === 'note') {
      const key = `${event.controlId}:press`, existing = this.notes.get(key);
      const percent = event.raw * 100 / 4095;
      if (existing && percent <= binding.offThreshold) return this.endPressure(event.controlId);
      if (!existing && percent >= binding.onThreshold) {
        const alreadyPlaying = [...this.notes.values()].some(n => n.channel === binding.channel && n.note === binding.note);
        this.notes.set(key, { channel: binding.channel, note: binding.note });
        return alreadyPlaying ? [] : [[0x90 + status, binding.note, binding.velocity]];
      }
      return [];
    }
    const amount = Math.max(0, Math.min(1, event.raw / 4095));
    const scaled = binding.from + amount * (binding.to - binding.from);
    const value = Math.round(scaled);
    let target: string, message: MidiMessage, reset: MidiMessage;
    if (binding.type === 'cc') {
      target = `cc:${status}:${binding.controller}`;
      message = [0xb0 + status, binding.controller, value]; reset = [0xb0 + status, binding.controller, 0];
    } else if (binding.type === 'poly-pressure') {
      target = `poly:${status}:${binding.note}`;
      message = [0xa0 + status, binding.note, value]; reset = [0xa0 + status, binding.note, 0];
    } else if (binding.type === 'channel-pressure') {
      target = `channel:${status}`;
      message = [0xd0 + status, value]; reset = [0xd0 + status, 0];
    } else {
      target = `bend:${status}`;
      const bend = Math.max(0, Math.min(16383, Math.round((scaled + 100) * 16383 / 200)));
      message = [0xe0 + status, bend & 0x7f, bend >> 7]; reset = [0xe0 + status, 0, 64];
    }
    const prior = this.pressure.get(event.controlId);
    if (prior?.target === target && prior.message.every((byte, i) => byte === message[i])) return [];
    this.pressure.delete(event.controlId);
    this.pressure.set(event.controlId, { target, message, reset });
    return [message];
  }
}
