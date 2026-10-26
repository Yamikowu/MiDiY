import {
  PAD_COLORS, type Binding, type Brightness,
  type PadLight,
  type PressureBinding
} from '@midiy/mikro-core';
import { l, t } from '../../../../i18n/index';
import { NoteInputs } from '../../../../shared/notes/note-input';
import type { BindingFields } from './binding-fields';
import { readButtonBinding } from './button-editor';
import { EditorSession } from '../editor-session';

import type { Mode } from '@midiy/mikro-core';
import { field, isPad } from '../view-helpers';
export interface PadEditorContext {
  currentMode: () => Mode;
  el: <T extends HTMLElement = HTMLElement>(id: string) => T;
  noteField: (id: string, label: string, value: number) => string;
  noteInputs: NoteInputs | undefined;
  noteLabel: (note: number) => string;
  readonly session: Readonly<Pick<EditorSession, 'selected'>>;
}

export function pressureLabel(ctx: PadEditorContext, binding: PressureBinding): string {
  if (binding.type === 'off') return t('disabled');
  const prefix = `CH ${binding.channel} · `;
  if (binding.type === 'note') return `${prefix}${ctx.noteLabel(binding.note!)}`;
  if (binding.type === 'poly-pressure') return `${prefix}Poly Pressure · ${ctx.noteLabel(binding.note!)}`;
  if (binding.type === 'cc') return `${prefix}CC ${binding.controller}`;
  return prefix + (binding.type === 'channel-pressure' ? 'Channel Pressure' : 'Pitchbend');
}

export function renderPressFields(ctx: PadEditorContext, existing?: PressureBinding, fromSelection = false): void {
  if (!isPad(ctx.session.selected)) { ctx.el('pad-press').innerHTML = ''; return; }
  const action = fromSelection ? (document.getElementById('bind-press-type') as HTMLSelectElement).value : existing?.type ?? 'off';
  const b = existing?.type === action ? existing : undefined;
  let fields = `<div class="editor-section-label">${l('pad_press_continuous_pressure', {})}</div><label>${l('pressure_action', {})}<select id="bind-press-type"><option value="off" data-i18n="disabled">${t('disabled')}</option><option value="note" data-i18n="midi_note_pressure_threshold">${t('midi_note_pressure_threshold')}</option><option value="cc">MIDI CC</option><option value="poly-pressure">Poly Pressure</option><option value="channel-pressure">Channel Pressure</option><option value="pitchbend">Pitchbend</option></select></label>`;
  if (action !== 'off') {
    fields += field('press-channel', t('pressure_midi_channel'), b && 'channel' in b ? b.channel : 1, 1, 16);
    if (action === 'note') {
      const n = b?.type === 'note' ? b : undefined;
      const hit = ctx.currentMode().bindings[ctx.session.selected];
      fields += ctx.noteField('press-note', t('pressure_note'), n?.note ?? (hit?.type === 'note' ? hit.note : 36));
      fields += field('press-velocity', t('trigger_velocity'), n?.velocity ?? 100, 1, 127);
      fields += field('press-off-threshold', t('release_threshold'), n?.offThreshold ?? 10, 0, 99);
      fields += field('press-on-threshold', t('trigger_threshold'), n?.onThreshold ?? 20, 1, 100);
    } else {
      if (action === 'cc') fields += field('press-controller', t('pressure_cc_number'), b?.type === 'cc' ? b.controller : 1);
      if (action === 'poly-pressure') {
        const hit = ctx.currentMode().bindings[ctx.session.selected];
        fields += ctx.noteField('press-note', t('pressure_note'), b?.type === 'poly-pressure' ? b.note : hit?.type === 'note' ? hit.note : 36);
      }
      const bend = action === 'pitchbend';
      fields += field('press-from', bend ? t('minimum_pitch_bend') : t('output_minimum'), b && 'from' in b ? b.from : 0, bend ? -100 : 0, bend ? 100 : 127);
      fields += field('press-to', bend ? t('maximum_pitch_bend') : t('output_maximum'), b && 'to' in b ? b.to : bend ? 100 : 127, bend ? -100 : 0, bend ? 100 : 127);
    }
  }
  ctx.el('pad-press').innerHTML = fields;
  ctx.noteInputs?.refresh();
  (document.getElementById('bind-press-type') as HTMLSelectElement).value = action;
}


export function readPadPress(f: BindingFields): PressureBinding {
  const { val, num } = f;
  const action = val('press-type');
  let press: PressureBinding = { type: 'off' };
  if (action === 'note') press = { type: 'note', channel: num('press-channel'), note: num('press-note'), velocity: num('press-velocity'), offThreshold: num('press-off-threshold'), onThreshold: num('press-on-threshold') };
  else if (action === 'cc') press = { type: 'cc', channel: num('press-channel'), controller: num('press-controller'), from: num('press-from'), to: num('press-to') };
  else if (action === 'poly-pressure') press = { type: 'poly-pressure', channel: num('press-channel'), note: num('press-note'), from: num('press-from'), to: num('press-to') };
  else if (action === 'channel-pressure') press = { type: 'channel-pressure', channel: num('press-channel'), from: num('press-from'), to: num('press-to') };
  else if (action === 'pitchbend') press = { type: 'pitchbend', channel: num('press-channel'), from: num('press-from'), to: num('press-to') };
  return press;
}

export function readPadLight(f: BindingFields, brightness: Brightness): PadLight {
  return { color: f.num('color'), brightness, ...(f.val('color-mode') === 'dual' ? { onColor: f.num('on-color') } : {}) };
}
export function readPadHit(f: BindingFields, action: string): Binding { return readButtonBinding(f, action, true); }

export function padVelocityFields(note?: Extract<Binding, { type: 'note' }>): string {
  const fixed = typeof note?.velocity === 'number' ? note.velocity : undefined;
  return field('velocity-min', t('output_minimum'), fixed ?? note?.velocityMin ?? 0)
    + field('velocity-max', t('output_maximum'), fixed ?? note?.velocityMax ?? 127);
}

export function padLightFields(): string { return `<div class="editor-section-label">PAD LIGHT</div><label>Color Mode<select id="bind-color-mode"><option value="single" data-i18n="single_one_color_two_brightness_levels">${t('single_one_color_two_brightness_levels')}</option><option value="dual" data-i18n="dual_two_colors">${t('dual_two_colors')}</option></select></label><label>${l('idle_color_color_off', {})}<select id="bind-color">${PAD_COLORS.map((name, i) => `<option value="${i}">${name}</option>`).join('')}</select></label><label data-pad-dual>${l('pressed_color_color_on', {})}<select id="bind-on-color">${PAD_COLORS.map((name, i) => `<option value="${i}">${name}</option>`).join('')}</select></label>`; }
