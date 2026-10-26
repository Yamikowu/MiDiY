import {
  MODE_SELECTOR_BUTTONS,
  PAD_COLORS,
  type Binding, type Brightness, type ControlId,
  type PadLight,
  type PressureBinding,
  type Profile,
  type StripLightMode
} from '@midiy/mikro-core';
import { l, labelAttributes, t } from '../../../i18n/index';
import { NoteInputs } from '../../../shared/notes/note-input';
import { readBindingDraft } from './bindings/binding-draft';
import { EditorSession } from './editor-session';
import { encoderFields } from './bindings/encoder-editor';
import { padLightFields, padVelocityFields } from './bindings/pad-editor';
import { stripLightFields, stripPositionCcFields } from './bindings/strip-editor';

import type { Mode } from '@midiy/mikro-core';
import type { TranslatorOptions } from './view-contracts';
import { ccFields, controlName, field, html, isPad } from './view-helpers';
export interface BindingEditorContext {
  applyBinding: () => void;
  controlSummary: (id: ControlId) => string;
  currentMode: () => Mode;
  el: <T extends HTMLElement = HTMLElement>(id: string) => T;
  guard: (action: () => void | Promise<void>) => Promise<void>;
  markBindingDirty: () => void;
  noteField: (id: string, label: string, value: number) => string;
  noteInputs: NoteInputs | undefined;
  previewPadLight: () => void;
  renderBatch: () => void;
  renderPressFields: (existing?: PressureBinding, fromSelection?: boolean) => void;
  renderSaveState: () => void;
  renderTouchFields: (existing?: Binding, fromSelection?: boolean) => void;
  session: EditorSession;
  syncStripCcFields: () => void;
}

export function mountBinding(ctx: BindingEditorContext): void {
  for (const scope of ['hit', 'press', 'position', 'touch'] as const) {
    const select = (next: typeof scope) => {
      if (next === 'hit' || next === 'press') ctx.session.padTab = next;
      else ctx.session.stripTab = next;
      renderControlTabs(ctx);
    };
    ctx.el(`${scope}-tab`).addEventListener('click', () => select(scope));
    ctx.el(`${scope}-tab`).addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const [first, last] = scope === 'hit' || scope === 'press' ? ['hit', 'press'] as const : ['position', 'touch'] as const;
      const next = event.key === 'Home' ? first : event.key === 'End' ? last : scope === first ? last : first;
      select(next); ctx.el(`${next}-tab`).focus();
    });
  }
  let revealingInvalid = false;
  ctx.el('binding-form').addEventListener('invalid', event => {
    if (ctx.el('pad-tabs').hidden || revealingInvalid) return;
    revealingInvalid = true;
    ctx.session.padTab = ctx.el('pad-press').contains(event.target as Node) ? 'press' : 'hit';
    ctx.session.stripTab = ctx.el('strip-touch').contains(event.target as Node) ? 'touch' : 'position';
    renderControlTabs(ctx); queueMicrotask(() => { revealingInvalid = false; });
  }, true);
  ctx.el('binding-form').addEventListener('input', () => ctx.markBindingDirty());
  ctx.el('binding-form').addEventListener('change', () => ctx.markBindingDirty());
  ctx.el('pad-light').addEventListener('input', () => ctx.previewPadLight());
  ctx.el('pad-light').addEventListener('change', () => ctx.previewPadLight());
  ctx.el('pad-light').addEventListener('change', event => {
    if ((event.target as HTMLElement).id === 'bind-color-mode') syncPadColorFields(ctx);
  });
  ctx.el('pad-press').addEventListener('change', event => {
    if ((event.target as HTMLElement).id === 'bind-press-type') ctx.renderPressFields(undefined, true);
  });
  ctx.el('fields').addEventListener('change', event => {
    if ((event.target as HTMLElement).id === 'bind-style') syncCcFields(ctx, 'fields', '');
    if ((event.target as HTMLElement).id === 'bind-note-mode') syncNoteFields(ctx);
    if ((event.target as HTMLElement).id === 'bind-strip-mode') ctx.syncStripCcFields();
  });
  ctx.el('strip-touch').addEventListener('change', event => {
    const id = (event.target as HTMLElement).id;
    if (id === 'bind-touch-type') ctx.renderTouchFields(undefined, true);
    if (id === 'bind-touch-style') syncCcFields(ctx, 'strip-touch', 'touch-');
  });
  ctx.el('action').addEventListener('change', () => {
    if (ctx.session.selection.size !== 1 || ctx.session.pendingPaste) return;
    const lightDraft = readPadLightDraft(ctx);
    const stripDraft = readStripLightDraft(ctx);
    renderFields(ctx, undefined, lightDraft ?? undefined, stripDraft ?? undefined); ctx.markBindingDirty(); ctx.previewPadLight();
  });
  ctx.el('binding-form').addEventListener('submit', event => { event.preventDefault(); ctx.guard(() => ctx.applyBinding()); });
}

export function renderControlTabs(ctx: BindingEditorContext): void {
  const pads = ctx.session.selection.size > 0 && [...ctx.session.selection].every(isPad) && !ctx.session.pendingPaste;
  const strip = ctx.session.selection.size === 1 && ctx.session.selected === 'SMART_STRIP' && !ctx.session.pendingPaste;
  const enabled = pads || strip, active = strip ? ctx.session.stripTab : ctx.session.padTab;
  ctx.el('pad-tabs').hidden = !enabled;
  ctx.el('binding-form').classList.toggle('has-pad-tabs', pads);
  ctx.el('binding-form').classList.toggle('has-strip-tabs', strip);
  ctx.el('hit-panel').hidden = enabled && active !== 'hit' && active !== 'position';
  ctx.el('pad-press').hidden = !pads || active !== 'press';
  ctx.el('strip-touch').hidden = !strip || active !== 'touch';
  for (const scope of ['hit', 'press', 'position', 'touch'] as const) {
    ctx.el(`${scope}-tab`).hidden = scope === 'hit' || scope === 'press' ? !pads : !strip;
    ctx.el(`${scope}-tab`).setAttribute('aria-selected', String(scope === active));
    ctx.el(`${scope}-tab`).tabIndex = scope === active ? 0 : -1;
  }
  if (enabled) {
    ctx.el('hit-panel').setAttribute('role', 'tabpanel');
    ctx.el('hit-panel').setAttribute('aria-labelledby', strip ? 'midi-position-tab' : 'midi-hit-tab');
  } else {
    ctx.el('hit-panel').removeAttribute('role');
    ctx.el('hit-panel').removeAttribute('aria-labelledby');
  }
}

export function renderBinding(ctx: BindingEditorContext): void {
  renderControlTabs(ctx);
  if (ctx.session.selection.size !== 1 || ctx.session.pendingPaste) { ctx.renderBatch(); return; }
  ctx.session.batchChanges = {}; ctx.session.singleDraft = null;
  ctx.el('action').closest('label')!.hidden = false;
  ctx.el('binding-form').hidden = ctx.session.selected === ctx.session.profile.modeSelector;
  ctx.el('selected').textContent = controlName(ctx.session.selected);
  ctx.session.bindingDirty = false;
  ctx.el('draft-state').textContent = t('applied'); ctx.el('draft-state').classList.remove('unsaved');
  ctx.el('hit-heading').textContent = isPad(ctx.session.selected) ? t('pad_hit_strike') : ctx.session.selected === 'SMART_STRIP' ? t('strip_position_position') : 'MIDI OUTPUT';
  const press = isPad(ctx.session.selected) ? ctx.currentMode().pressureBindings?.[ctx.session.selected] : undefined;
  const touch = ctx.session.selected === 'SMART_STRIP' ? ctx.currentMode().bindings.SMART_STRIP_TOUCH : undefined;
  ctx.el('binding-summary').textContent = ctx.controlSummary(ctx.session.selected);
  const continuous = ctx.session.selected === 'ENCODER_ROTATE' || ctx.session.selected === 'SMART_STRIP';
  const actions = ctx.session.selected === 'SMART_STRIP'
    ? [['none', t('disabled')], ['cc', 'MIDI CC'], ['poly-pressure', 'Poly Pressure'], ['channel-pressure', 'Channel Pressure'], ['program', 'Program Change'], ['pitchbend', 'Pitchbend']]
    : continuous ? [['none', t('disabled')], ['cc', 'MIDI CC']] : isPad(ctx.session.selected)
      ? [['none', t('disabled')], ['note', 'MIDI Note'], ['cc', 'MIDI CC'], ['poly-pressure', 'Poly Pressure'], ['channel-pressure', 'Channel Pressure'], ['program', 'Program Change'], ['pitchbend', 'Pitchbend'], ['mode', t('switch_mode')]]
      : [['none', t('disabled')], ['note', 'MIDI Note'], ['cc', 'MIDI CC'], ['poly-pressure', 'Poly Pressure'], ['channel-pressure', 'Channel Pressure'], ['program', 'Program Change'], ['pitchbend', 'Pitchbend'], ['mode', t('switch_mode')]];
  if (MODE_SELECTOR_BUTTONS.includes(ctx.session.selected as Profile['modeSelector']) && ctx.session.selected !== ctx.session.profile.modeSelector) actions.push(['fixed-velocity', t('fixed_velocity_output')]);
  const selector = ctx.session.selected === ctx.session.profile.modeSelector;
  ctx.el<HTMLSelectElement>('action').disabled = selector;
  ctx.el<HTMLSelectElement>('action').innerHTML = actions.map(([id, label]) => `<option value="${id}" ${labelAttributes(label)}>${label}</option>`).join('');
  const b = ctx.currentMode().bindings[ctx.session.selected];
  ctx.el<HTMLSelectElement>('action').value = b?.type === 'strip-position' || b?.type === 'button-value' ? b.output : b?.type ?? 'none';
  renderFields(ctx, b); ctx.renderTouchFields(touch); ctx.renderPressFields(press); ctx.renderSaveState();
  if (selector) ctx.el('binding-help').textContent = t('mode_selector_hint');
}

export function syncCcFields(ctx: BindingEditorContext, container: 'fields' | 'strip-touch', prefix: string): void {
  const root = ctx.el(container);
  const style = (document.getElementById(`bind-${prefix}style`) as HTMLSelectElement).value;
  root.querySelectorAll<HTMLElement>('[data-cc-fields]').forEach(label => {
    const show = label.dataset.ccFields!.split(' ').includes(style);
    label.hidden = !show;
    label.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input,select').forEach(input => { input.disabled = !show; });
  });
}

export function syncNoteFields(ctx: BindingEditorContext): void {
  const toggle = (document.getElementById('bind-note-mode') as HTMLSelectElement).value === 'toggle';
  const label = document.getElementById('bind-note-action-on')?.closest('label');
  if (!label) return;
  label.hidden = !toggle;
  (document.getElementById('bind-note-action-on') as HTMLSelectElement).disabled = !toggle;
}

export function renderFields(ctx: BindingEditorContext, existing?: Binding, lightDraft?: PadLight, stripDraft?: { mode: StripLightMode; brightness: Brightness; color?: number; hold?: boolean }): void {
  const action = ctx.el<HTMLSelectElement>('action').value;
  const b = existing?.type === action || (existing?.type === 'strip-position' || existing?.type === 'button-value') && existing.output === action ? existing : undefined;
  let fields = '';
  if (action !== 'none' && action !== 'mode' && action !== 'fixed-velocity') fields += field('channel', 'MIDI Channel', b && 'channel' in b ? b.channel : 1, 1, 16);
  if (action === 'note') {
    const note = b?.type === 'note' ? b : undefined;
    fields += ctx.noteField('note', 'Note Number', note?.note ?? 36);
    const pad = isPad(ctx.session.selected);
    fields += '<label>Mode<select id="bind-note-mode"><option value="gate">Gate</option><option value="toggle">Toggle</option></select></label>';
    if (pad) fields += padVelocityFields(note);
    if (!pad) fields += `<label>Action on<select id="bind-note-action-on"><option value="down" data-i18n="press">${t('press')}</option><option value="up" data-i18n="release">${t('release')}</option></select></label>`;
    ctx.el('fields').innerHTML = fields;
    (document.getElementById('bind-note-mode') as HTMLSelectElement).value = note?.mode ?? 'gate';
    if (!pad) (document.getElementById('bind-note-action-on') as HTMLSelectElement).value = note?.actionOn ?? 'down';
    syncNoteFields(ctx);
  } else {
    if (action === 'cc') {
      const cc = b?.type === 'cc' ? b : undefined;
      fields += field('controller', 'CC Number', cc?.controller ?? 1);
      if (ctx.session.selected === 'ENCODER_ROTATE') {
        fields += encoderFields(cc);
      } else if (ctx.session.selected === 'SMART_STRIP') {
        fields += stripPositionCcFields(cc);
      } else {
        fields += ccFields('', cc, 127, !isPad(ctx.session.selected));
      }
    } else if (ctx.session.selected === 'SMART_STRIP' && ['poly-pressure', 'channel-pressure', 'program', 'pitchbend'].includes(action)) {
      const position = b?.type === 'strip-position' ? b : undefined;
      const max = action === 'pitchbend' ? 16383 : 127;
      if (action === 'poly-pressure') fields += ctx.noteField('note', 'Note Number', position?.note ?? 36);
      fields += field('from', 'Range From', position?.from ?? 0, 0, max) + field('to', 'Range To', position?.to ?? max, 0, max);
    } else if (['poly-pressure', 'channel-pressure', 'program', 'pitchbend'].includes(action)) {
      const button = b?.type === 'button-value' ? b : b?.type === 'program' && action === 'program'
        ? { type: 'button-value' as const, channel: b.channel, output: 'program' as const, mode: 'trigger' as const, value: b.program } : undefined;
      if (action === 'poly-pressure') fields += ctx.noteField('note', 'Note Number', button?.note ?? 36);
      fields += ccFields('', button, action === 'pitchbend' ? 16383 : 127, !isPad(ctx.session.selected));
    } else if (action === 'fixed-velocity') {
      fields += field('fixed-velocity', t('fixed_velocity_value'), b?.type === 'fixed-velocity' ? b.velocity : 127, 1, 127);
      fields += `<p class="caption fixed-velocity-hint">${l('fixed_velocity_hint', {})}</p>`;
    } else if (action === 'mode') fields += `<label>${l('target_mode', {})}<select id="bind-mode">${ctx.session.profile.modes.map(m => `<option value="${html(m.id)}">${html(m.name)}</option>`).join('')}</select></label>`;
    ctx.el('fields').innerHTML = fields;
    if (b?.type === 'mode') (document.getElementById('bind-mode') as HTMLSelectElement).value = b.modeId;
    if (action === 'cc' && ctx.session.selected !== 'ENCODER_ROTATE' && ctx.session.selected !== 'SMART_STRIP') {
      (document.getElementById('bind-style') as HTMLSelectElement).value = b?.type === 'cc' ? b.style : 'momentary';
      if (!isPad(ctx.session.selected)) (document.getElementById('bind-action-on') as HTMLSelectElement).value = b?.type === 'cc' && 'actionOn' in b ? b.actionOn ?? 'down' : 'down';
      syncCcFields(ctx, 'fields', '');
    }
    if (['poly-pressure', 'channel-pressure', 'program', 'pitchbend'].includes(action) && ctx.session.selected !== 'SMART_STRIP') {
      const button = b?.type === 'button-value' ? b : undefined;
      (document.getElementById('bind-style') as HTMLSelectElement).value = button?.mode === 'gate' ? 'momentary' : button?.mode ?? (b?.type === 'program' ? 'trigger' : 'momentary');
      if (!isPad(ctx.session.selected)) (document.getElementById('bind-action-on') as HTMLSelectElement).value = button?.actionOn ?? 'down';
      syncCcFields(ctx, 'fields', '');
    }
    if (action === 'cc' && ctx.session.selected === 'SMART_STRIP') {
      (document.getElementById('bind-strip-mode') as HTMLSelectElement).value = b?.type === 'cc' && b.style === 'strip' ? b.mode ?? 'absolute' : 'absolute';
      ctx.syncStripCcFields();
    }
  }
  const index = isPad(ctx.session.selected) ? Number(ctx.session.selected.slice(4)) - 1 : -1;
  const light = lightDraft ?? ctx.currentMode().pads[index];
  const stripLight = ctx.session.selected === 'SMART_STRIP' ? stripDraft ?? ctx.currentMode().stripLight ?? { mode: 'dot', brightness: 'normal' } : null;
  ctx.el('pad-light').innerHTML = light ? padLightFields() : stripLight ? stripLightFields(stripLight) : '';
  if (light) {
    (document.getElementById('bind-color-mode') as HTMLSelectElement).value = light.onColor === undefined ? 'single' : 'dual';
    (document.getElementById('bind-color') as HTMLSelectElement).value = String(light.color);
    (document.getElementById('bind-on-color') as HTMLSelectElement).value = String(light.onColor ?? light.color);
    syncPadColorFields(ctx);
  }
  if (stripLight) {
    (document.getElementById('bind-strip-led-mode') as HTMLSelectElement).value = stripLight.mode;
    (document.getElementById('bind-strip-led-color') as HTMLSelectElement).value = String(stripLight.color ?? 17);
  }
  ctx.noteInputs?.refresh();
  renderHelp(ctx);
}

export function renderHelp(ctx: BindingEditorContext): void {
  if (ctx.session.selection.has(ctx.session.profile.modeSelector)) { ctx.el('binding-help').textContent = t('mode_selector_hint'); return; }
  ctx.el('binding-help').textContent = ctx.session.selected === 'ENCODER_ROTATE'
    ? t('input_keeps_the_raw_counter_difference_rust_defines_no_wrap_range_the_de')
    : ctx.session.selected === 'SMART_STRIP' ? t('hardware_observations_0_is_release_1_is_leftmost_and_200_is_rightmost_co')
      : isPad(ctx.session.selected) ? t('hit_note_applies_the_velocity_curve_before_scaling_to_the_output_range_e')
        : t('apply_updates_this_mode_s_control_and_saves_the_entire_profile_note_numb');
}

/** Snapshot canonical form values; incomplete strings stay editable and serializable. */
export function captureDraft(ctx: BindingEditorContext): void {
  if (ctx.session.selection.size !== 1 || ctx.session.pendingPaste) return;
  const values = Object.fromEntries([...ctx.el('binding-form').querySelectorAll<HTMLInputElement | HTMLSelectElement>('[id^="bind-"]')]
    .map(input => [input.id.slice(5), input instanceof HTMLInputElement && input.type === 'checkbox' ? input.checked : input.value]));
  ctx.session.setSingleDraft(ctx.el<HTMLSelectElement>('action').value, values);
}

export function readDraft(ctx: BindingEditorContext): Profile {
  captureDraft(ctx);
  const draft = ctx.session.singleDraft!;
  const val = (id: string) => String(draft.values[id] ?? '');
  return readBindingDraft(ctx.session.profile, ctx.session.editorModeId, ctx.session.selected, draft.action,
    { val, num: id => Number(val(id)), checked: id => draft.values[id] === true });
}

export function syncPadColorFields(ctx: BindingEditorContext): void {
  const dual = (document.getElementById('bind-color-mode') as HTMLSelectElement | null)?.value === 'dual';
  const label = ctx.el('pad-light').querySelector<HTMLElement>('[data-pad-dual]');
  if (label) {
    label.hidden = !dual;
    label.querySelector<HTMLSelectElement>('select')!.disabled = !dual;
  }
}

export function readPadLightDraft(ctx: BindingEditorContext): PadLight | null {
  if (ctx.session.selection.size !== 1 || !isPad(ctx.session.selected)) return null;
  const colorInput = document.getElementById('bind-color') as HTMLSelectElement | null;
  if (!colorInput) return null;
  const color = Number(colorInput.value);
  const dual = (document.getElementById('bind-color-mode') as HTMLSelectElement | null)?.value === 'dual';
  const onColor = dual ? Number((document.getElementById('bind-on-color') as HTMLSelectElement | null)?.value) : undefined;
  const brightness = ctx.currentMode().pads[Number(ctx.session.selected.slice(4)) - 1].brightness;
  if (!Number.isInteger(color) || color < 0 || color >= PAD_COLORS.length ||
    onColor !== undefined && (!Number.isInteger(onColor) || onColor < 0 || onColor >= PAD_COLORS.length) ||
    !['off', 'dim', 'normal', 'bright'].includes(brightness)) return null;
  return { color, onColor, brightness };
}

export function readStripLightDraft(ctx: BindingEditorContext): { mode: StripLightMode; brightness: Brightness; color?: number; hold?: boolean; } | null {
  if (ctx.session.selected !== 'SMART_STRIP') return null;
  const mode = (document.getElementById('bind-strip-led-mode') as HTMLSelectElement | null)?.value as StripLightMode | undefined;
  const brightness = (document.getElementById('bind-strip-led-brightness') as HTMLSelectElement | null)?.value as Brightness | undefined;
  const colorValue = (document.getElementById('bind-strip-led-color') as HTMLSelectElement | null)?.value;
  return mode && brightness ? { mode, brightness, color: colorValue === undefined ? 17 : Number(colorValue), hold: (document.getElementById('bind-strip-led-hold') as HTMLInputElement | null)?.checked ?? false } : null;
}

