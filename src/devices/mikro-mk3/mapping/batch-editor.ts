import {
  PAD_COLORS,
  type ControlId
} from '@midiy/mikro-core';
import { l, labelMarkup, t } from '../../../i18n/index';
import { NotePreferences } from '../../../shared/notes/note-format';
import { NoteInputs, noteFieldMarkup } from '../../../shared/notes/note-input';
import { commonActions, commonFields, isPadControl, patchControls } from './editor-model';
import { EditorSession } from './editor-session';

import { controlName, html } from './view-helpers';
export interface BatchEditorContext {
  el: <T extends HTMLElement = HTMLElement>(id: string) => T;
  noteInputs: NoteInputs | undefined;
  notePreferences: NotePreferences;
  renderControlTabs: () => void;
  renderEditActions: () => void;
  readonly session: Readonly<Pick<EditorSession, 'batchChanges' | 'bindingDirty' | 'editorModeId' | 'pendingPaste' | 'profile' | 'selection'>>;
}

export function renderBatch(ctx: BatchEditorContext): void {
  ctx.renderControlTabs();
  const ids = [...ctx.session.selection];
  ctx.el('selected').textContent = t('selected_control_count', { p0: ids.length });
  ctx.el('binding-form').hidden = !ids.length || ids.includes(ctx.session.profile.modeSelector);
  ctx.el('binding-help').textContent = ids.includes(ctx.session.profile.modeSelector) ? t('mode_selector_hint') : '';
  ctx.el('binding-summary').textContent = ids.map(controlName).join(' · ');
  ctx.el('draft-state').textContent = ctx.session.bindingDirty ? t('not_applied') : t('applied');
  ctx.el('draft-state').classList.toggle('unsaved', ctx.session.bindingDirty);
  if (!ids.length) return;
  ctx.el('strip-touch').innerHTML = ''; ctx.el('pad-press').innerHTML = ''; ctx.el('pad-light').innerHTML = '';
  const actionSelect = ctx.el<HTMLSelectElement>('action');
  actionSelect.disabled = ids.includes(ctx.session.profile.modeSelector);
  actionSelect.closest('label')!.hidden = Boolean(ctx.session.pendingPaste);
  if (ctx.session.pendingPaste) {
    ctx.el('fields').innerHTML = `<p class="caption batch-hint">${l('paste_ready_to_apply', {})}</p>`;
    ctx.el('binding-help').textContent = ''; return;
  }
  let view = ctx.session.profile;
  try { view = patchControls(ctx.session.profile, ctx.session.editorModeId, ids, ctx.session.batchChanges); } catch { /* Keep incomplete draft editable; apply validates atomically. */ }
  const mode = view.modes.find(m => m.id === ctx.session.editorModeId)!;
  const actionOf = (id: ControlId) => { const binding = mode.bindings[id]; return binding?.type === 'button-value' || binding?.type === 'strip-position' ? binding.output : binding?.type ?? 'none'; };
  const action = ids.every(id => actionOf(id) === actionOf(ids[0])) ? actionOf(ids[0]) : '';
  const actionLabels: Record<string, string> = { none: t('disabled'), note: 'MIDI Note', cc: 'MIDI CC', mode: t('switch_mode'), 'poly-pressure': 'Poly Pressure', 'channel-pressure': 'Channel Pressure', program: 'Program Change', pitchbend: 'Pitchbend' };
  actionSelect.innerHTML = `<option value="" disabled>${t('multiple_values')}</option>` + commonActions(ids).map(value => `<option value="${value}">${actionLabels[value] ?? value}</option>`).join('');
  actionSelect.value = action;
  ctx.el('hit-heading').textContent = ids.every(isPadControl) ? t('pad_hit_strike') : 'MIDI OUTPUT';
  const fields = commonFields(view, ctx.session.editorModeId, ids);
  const fieldLabel = (label: string) => label.includes('_') ? t(label as Parameters<typeof t>[0]) : label;
  const sections: Record<string, string> = { hit: '', press: '', pad: '' };
  if (ids.every(isPadControl)) {
    const types = ids.map(id => mode.pressureBindings?.[id as `PAD_${number}`]?.type ?? 'off');
    const same = types.every(type => type === types[0]);
    sections.press = `<div class="editor-section-label">${l('pad_press_continuous_pressure')}</div><label>${l('pressure_action', {})}<select data-batch-key="pressAction"><option value="" disabled ${same ? '' : 'selected'}>${t('multiple_values')}</option>${['off', 'note', 'cc', 'poly-pressure', 'channel-pressure', 'pitchbend'].map(type => `<option value="${type}" ${same && types[0] === type ? 'selected' : ''}>${type === 'off' ? t('disabled') : type}</option>`).join('')}</select></label>`;
  }
  if (ids.every(isPadControl)) sections.pad = '<div class="editor-section-label">PAD LIGHT</div>';
  for (const field of fields) {
    const section = field.key.split('.')[0];
    const same = field.values.every(value => value === field.values[0]);
    const value = field.key in ctx.session.batchChanges ? ctx.session.batchChanges[field.key] : same ? field.values[0] : '';
    let options = field.options;
    if (field.key === 'pad.color' || field.key === 'pad.onColor') options = PAD_COLORS.map((label, value) => ({ label, value: String(value) }));
    if (field.key === 'pad.onColor' && ids.every(id => mode.pads[Number(id.slice(4)) - 1].onColor === undefined)) continue;
    if (field.key.endsWith('.note')) {
      sections[section] += noteFieldMarkup(`bind-batch-${field.key.replace('.', '-')}`, fieldLabel(field.label), value === '' ? '' : Number(value), ctx.notePreferences.current, field.key);
      continue;
    }
    sections[section] += `<label>${labelMarkup(fieldLabel(field.label))}${options
      ? `<select data-batch-key="${field.key}" data-batch-number="${field.key.startsWith('pad.') && field.key !== 'pad.dual' ? 'true' : 'false'}"><option value="" ${value === '' ? 'selected' : ''} disabled>${t('multiple_values')}</option>${options.map(option => `<option value="${html(option.value)}" ${String(value) === option.value ? 'selected' : ''}>${html(field.key === 'pad.dual' ? option.value === 'true' ? 'Dual' : 'Single' : option.label)}</option>`).join('')}</select>`
      : `<input type="number" data-batch-key="${field.key}" min="${field.min}" max="${field.max}" step="1" value="${html(value)}" placeholder="${t('multiple_values')}">`}</label>`;
  }
  ctx.el('fields').innerHTML = `<p class="caption batch-hint">${l('batch_edit_hint')}</p>` + sections.hit;
  ctx.el('pad-press').innerHTML = sections.press;
  ctx.el('pad-light').innerHTML = sections.pad;
  ctx.noteInputs?.refresh();
  ctx.el('binding-help').textContent = t('selection_shortcuts_hint');
  ctx.renderEditActions();
}

