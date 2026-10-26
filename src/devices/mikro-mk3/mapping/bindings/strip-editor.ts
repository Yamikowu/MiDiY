import {
  PAD_COLORS, type Binding, type Brightness,
  type StripLightMode
} from '@midiy/mikro-core';
import { l, labelAttributes, t } from '../../../../i18n/index';
import { NoteInputs } from '../../../../shared/notes/note-input';
import { readSwitchCc, type BindingFields } from './binding-fields';
import { EditorSession } from '../editor-session';

import type { Mode } from '@midiy/mikro-core';
import { brightnessOptions, ccFields, field } from '../view-helpers';
export interface StripEditorContext {
  el: <T extends HTMLElement = HTMLElement>(id: string) => T;
  noteField: (id: string, label: string, value: number) => string;
  noteInputs: NoteInputs | undefined;
  readonly session: Readonly<Pick<EditorSession, 'selected'>>;
  syncCcFields: (container: "fields" | "strip-touch", prefix: string) => void;
}

export function syncStripCcFields(ctx: StripEditorContext): void {
  const mode = (document.getElementById('bind-strip-mode') as HTMLSelectElement).value;
  ctx.el('fields').querySelectorAll<HTMLElement>('[data-strip-cc-fields]').forEach(label => {
    const show = label.dataset.stripCcFields!.split(' ').includes(mode);
    label.hidden = !show;
    label.querySelectorAll<HTMLInputElement>('input').forEach(input => { input.disabled = !show; });
  });
}

export function renderTouchFields(ctx: StripEditorContext, existing?: Binding, fromSelection = false): void {
  if (ctx.session.selected !== 'SMART_STRIP') { ctx.el('strip-touch').innerHTML = ''; return; }
  const action = fromSelection ? (document.getElementById('bind-touch-type') as HTMLSelectElement).value
    : existing?.type === 'value' ? existing.output : existing?.type === 'system' ? existing.command : existing?.type ?? 'none';
  const b = fromSelection ? undefined : existing;
  let fields = `<div class="editor-section-label">${l('strip_touch_touch_release', {})}</div>`;
  fields += `<label>${l('touch_action', {})}<select id="bind-touch-type">${[['none', t('disabled')], ['note', 'Note'], ['cc', 'Control Change'], ['poly-pressure', 'Poly Pressure'], ['channel-pressure', 'Channel Pressure'], ['program', 'Program Change'], ['pitchbend', 'Pitchbend'], ['start', 'Start'], ['stop', 'Stop'], ['continue', 'Continue'], ['song-position', 'Song Position']].map(([id, label]) => `<option value="${id}" ${labelAttributes(label)}>${label}</option>`).join('')}</select></label>`;
  if (!['none', 'start', 'stop', 'continue', 'song-position'].includes(action)) fields += field('touch-channel', 'MIDI Channel', b && 'channel' in b ? b.channel : 1, 1, 16);
  if (action === 'note') fields += ctx.noteField('touch-note', 'Note Number', b?.type === 'note' ? b.note : 36) + '';
  else if (action === 'cc') {
    fields += field('touch-controller', 'CC Number', b?.type === 'cc' ? b.controller : 1);
    fields += ccFields('touch-', b);
  } else if (action === 'poly-pressure' || action === 'channel-pressure' || action === 'pitchbend') {
    const v = b?.type === 'value' && b.output === action ? b : undefined;
    const max = action === 'pitchbend' ? 16383 : 127;
    if (action === 'poly-pressure') fields += ctx.noteField('touch-note', 'Note Number', v?.note ?? 36);
    fields += field('touch-on', t('touch_value'), v?.on ?? max, 0, max) + field('touch-off', t('release_value'), v?.off ?? (action === 'pitchbend' ? 8192 : 0), 0, max);
  } else if (action === 'program') fields += field('touch-program', 'Program Number', b?.type === 'program' ? b.program : 0);
  else if (action === 'song-position') fields += field('touch-position', 'Song Position', b?.type === 'system' ? b.position ?? 0 : 0, 0, 16383);
  ctx.el('strip-touch').innerHTML = fields;
  ctx.noteInputs?.refresh();
  (document.getElementById('bind-touch-type') as HTMLSelectElement).value = action;
  if (action === 'cc') {
    (document.getElementById('bind-touch-style') as HTMLSelectElement).value = b?.type === 'cc' ? b.style : 'momentary';
    (document.getElementById('bind-touch-action-on') as HTMLSelectElement).value = b?.type === 'cc' && 'actionOn' in b ? b.actionOn ?? 'down' : 'down';
    ctx.syncCcFields('strip-touch', 'touch-');
  }
}


export function readStripPosition(f: BindingFields, action: string): Binding {
  const { val, num } = f;
  if (action === 'cc') {
    const shared = { type: 'cc' as const, channel: num('channel'), controller: num('controller') };
    const mode = val('strip-mode') as 'absolute' | 'relative' | 'relative-offset';
    return {
      ...shared, style: 'strip', rawMin: num('raw-min'), rawMax: num('raw-max'), mode,
      ...(mode === 'absolute' ? { from: num('strip-from'), to: num('strip-to') } : { step: num('strip-step'), resolution: num('strip-resolution') })
    };

  }
  if (['poly-pressure', 'channel-pressure', 'program', 'pitchbend'].includes(action)) return {
    type: 'strip-position', channel: num('channel'), output: action as 'poly-pressure' | 'channel-pressure' | 'program' | 'pitchbend',
    ...(action === 'poly-pressure' ? { note: num('note') } : {}), from: num('from'), to: num('to')
  };
  return { type: 'none' };
}

export function readStripTouch(f: BindingFields): Binding {
  const { val, num } = f;
  const touch = val('touch-type');
  let touchBinding: Binding = { type: 'none' };
  if (touch === 'note') touchBinding = { type: 'note', channel: num('touch-channel'), note: num('touch-note'), velocity: 127 };
  else if (touch === 'cc') touchBinding = readSwitchCc(f, 'touch-', false, { type: 'cc', channel: num('touch-channel'), controller: num('touch-controller') });
  else if (touch === 'program') touchBinding = { type: 'program', channel: num('touch-channel'), program: num('touch-program') };
  else if (touch === 'poly-pressure' || touch === 'channel-pressure' || touch === 'pitchbend') touchBinding = {
    type: 'value', channel: num('touch-channel'), output: touch,
    ...(touch === 'poly-pressure' ? { note: num('touch-note') } : {}), on: num('touch-on'), off: num('touch-off')
  };
  else if (touch === 'start' || touch === 'stop' || touch === 'continue' || touch === 'song-position') touchBinding = {
    type: 'system', command: touch, ...(touch === 'song-position' ? { position: num('touch-position') } : {})
  };
  return touchBinding;
}

export function readStripLight(f: BindingFields): NonNullable<Mode['stripLight']> {
  return {
    mode: f.val('strip-led-mode') as StripLightMode, brightness: f.val('strip-led-brightness') as Brightness,
    color: f.num('strip-led-color'), ...(f.checked('strip-led-hold') ? { hold: true } : {})
  };
}

export function stripPositionCcFields(cc?: Extract<Binding, { type: 'cc' }>): string {
  let fields = '';
  const strip = cc?.style === 'strip' ? cc : undefined;
  fields += field('raw-min', t('raw_minimum'), strip?.rawMin ?? 1, 1, 254) + field('raw-max', t('raw_maximum'), strip?.rawMax ?? 200, 2, 255);
  fields += '<label>Mode<select id="bind-strip-mode"><option value="absolute">Absolute</option><option value="relative">Relative</option><option value="relative-offset">Relative (Offset)</option></select></label>';
  fields += `<label data-strip-cc-fields="absolute">Range From<input id="bind-strip-from" type="number" min="0" max="127" value="${strip?.from ?? 0}" required></label>`;
  fields += `<label data-strip-cc-fields="absolute">Range To<input id="bind-strip-to" type="number" min="0" max="127" value="${strip?.to ?? 127}" required></label>`;
  fields += `<label data-strip-cc-fields="relative relative-offset">Step<input id="bind-strip-step" type="number" min="-127" max="127" value="${strip?.step ?? 1}" required></label>`;
  fields += `<label data-strip-cc-fields="relative relative-offset">${l('resolution_steps_per_full_swipe_higher_is_more_sensitive', {})}<input id="bind-strip-resolution" type="number" min="1" max="200" value="${strip?.resolution ?? 25}" required></label>`;
  return fields;
}

export function stripLightFields(stripLight: NonNullable<Mode['stripLight']>): string { return `<div class="editor-section-label">STRIP LIGHT</div><label>LED Mode<select id="bind-strip-led-mode"><option value="dot" data-i18n="dot_single_point">${t('dot_single_point')}</option><option value="bar" data-i18n="bar_fill_from_left">${t('bar_fill_from_left')}</option><option value="pan" data-i18n="pan_center_outward">${t('pan_center_outward')}</option></select></label><label>Color Value<select id="bind-strip-led-color">${PAD_COLORS.slice(1).map((name, i) => `<option value="${i + 1}">${name}</option>`).join('')}</select></label><label>${l('brightness', {})}<select id="bind-strip-led-brightness">${brightnessOptions(stripLight.brightness)}</select></label><label class="switch strip-hold-switch"><input id="bind-strip-led-hold" type="checkbox" ${stripLight.hold ? 'checked' : ''}>${l('strip_hold_light')}</label>`; }
