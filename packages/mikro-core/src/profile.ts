import { BUTTON_IDS, CONTROL_IDS, PAD_IDS, type Brightness, type ButtonId, type PadId, type ControlId, type PadLight, type StripLightMode } from './protocol.js';
export type MidiChannel = number; // Human-facing 1–16 throughout profiles.
export type Binding =
  | { type: 'none' }
  | { type: 'fixed-velocity'; velocity: number }
  | { type: 'note'; channel: MidiChannel; note: number; velocity: number | 'pad'; velocityMin?: number; velocityMax?: number; mode?: 'gate' | 'toggle'; actionOn?: 'down' | 'up' }
  | { type: 'cc'; channel: MidiChannel; controller: number; style: 'momentary'; on: number; off: number; actionOn?: never }
  | { type: 'cc'; channel: MidiChannel; controller: number; style: 'toggle'; on: number; off: number; actionOn?: 'down' | 'up' }
  | { type: 'cc'; channel: MidiChannel; controller: number; style: 'trigger'; value: number; actionOn?: 'down' | 'up' }
  | { type: 'cc'; channel: MidiChannel; controller: number; style: 'inc'; from: number; to: number; step: number; wrap: boolean; actionOn?: 'down' | 'up' }
  | { type: 'cc'; channel: MidiChannel; controller: number; style: 'encoder'; step: number; initial: number; modulus: number }
  | {
    type: 'cc'; channel: MidiChannel; controller: number; style: 'strip'; rawMin: number; rawMax: number;
    mode?: 'absolute' | 'relative' | 'relative-offset'; from?: number; to?: number; step?: number; resolution?: number
  }
  | { type: 'strip-position'; channel: MidiChannel; output: 'poly-pressure' | 'channel-pressure' | 'program' | 'pitchbend'; note?: number; from: number; to: number }
  | {
    type: 'button-value'; channel: MidiChannel; output: 'poly-pressure' | 'channel-pressure' | 'program' | 'pitchbend'; note?: number;
    mode: 'gate' | 'toggle'; on: number; off: number; actionOn?: 'down' | 'up'
  }
  | {
    type: 'button-value'; channel: MidiChannel; output: 'poly-pressure' | 'channel-pressure' | 'program' | 'pitchbend'; note?: number;
    mode: 'trigger'; value: number; actionOn?: 'down' | 'up'
  }
  | {
    type: 'button-value'; channel: MidiChannel; output: 'poly-pressure' | 'channel-pressure' | 'program' | 'pitchbend'; note?: number;
    mode: 'inc'; from: number; to: number; step: number; wrap: boolean; actionOn?: 'down' | 'up'
  }
  | { type: 'value'; channel: MidiChannel; output: 'poly-pressure' | 'channel-pressure' | 'pitchbend'; note?: number; on: number; off: number }
  | { type: 'system'; command: 'start' | 'stop' | 'continue' | 'song-position'; position?: number }
  | { type: 'program'; channel: MidiChannel; program: number }
  | { type: 'mode'; modeId: string };
/** A pad's continuous Press action is independent of its Hit binding. */
export type PressureBinding =
  | { type: 'off' }
  | { type: 'note'; channel: MidiChannel; note: number; velocity: number; onThreshold: number; offThreshold: number }
  | { type: 'cc'; channel: MidiChannel; controller: number; from: number; to: number }
  | { type: 'poly-pressure'; channel: MidiChannel; note: number; from: number; to: number }
  | { type: 'channel-pressure'; channel: MidiChannel; from: number; to: number }
  | { type: 'pitchbend'; channel: MidiChannel; from: number; to: number };
export interface Mode {
  id: string; name: string; selectorPad: PadId | null; color: number; bindings: Partial<Record<ControlId, Binding>>; pads: PadLight[];
  pressureBindings?: Partial<Record<`PAD_${number}`, PressureBinding>>;
  padOnBrightness: Brightness;
  padOffBrightness: Brightness;
  buttonLight: { off: Brightness; on: Brightness };
  toggleButtonLight: { off: Brightness; on: Brightness };
  stripLight?: { mode: StripLightMode; brightness: Brightness; color?: number; hold?: boolean };
}
export const PAD_VELOCITY_CURVES = ['soft-3', 'soft-2', 'soft-1', 'linear', 'hard-1', 'hard-2', 'hard-3'] as const;
export type PadVelocityCurve = typeof PAD_VELOCITY_CURVES[number];
export const MODE_SELECTOR_BUTTONS = BUTTON_IDS.filter(id => !['SHIFT', 'FAVORITES', 'BROWSER', 'ENCODER_TOUCH'].includes(id));
export interface Profile { modeSelector: ButtonId; schema: 'midiy-profile-v2'; name: string; initialModeId: string; modes: Mode[]; padVelocityCurve: PadVelocityCurve }
export function createMode(id: string, name: string): Mode {
  return { id, name, selectorPad: null, color: 11, bindings: { FIXED_VEL: { type: 'fixed-velocity', velocity: 127 } }, padOnBrightness: 'bright', padOffBrightness: 'dim',
    buttonLight: { off: 'off', on: 'normal' }, toggleButtonLight: { off: 'off', on: 'normal' }, pads: PAD_IDS.map(() => ({ color: 11, brightness: 'dim' })) };
}
export function createDefaultProfile(): Profile {
  const modes = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'].map((name, i) => {
    const mode = createMode(i === 0 ? 'default' : `group-${name.toLowerCase()}`, name);
    mode.selectorPad = PAD_IDS[[13, 14, 15, 16, 9, 10, 11, 12][i] - 1];
    mode.color = [1, 2, 5, 7, 9, 11, 13, 15][i];
    PAD_IDS.forEach((id, pad) => { mode.bindings[id] = { type: 'note', channel: 1, note: 36 + pad, velocity: 'pad' }; });
    return mode;
  });
  return { schema: 'midiy-profile-v2', modeSelector: 'GROUP', name: 'Mikro MIDI', initialModeId: modes[0].id, modes, padVelocityCurve: 'linear' };
}
const byte = (n: unknown): n is number => Number.isInteger(n) && Number(n) >= 0 && Number(n) <= 127;
const channel = (n: unknown) => Number.isInteger(n) && Number(n) >= 1 && Number(n) <= 16;
/** Validate imported data before it can generate MIDI or device output. Returns a detached copy. */
export function parseProfile(value: unknown): Profile {
  const fail = (): never => { throw new Error('無效的 MiDiY v2 設定檔'); };
  if (!value || typeof value !== 'object') return fail();
  const p = value as Profile & { schema: string };
  if (p.schema !== 'midiy-profile-v2' || typeof p.name !== 'string' || !p.name.trim() || !Array.isArray(p.modes) || !p.modes.length || p.modes.length > 64) return fail();
  if (!PAD_VELOCITY_CURVES.includes(p.padVelocityCurve)) return fail();
  if (!MODE_SELECTOR_BUTTONS.includes(p.modeSelector)) return fail();
  const assigned = p.modes.map(m => m?.selectorPad).filter(pad => pad !== null);
  if (new Set(assigned).size !== assigned.length) return fail();
  const ids = p.modes.map(m => m?.id);
  if (new Set(ids).size !== ids.length || !ids.includes(p.initialModeId)) return fail();
  for (const m of p.modes) {
    if (!m || typeof m.id !== 'string' || !m.id || typeof m.name !== 'string' || !m.name.trim() || !Array.isArray(m.pads) || m.pads.length !== 16 || !m.bindings || typeof m.bindings !== 'object' || Array.isArray(m.bindings)) return fail();
    if (m.selectorPad !== null && !PAD_IDS.includes(m.selectorPad) || !Number.isInteger(m.color) || m.color < 0 || m.color > 17) return fail();
    if (m.bindings[p.modeSelector] && m.bindings[p.modeSelector]?.type !== 'none') return fail();
    if (Object.values(m.bindings).filter(b => b?.type === 'fixed-velocity').length > 1) return fail();
    for (const pad of m.pads) {
      if (!pad || !Number.isInteger(pad.color) || pad.color < 0 || pad.color > 17 ||
        pad.onColor !== undefined && (!Number.isInteger(pad.onColor) || pad.onColor < 0 || pad.onColor > 17) ||
        !['off', 'dim', 'normal', 'bright'].includes(pad.brightness)) return fail();
    }
    if (!['off', 'dim', 'normal', 'bright'].includes(m.padOffBrightness)) return fail();
    if (!['off', 'dim', 'normal', 'bright'].includes(m.padOnBrightness)) return fail();
    for (const light of [m.buttonLight, m.toggleButtonLight]) {
      if (!light ||
        !['off', 'dim', 'normal', 'bright'].includes(light.off) ||
        !['off', 'dim', 'normal', 'bright'].includes(light.on)) return fail();
    }
    if (m.stripLight !== undefined && (!m.stripLight || !['dot', 'bar', 'pan'].includes(m.stripLight.mode) ||
      !['off', 'dim', 'normal', 'bright'].includes(m.stripLight.brightness) ||
      m.stripLight.hold !== undefined && typeof m.stripLight.hold !== 'boolean' ||
      m.stripLight.color !== undefined && (!Number.isInteger(m.stripLight.color) || m.stripLight.color < 0 || m.stripLight.color > 17))) return fail();
    for (const [control, b] of Object.entries(m.bindings)) {
      if (!CONTROL_IDS.includes(control as ControlId) || !b || typeof b !== 'object') return fail();
      if (PAD_IDS.includes(control as `PAD_${number}`) && 'actionOn' in b) return fail();
      const continuous = control === 'SMART_STRIP' || control === 'ENCODER_ROTATE';
      if (b.type === 'none') continue;
      if (b.type === 'fixed-velocity') {
        if (!MODE_SELECTOR_BUTTONS.includes(control as ButtonId) || !byte(b.velocity) || b.velocity < 1) return fail();
        continue;
      }
      if (b.type === 'mode') { if (continuous || !ids.includes(b.modeId)) return fail(); continue; }
      if (b.type === 'system') {
        if (control !== 'SMART_STRIP_TOUCH' || !['start', 'stop', 'continue', 'song-position'].includes(b.command)
          || b.command === 'song-position' && (typeof b.position !== 'number' || !Number.isInteger(b.position) || b.position < 0 || b.position > 16383)) return fail();
        continue;
      }
      if (!channel(b.channel)) return fail();
      if (b.type === 'note') {
        if (continuous || !byte(b.note) || !(byte(b.velocity) && b.velocity > 0 || b.velocity === 'pad' && PAD_IDS.includes(control as `PAD_${number}`))
          || b.velocityMin !== undefined && !byte(b.velocityMin)
          || b.velocityMax !== undefined && !byte(b.velocityMax)
          || (b.velocityMin !== undefined || b.velocityMax !== undefined) && (b.velocity !== 'pad' || (b.velocityMin ?? 0) > (b.velocityMax ?? 127))
          || b.mode !== undefined && !['gate', 'toggle'].includes(b.mode)
          || b.actionOn !== undefined && (b.mode !== 'toggle' || !['down', 'up'].includes(b.actionOn))) return fail();
      } else if (b.type === 'program') { if (continuous || !byte(b.program)) return fail(); }
      else if (b.type === 'button-value') {
        const max = b.output === 'pitchbend' ? 16383 : 127;
        const valid = (n: unknown) => Number.isInteger(n) && Number(n) >= 0 && Number(n) <= max;
        if (continuous || !['poly-pressure', 'channel-pressure', 'program', 'pitchbend'].includes(b.output)
          || b.output === 'poly-pressure' && !byte(b.note)
          || b.actionOn !== undefined && (b.mode === 'gate' || !['down', 'up'].includes(b.actionOn))) return fail();
        if (b.mode === 'gate' || b.mode === 'toggle') { if (!valid(b.on) || !valid(b.off)) return fail(); }
        else if (b.mode === 'trigger') { if (!valid(b.value)) return fail(); }
        else if (b.mode === 'inc') { if (!valid(b.from) || !valid(b.to) || b.from >= b.to || !Number.isInteger(b.step) || b.step < -127 || b.step > 127 || b.step === 0 || typeof b.wrap !== 'boolean') return fail(); }
        else return fail();
      }
      else if (b.type === 'value') {
        if (control !== 'SMART_STRIP_TOUCH' || !['poly-pressure', 'channel-pressure', 'pitchbend'].includes(b.output) || b.output === 'poly-pressure' && !byte(b.note) || !Number.isInteger(b.on) || !Number.isInteger(b.off) || b.on < 0 || b.off < 0 || b.on > (b.output === 'pitchbend' ? 16383 : 127) || b.off > (b.output === 'pitchbend' ? 16383 : 127)) return fail();
      } else if (b.type === 'strip-position') {
        if (control !== 'SMART_STRIP' || !['poly-pressure', 'channel-pressure', 'program', 'pitchbend'].includes(b.output) || b.output === 'poly-pressure' && !byte(b.note) || !Number.isInteger(b.from) || !Number.isInteger(b.to) || b.from < 0 || b.to < 0 || b.from > (b.output === 'pitchbend' ? 16383 : 127) || b.to > (b.output === 'pitchbend' ? 16383 : 127)) return fail();
      }
      else if (b.type === 'cc') {
        if (!byte(b.controller)) return fail();
        if (b.style === 'encoder') {
          if (control !== 'ENCODER_ROTATE' || !Number.isInteger(b.step) || b.step < 1 || b.step > 127 || !byte(b.initial) || !Number.isInteger(b.modulus) || b.modulus < 0 || b.modulus === 1 || b.modulus > 256) return fail();
        } else if (b.style === 'strip') {
          if (control !== 'SMART_STRIP' || !Number.isInteger(b.rawMin) || !Number.isInteger(b.rawMax) || b.rawMin < 1 || b.rawMin >= b.rawMax || b.rawMax > 255
            || b.mode !== undefined && !['absolute', 'relative', 'relative-offset'].includes(b.mode)
            || b.from !== undefined && !byte(b.from) || b.to !== undefined && !byte(b.to)
            || b.step !== undefined && (!Number.isInteger(b.step) || b.step < -127 || b.step > 127 || b.step === 0)
            || b.resolution !== undefined && (!Number.isInteger(b.resolution) || b.resolution < 1 || b.resolution > 200)) return fail();
        } else if (continuous || b.actionOn !== undefined && !['down', 'up'].includes(b.actionOn)) return fail();
        else if (b.style === 'trigger') { if (!byte(b.value)) return fail(); }
        else if (b.style === 'inc') { if (!byte(b.from) || !byte(b.to) || b.from >= b.to || !Number.isInteger(b.step) || b.step < -127 || b.step > 127 || b.step === 0 || typeof b.wrap !== 'boolean') return fail(); }
        else if (!['momentary', 'toggle'].includes(b.style) || !byte(b.on) || !byte(b.off)) return fail();
      } else return fail();
    }
    if (m.pressureBindings !== undefined) {
      if (!m.pressureBindings || typeof m.pressureBindings !== 'object' || Array.isArray(m.pressureBindings)) return fail();
      for (const [control, b] of Object.entries(m.pressureBindings)) {
        if (!PAD_IDS.includes(control as `PAD_${number}`) || !b || typeof b !== 'object') return fail();
        if (b.type === 'off') continue;
        if (!channel(b.channel)) return fail();
        if (b.type === 'note') {
          if (!byte(b.note) || !byte(b.velocity) || b.velocity === 0 || !Number.isInteger(b.offThreshold) || !Number.isInteger(b.onThreshold) || b.offThreshold < 0 || b.onThreshold > 100 || b.offThreshold >= b.onThreshold) return fail();
        } else if (['cc', 'poly-pressure', 'channel-pressure', 'pitchbend'].includes(b.type)) {
          if (!Number.isInteger(b.from) || !Number.isInteger(b.to) || b.from > b.to ||
            (b.type === 'pitchbend' ? b.from < -100 || b.to > 100 : !byte(b.from) || !byte(b.to))) return fail();
          if (b.type === 'cc' && !byte(b.controller) || b.type === 'poly-pressure' && !byte(b.note)) return fail();
        } else return fail();
      }
    }
  }
  const detached = JSON.parse(JSON.stringify(p)) as Profile;
  // Buttons have no measured strike velocity; their Note output is always 127.
  for (const mode of detached.modes) for (const [id, binding] of Object.entries(mode.bindings)) {
    if (!PAD_IDS.includes(id as `PAD_${number}`) && binding?.type === 'note') binding.velocity = 127;
  }
  return detached;
}
