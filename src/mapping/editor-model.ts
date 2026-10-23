import { CONTROL_IDS, PAD_IDS, parseProfile, type Binding, type ControlId, type Profile, type PressureBinding } from '@midiy/mikro-core';

export const isPadControl = (id: ControlId) => PAD_IDS.includes(id as `PAD_${number}`);
export const orderedControls = (ids: Iterable<ControlId>) => { const selected = new Set(ids); return CONTROL_IDS.filter(id => selected.has(id)); };
export function selectControls(current: readonly ControlId[], hits: readonly ControlId[], extend: boolean): ControlId[] {
  const selected = new Set(extend ? current : []);
  for (const id of hits) { if (extend && selected.has(id)) selected.delete(id); else selected.add(id); }
  return orderedControls(selected);
}
export interface ControlRect { id: ControlId; left: number; top: number; right: number; bottom: number }
export function controlsInRect(rects: readonly ControlRect[], a: { x: number; y: number }, b: { x: number; y: number }) {
  const left = Math.min(a.x, b.x), right = Math.max(a.x, b.x), top = Math.min(a.y, b.y), bottom = Math.max(a.y, b.y);
  return rects.filter(r => r.right > left && r.left < right && r.bottom > top && r.top < bottom).map(r => r.id);
}
export function actionsFor(id: ControlId): string[] {
  if (id === 'ENCODER_ROTATE') return ['none', 'cc'];
  if (id === 'SMART_STRIP') return ['none', 'cc', 'poly-pressure', 'channel-pressure', 'program', 'pitchbend'];
  return ['none', 'note', 'cc', 'poly-pressure', 'channel-pressure', 'program', 'pitchbend', 'mode', ...(id === 'FIXED_VEL' ? ['fixed-velocity'] : [])];
}
const family = (id: ControlId) => isPadControl(id) ? 'pad' : id === 'ENCODER_ROTATE' || id === 'SMART_STRIP' ? id : 'button';
export function commonActions(ids: readonly ControlId[]) {
  if (!ids.length) return [];
  return actionsFor(ids[0]).filter(action => ids.every(id => actionsFor(id).includes(action))
    && (action !== 'cc' || ids.every(id => family(id) === family(ids[0]))));
}
export function defaultBinding(action: string, id: ControlId, modeId: string): Binding {
  const channel = 1;
  if (action === 'note') return { type: 'note', channel, note: 36, velocity: isPadControl(id) ? 'pad' : 127, mode: 'gate' };
  if (action === 'mode') return { type: 'mode', modeId };
  if (action === 'cc') return id === 'ENCODER_ROTATE'
    ? { type: 'cc', channel, controller: 1, style: 'encoder', step: 1, initial: 64, modulus: 0 }
    : id === 'SMART_STRIP' ? { type: 'cc', channel, controller: 1, style: 'strip', rawMin: 1, rawMax: 200, mode: 'absolute', from: 0, to: 127 }
      : { type: 'cc', channel, controller: 1, style: 'momentary', on: 127, off: 0 };
  if (['poly-pressure', 'channel-pressure', 'program', 'pitchbend'].includes(action)) {
    const output = action as 'poly-pressure' | 'channel-pressure' | 'program' | 'pitchbend';
    return id === 'SMART_STRIP' ? { type: 'strip-position', channel, output, ...(output === 'poly-pressure' ? { note: 36 } : {}), from: 0, to: output === 'pitchbend' ? 16383 : 127 }
      : { type: 'button-value', channel, output, ...(output === 'poly-pressure' ? { note: 36 } : {}), mode: 'gate', on: output === 'pitchbend' ? 16383 : 127, off: output === 'pitchbend' ? 8192 : 0 };
  }
  return { type: 'none' };
}
export interface EditField { key: string; label: string; values: unknown[]; min?: number; max?: number; options?: { value: string; label: string }[] }
const enumOptions = (values: string[]) => values.map(value => ({ value, label: value }));
// Explicit defaults expose optional fields without normalizing or rewriting untouched bindings.
function bindingFields(binding: Binding | PressureBinding | undefined, pressure = false): Record<string, Omit<EditField, 'key' | 'values'> & { value: unknown }> {
  if (!binding || binding.type === 'none' || binding.type === 'off') return {};
  const b = binding as unknown as Record<string, unknown>;
  const result: ReturnType<typeof bindingFields> = {};
  const number = (key: string, label: string, min: number, max: number, fallback?: number) => {
    if (key in b || fallback !== undefined) result[key] = { label, min, max, value: b[key] ?? fallback };
  };
  const choice = (key: string, label: string, values: string[], fallback: string) => { result[key] = { label, options: enumOptions(values), value: b[key] ?? fallback }; };
  number('channel', 'MIDI Channel', 1, 16); number('note', 'Note Number', 0, 127); number('controller', 'CC Number', 0, 127);
  if (binding.type === 'mode') result.modeId = { label: 'target_mode', value: b.modeId };
  if (binding.type === 'note') {
    if (pressure) { number('velocity', 'trigger_velocity', 1, 127); number('offThreshold', 'release_threshold', 0, 99); number('onThreshold', 'trigger_threshold', 1, 100); }
    else {
      choice('mode', 'Mode', ['gate', 'toggle'], 'gate');
      if (b.velocity === 'pad') { number('velocityMin', 'output_minimum', 0, 127, 0); number('velocityMax', 'output_maximum', 0, 127, 127); }
      else if (typeof b.velocity === 'number' && b.velocity !== 127) number('velocity', 'fixed_velocity_value', 1, 127);
    }
  }
  if (!pressure && ((binding.type === 'note' && b.mode === 'toggle') || binding.type === 'button-value' && b.mode !== 'gate' || binding.type === 'cc' && ['toggle', 'trigger', 'inc'].includes(String(b.style)))) {
    choice('actionOn', 'Action on', ['down', 'up'], 'down');
  }
  if (binding.type === 'cc' && !pressure) {
    if (!['strip', 'encoder'].includes(String(b.style))) choice('style', 'Mode', ['momentary', 'toggle', 'trigger', 'inc'], 'momentary');
  }
  if (binding.type === 'button-value') choice('mode', 'Mode', ['gate', 'toggle', 'trigger', 'inc'], 'gate');
  const max = b.output === 'pitchbend' ? 16383 : 127;
  for (const key of ['on', 'off', 'value', 'from', 'to', 'initial', 'rawMin', 'rawMax', 'resolution', 'modulus', 'program']) {
    number(key, key, 0, key === 'rawMax' || key === 'rawMin' ? 255 : key === 'modulus' ? 256 : key === 'resolution' ? 200 : pressure && binding.type === 'pitchbend' ? 100 : max);
    if (pressure && binding.type === 'pitchbend' && result[key]) result[key].min = -100;
  }
  number('step', 'Step', -127, 127);
  if ('wrap' in b) result.wrap = { label: 'Wrap', value: b.wrap, options: enumOptions(['false', 'true']) };
  return result;
}
export function commonFields(profile: Profile, modeId: string, ids: readonly ControlId[]): EditField[] {
  const mode = profile.modes.find(m => m.id === modeId)!;
  if (!ids.length) return [];
  const sections = ['hit', ...(ids.every(isPadControl) ? ['press', 'pad'] : [])];
  const fields: EditField[] = [];
  for (const section of sections) {
    const all = ids.map(id => section === 'pad' ? {
      dual: { label: 'Color Mode', value: mode.pads[Number(id.slice(4)) - 1].onColor === undefined ? 'false' : 'true', options: enumOptions(['false', 'true']) },
      color: { label: 'idle_color_color_off', value: mode.pads[Number(id.slice(4)) - 1].color, min: 0, max: 17 },
      onColor: { label: 'pressed_color_color_on', value: mode.pads[Number(id.slice(4)) - 1].onColor ?? mode.pads[Number(id.slice(4)) - 1].color, min: 0, max: 17 }
    } : bindingFields(section === 'hit' ? mode.bindings[id] : mode.pressureBindings?.[id as `PAD_${number}`], section === 'press'));
    for (const [key, field] of Object.entries(all[0])) {
      if (key === 'actionOn' && section === 'hit' && ids.some(isPadControl)) continue;
      if (!all.every(row => key in row && JSON.stringify(row[key].options) === JSON.stringify(field.options))) continue;
      const values = all.map(row => row[key].value);
      const shared = { key: `${section}.${key}`, label: field.label, min: Math.max(...all.map(row => row[key].min ?? 0)), max: Math.min(...all.map(row => row[key].max ?? 16383)), options: field.options, values };
      if (key === 'modeId') shared.options = mode ? profile.modes.map(m => ({ value: m.id, label: m.name })) : [];
      fields.push(shared);
    }
  }
  return fields;
}
export function patchControls(profile: Profile, modeId: string, ids: readonly ControlId[], changes: Record<string, unknown>): Profile {
  const next = structuredClone(profile), mode = next.modes.find(m => m.id === modeId)!;
  for (const id of ids) {
    if ('action' in changes) mode.bindings[id] = defaultBinding(String(changes.action), id, modeId);
    if ('pressAction' in changes && isPadControl(id)) {
      const action = changes.pressAction;
      (mode.pressureBindings ??= {})[id as `PAD_${number}`] = action === 'off' ? { type: 'off' }
        : action === 'note' ? { type: 'note', channel: 1, note: 36, velocity: 100, onThreshold: 20, offThreshold: 10 }
          : action === 'cc' ? { type: 'cc', channel: 1, controller: 1, from: 0, to: 127 }
            : action === 'poly-pressure' ? { type: 'poly-pressure', channel: 1, note: 36, from: 0, to: 127 }
              : { type: action as 'channel-pressure' | 'pitchbend', channel: 1, from: 0, to: action === 'pitchbend' ? 100 : 127 };
    }
    // Switching a mode must supply valid new fields without carrying incompatible old fields.
    for (const section of ['hit', 'press']) {
      const binding = (section === 'hit' ? mode.bindings[id] : mode.pressureBindings?.[id as `PAD_${number}`]) as unknown as Record<string, unknown> | undefined;
      if (!binding) continue;
      const styleKey = binding.type === 'cc' ? 'style' : 'mode', style = changes[`${section}.${styleKey}`];
      if (style !== undefined && (binding.type === 'button-value' || binding.type === 'cc')) {
        for (const key of ['on', 'off', 'value', 'from', 'to', 'step', 'wrap', 'actionOn']) delete binding[key];
        const max = binding.output === 'pitchbend' ? 16383 : 127;
        Object.assign(binding, style === 'gate' || style === 'momentary' ? { on: max, off: 0 }
          : style === 'toggle' ? { on: max, off: 0 } : style === 'trigger' ? { value: max } : { from: 0, to: max, step: 1, wrap: true });
      }
      if (binding.type === 'note' && style === 'gate') delete binding.actionOn;
    }
    for (const [path, value] of Object.entries(changes)) {
      const [section, key] = path.split('.');
      if (!key) continue;
      if (section === 'pad' && isPadControl(id)) {
        const pad = mode.pads[Number(id.slice(4)) - 1];
        if (key === 'dual') { if (value === 'false' || value === false) delete pad.onColor; else pad.onColor ??= pad.color; }
        else if (key === 'color' || key === 'onColor') pad[key] = Number(value);
      } else {
        const binding = section === 'hit' ? mode.bindings[id] : mode.pressureBindings?.[id as `PAD_${number}`];
        if (binding) Object.assign(binding, { [key]: key === 'wrap' ? value === true || value === 'true' : value });
      }
    }
  }
  return parseProfile(next);
}
export interface ControlCopy { source: ControlId; binding?: Binding; pressure?: PressureBinding; pad?: Profile['modes'][number]['pads'][number]; touch?: Binding; strip?: Profile['modes'][number]['stripLight'] }
export function copyControls(profile: Profile, modeId: string, ids: readonly ControlId[]): ControlCopy[] {
  const mode = profile.modes.find(m => m.id === modeId)!;
  return orderedControls(ids).map(id => structuredClone({
    source: id, binding: mode.bindings[id],
    ...(isPadControl(id) ? { pressure: mode.pressureBindings?.[id as `PAD_${number}`], pad: mode.pads[Number(id.slice(4)) - 1] } : {}),
    ...(id === 'SMART_STRIP' ? { touch: mode.bindings.SMART_STRIP_TOUCH, strip: mode.stripLight } : {})
  }));
}
export function pasteControls(profile: Profile, modeId: string, ids: readonly ControlId[], copies: readonly ControlCopy[]): Profile {
  const targets = orderedControls(ids);
  if (!copies.length || copies.length !== 1 && copies.length !== targets.length) throw new Error('paste_count_mismatch');
  const next = structuredClone(profile), mode = next.modes.find(m => m.id === modeId)!;
  targets.forEach((id, index) => {
    const copy = copies[copies.length === 1 ? 0 : index];
    if (family(id) !== family(copy.source) || copy.binding?.type === 'fixed-velocity' && id !== 'FIXED_VEL') throw new Error('paste_incompatible');
    if (copy.binding) mode.bindings[id] = structuredClone(copy.binding); else delete mode.bindings[id];
    if (isPadControl(id)) {
      if (copy.pressure) (mode.pressureBindings ??= {})[id as `PAD_${number}`] = structuredClone(copy.pressure);
      else delete mode.pressureBindings?.[id as `PAD_${number}`];
      const brightness = mode.pads[Number(id.slice(4)) - 1].brightness;
      mode.pads[Number(id.slice(4)) - 1] = { ...structuredClone(copy.pad!), brightness };
    }
    if (id === 'SMART_STRIP') {
      if (copy.touch) mode.bindings.SMART_STRIP_TOUCH = structuredClone(copy.touch); else delete mode.bindings.SMART_STRIP_TOUCH;
      mode.stripLight = structuredClone(copy.strip);
    }
  });
  return parseProfile(next);
}
export class EditHistory {
  private past: Profile[] = [];
  private future: Profile[] = [];
  current: Profile;
  constructor(profile: Profile) { this.current = structuredClone(profile); }
  get canUndo() { return this.past.length > 0; }
  get canRedo() { return this.future.length > 0; }
  record(profile: Profile) {
    if (JSON.stringify(profile) === JSON.stringify(this.current)) return;
    this.past.push(this.current); if (this.past.length > 100) this.past.shift();
    this.current = structuredClone(profile); this.future = [];
  }
  peek(redo = false) { return structuredClone((redo ? this.future : this.past).at(-1)); }
  move(redo = false) {
    const from = redo ? this.future : this.past, to = redo ? this.past : this.future;
    if (!from.length) return;
    to.push(this.current); this.current = from.pop()!; return structuredClone(this.current);
  }
}

export function mappingShortcut(event: { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean; repeat: boolean; isComposing: boolean }, editingText: boolean): 'copy' | 'paste' | 'undo' | 'redo' | undefined {
  if (editingText || event.isComposing || event.repeat || event.altKey || !(event.metaKey || event.ctrlKey)) return;
  const key = event.key.toLowerCase();
  return key === 'c' ? 'copy' : key === 'v' ? 'paste' : key === 'y' || key === 'z' && event.shiftKey ? 'redo' : key === 'z' ? 'undo' : undefined;
}
