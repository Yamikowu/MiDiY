import { CONTROL_IDS, PAD_IDS, type ControlId, type PadLight } from './protocol.js';
export type MidiChannel = number; // Human-facing 1–16 throughout profiles.
export type Binding =
  | { type: 'none' }
  | { type: 'note'; channel: MidiChannel; note: number; velocity: number | 'pad' }
  | { type: 'cc'; channel: MidiChannel; controller: number; style: 'momentary' | 'toggle'; on: number; off: number }
  | { type: 'cc'; channel: MidiChannel; controller: number; style: 'encoder'; step: number; initial: number; modulus: number }
  | { type: 'cc'; channel: MidiChannel; controller: number; style: 'strip'; rawMin: number; rawMax: number }
  | { type: 'program'; channel: MidiChannel; program: number }
  | { type: 'mode'; modeId: string };
export interface Mode {
  id: string; name: string; bindings: Partial<Record<ControlId, Binding>>; pads: PadLight[];
}
export interface Profile { schema: 'mpa-profile-v1'; name: string; initialModeId: string; modes: Mode[] }
export function createMode(id: string, name: string): Mode {
  return { id, name, bindings: {}, pads: PAD_IDS.map(() => ({ color: 11, brightness: 'dim' })) };
}
export function createDefaultProfile(): Profile {
  const mode = createMode('default', 'Default');
  PAD_IDS.forEach((id, i) => { mode.bindings[id] = { type: 'note', channel: 1, note: 36 + i, velocity: 'pad' }; });
  return { schema: 'mpa-profile-v1', name: 'Mikro MIDI', initialModeId: mode.id, modes: [mode] };
}
const byte = (n: unknown): n is number => Number.isInteger(n) && Number(n) >= 0 && Number(n) <= 127;
const channel = (n: unknown) => Number.isInteger(n) && Number(n) >= 1 && Number(n) <= 16;
/** Validate imported data before it can generate MIDI or device output. Returns a detached copy. */
export function parseProfile(value: unknown): Profile {
  const fail = (): never => { throw new Error('無效的 mpa-profile-v1 設定檔'); };
  if (!value || typeof value !== 'object') return fail();
  const p = value as Profile;
  if (p.schema !== 'mpa-profile-v1' || typeof p.name !== 'string' || !p.name.trim() || !Array.isArray(p.modes) || !p.modes.length || p.modes.length > 64) return fail();
  const ids = p.modes.map(m => m?.id);
  if (new Set(ids).size !== ids.length || !ids.includes(p.initialModeId)) return fail();
  for (const m of p.modes) {
    if (!m || typeof m.id !== 'string' || !m.id || typeof m.name !== 'string' || !m.name.trim() || !Array.isArray(m.pads) || m.pads.length !== 16 || !m.bindings || typeof m.bindings !== 'object' || Array.isArray(m.bindings)) return fail();
    for (const pad of m.pads) {
      if (!pad || !Number.isInteger(pad.color) || pad.color < 0 || pad.color > 17 || !['off', 'dim', 'normal', 'bright'].includes(pad.brightness)) return fail();
    }
    for (const [control, b] of Object.entries(m.bindings)) {
      if (!CONTROL_IDS.includes(control as ControlId) || !b || typeof b !== 'object') return fail();
      const continuous = control === 'SMART_STRIP' || control === 'ENCODER_ROTATE';
      if (b.type === 'none') continue;
      if (b.type === 'mode') { if (continuous || !ids.includes(b.modeId)) return fail(); continue; }
      if (!channel(b.channel)) return fail();
      if (b.type === 'note') {
        if (continuous || !byte(b.note) || !(byte(b.velocity) && b.velocity > 0 || b.velocity === 'pad' && PAD_IDS.includes(control as `PAD_${number}`))) return fail();
      } else if (b.type === 'program') { if (continuous || !byte(b.program)) return fail(); }
      else if (b.type === 'cc') {
        if (!byte(b.controller)) return fail();
        if (b.style === 'encoder') {
          if (control !== 'ENCODER_ROTATE' || !Number.isInteger(b.step) || b.step < 1 || b.step > 127 || !byte(b.initial) || !Number.isInteger(b.modulus) || b.modulus < 0 || b.modulus === 1 || b.modulus > 256) return fail();
        } else if (b.style === 'strip') {
          if (control !== 'SMART_STRIP' || !Number.isInteger(b.rawMin) || !Number.isInteger(b.rawMax) || b.rawMin < 1 || b.rawMin >= b.rawMax || b.rawMax > 255) return fail();
        } else if (!['momentary', 'toggle'].includes(b.style) || continuous || !byte(b.on) || !byte(b.off)) return fail();
      } else return fail();
    }
  }
  return JSON.parse(JSON.stringify(p));
}
