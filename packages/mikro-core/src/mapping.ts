import type { ControlId, InputEvent } from './protocol.js';
import { parseProfile, type Profile, type Mode } from './profile.js';
export type MidiMessage = number[];
export interface MappingResult { messages: MidiMessage[]; modeChanged: boolean }
const clamp = (n: number) => Math.max(0, Math.min(127, Math.round(n)));
/** Pure synchronous engine. Caller owns I/O, persistence, timing and disconnection. */
export class MappingEngine {
  profile: Profile;
  activeModeId: string;
  private held = new Set<ControlId>();
  private notes = new Map<ControlId, { channel: number; note: number }>();
  private releases = new Map<ControlId, MidiMessage>();
  private values = new Map<string, number>();
  constructor(profile: Profile) { this.profile = parseProfile(profile); this.activeModeId = this.profile.initialModeId; }
  get mode(): Mode { return this.profile.modes.find(m => m.id === this.activeModeId)!; }
  reconfigure(profile: Profile): MidiMessage[] {
    const next = parseProfile(profile);
    const messages = this.flush();
    this.profile = next;
    if (!next.modes.some(m => m.id === this.activeModeId)) this.activeModeId = next.initialModeId;
    this.values.clear();
    return messages;
  }
  flush(): MidiMessage[] {
    const unique = new Map<string, MidiMessage>();
    for (const n of this.notes.values()) unique.set(`${n.channel}:${n.note}`, [0x80 + n.channel - 1, n.note, 0]);
    this.notes.clear();
    const result = [...unique.values(), ...this.releases.values()];
    this.releases.clear();
    return result;
  }
  reset(): MidiMessage[] { const messages = this.flush(); this.held.clear(); return messages; }
  switchMode(id: string): MappingResult {
    if (!this.profile.modes.some(m => m.id === id)) throw new Error('Unknown mode');
    if (id === this.activeModeId) return { messages: [], modeChanged: false };
    const messages = this.flush(); this.activeModeId = id;
    return { messages, modeChanged: true };
  }
  process(event: InputEvent): MappingResult {
    const result: MappingResult = { messages: [], modeChanged: false };
    const id = event.controlId;
    let down: boolean | undefined;
    if (event.kind === 'button') down = event.pressed;
    if (event.kind === 'pad') {
      if (event.event === 'aftertouch') return result;
      down = event.event === 'note-on' || event.event === 'press-on';
      // A zero-filled first triplet must not create a phantom MIDI note.
      if (down && event.raw === 0) return result;
    }
    if (down === false) {
      this.held.delete(id);
      const note = this.notes.get(id);
      if (note) {
        this.notes.delete(id);
        if (![...this.notes.values()].some(n => n.channel === note.channel && n.note === note.note)) result.messages.push([0x80 + note.channel - 1, note.note, 0]);
      }
      const release = this.releases.get(id);
      if (release) { result.messages.push(release); this.releases.delete(id); }
      return result;
    }
    if (down === true) {
      if (this.held.has(id)) return result;
      this.held.add(id);
    }
    const binding = this.mode.bindings[id];
    if (!binding || binding.type === 'none') return result;
    if (binding.type === 'mode') return down ? this.switchMode(binding.modeId) : result;
    const ch = binding.channel - 1;
    if (binding.type === 'note' && down) {
      const alreadyPlaying = [...this.notes.values()].some(n => n.channel === binding.channel && n.note === binding.note);
      const velocity = binding.velocity === 'pad' ? event.kind === 'pad' ? event.velocity : 100 : binding.velocity;
      this.notes.set(id, { channel: binding.channel, note: binding.note });
      if (!alreadyPlaying) result.messages.push([0x90 + ch, binding.note, Math.max(1, velocity)]);
    } else if (binding.type === 'program' && down) result.messages.push([0xc0 + ch, binding.program]);
    else if (binding.type === 'cc') {
      const key = `${this.activeModeId}:${id}`;
      let value: number | undefined;
      if (binding.style === 'momentary' && down) {
        value = binding.on; this.releases.set(id, [0xb0 + ch, binding.controller, binding.off]);
      } else if (binding.style === 'toggle' && down) {
        value = this.values.get(key) === binding.on ? binding.off : binding.on;
      } else if (binding.style === 'encoder' && event.kind === 'encoder') {
        let delta = event.delta;
        if (binding.modulus > 0) {
          const m = binding.modulus;
          delta = ((delta % m) + m + m / 2) % m - m / 2;
        }
        value = clamp((this.values.get(key) ?? binding.initial) + delta * binding.step);
      } else if (binding.style === 'strip' && event.kind === 'strip' && event.raw > 0) {
        // Rust ignores zero. It is not treated as a proven touch/release flag.
        value = clamp((event.raw - binding.rawMin) * 127 / (binding.rawMax - binding.rawMin));
      }
      if (value !== undefined) {
        if (binding.style === 'momentary' || this.values.get(key) !== value) result.messages.push([0xb0 + ch, binding.controller, value]);
        this.values.set(key, value);
      }
    }
    return result;
  }
}
