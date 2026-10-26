import {
  MODE_TRIGGER_BUTTONS,
  PAD_COLORS,
  PAD_IDS,
  createMode,
  parseProfile,
  type ControlId, type Profile
} from '@midiy/mikro-core';
import { formatError, t } from '../../../i18n/index';
import { confirmAction } from '../../../shared/dialogs';
import { TranslatorRuntime } from '../runtime';
import { EditorSession } from './editor-session';
import { ProfileLibrary } from './profile-library';

import type { Mode } from '@midiy/mikro-core';
import type { TranslatorOptions } from './view-contracts';
import { PAD_PREVIEW, controlName, html, isPad } from './view-helpers';
export interface ProfileModePanelContext {
  applyBinding: () => void;
  commit: () => boolean;
  currentMode: () => Mode;
  discardBindingDraft: () => Promise<boolean>;
  el: <T extends HTMLElement = HTMLElement>(id: string) => T;
  ensureEditorMode: () => void;
  guard: (action: () => void | Promise<void>) => Promise<void>;
  library: ProfileLibrary;
  options: TranslatorOptions;
  queueModeLights: () => void;
  renderBinding: () => void;
  renderEditActions: () => void;
  renderLedSettings: () => void;
  renderMap: () => void;
  renderPressed: () => void;
  runtime: TranslatorRuntime;
  session: EditorSession;
}

export function mountProfiles(ctx: ProfileModePanelContext): void {
  for (const scope of ['profile', 'mode'] as const) {
    ctx.el(`${scope}-cancel`).addEventListener('click', () => cancelRename(ctx, scope));
    ctx.el(`${scope}-new`).addEventListener('click', () => ctx.guard(() => addBlank(ctx, scope)));
  }
  ctx.el('mode-trigger').addEventListener('change', () => ctx.guard(() => setModeTrigger(ctx, ctx.el<HTMLSelectElement>('mode-trigger').value as ControlId | '')));
  ctx.el('clear-trigger').addEventListener('click', () => ctx.guard(() => setModeTrigger(ctx, '')));
  ctx.el('profile-name').addEventListener('input', () => { ctx.session.profileDirty = true; renderSaveState(ctx); });
  ctx.el('mode-name').addEventListener('input', () => { ctx.session.profileDirty = true; renderSaveState(ctx); });
  ctx.el('profile-edit').addEventListener('click', () => {
    if (ctx.session.editingMode) return ctx.options.toast(t('save_the_mode_name_first'));
    ctx.session.editingProfile = true; renderEditStates(ctx); ctx.el<HTMLInputElement>('profile-name').focus();
  });
  ctx.el('profile-duplicate').addEventListener('click', () => ctx.guard(async () => {
    if (ctx.session.editingMode) return ctx.options.toast(t('save_the_mode_name_first'));
    if (!await ctx.discardBindingDraft()) return;
    const copy = parseProfile(ctx.session.profile); copy.name = `${copy.name} copy`;
    ctx.library.save(copy, true); loadProfile(ctx, copy, false);
    ctx.session.editingProfile = true; renderEditStates(ctx); ctx.el<HTMLInputElement>('profile-name').focus();
    ctx.el<HTMLInputElement>('profile-name').select();
  }));
  ctx.el('profile-delete').addEventListener('click', () => ctx.guard(async () => {
    if (ctx.library.entries.length <= 1) return ctx.options.toast(t('keep_at_least_one_profile'));
    if (!await confirmAction(t('delete_profile_and_all_its_modes', { p0: ctx.session.profile.name }), t('delete_profile'))) return;
    loadProfile(ctx, ctx.library.deleteActive(), false);
  }));
  ctx.el('profile-name').addEventListener('keydown', event => {
    if (event.key === 'Enter') { event.preventDefault(); save(ctx); }
    if (event.key === 'Escape') { cancelRename(ctx, 'profile'); }
  });
  ctx.el('library').addEventListener('change', () => ctx.guard(async () => {
    const id = ctx.el<HTMLSelectElement>('library').value;
    if ((ctx.session.profileDirty || ctx.session.bindingDirty) && !await confirmAction(t('this_profile_has_unsaved_changes_discard_them_and_load_the_selected_prof'), t('discard_load'))) return renderLibrary(ctx);
    try { loadProfile(ctx, ctx.library.select(id), false); } finally { renderLibrary(ctx); }
  }));
  ctx.el('mode').addEventListener('change', async () => {
    if (!await ctx.discardBindingDraft()) { renderModes(ctx); return; }
    ctx.session.editorModeId = ctx.el<HTMLSelectElement>('mode').value;
    renderModes(ctx); ctx.renderBinding(); ctx.renderMap(); ctx.renderPressed(); ctx.queueModeLights();
  });
  ctx.el('mode-edit').addEventListener('click', () => {
    if (ctx.session.editingProfile) return ctx.options.toast(t('save_the_profile_name_first'));
    ctx.session.editingMode = true; renderEditStates(ctx); ctx.el<HTMLInputElement>('mode-name').focus();
  });
  ctx.el('mode-save').addEventListener('click', () => saveModeEdit(ctx));
  ctx.el('mode-name').addEventListener('keydown', event => {
    if (event.key === 'Enter') { event.preventDefault(); saveModeEdit(ctx); }
    if (event.key === 'Escape') { cancelRename(ctx, 'mode'); }
  });
  ctx.el('add-mode').addEventListener('click', async () => {
    if (ctx.session.editingProfile) return ctx.options.toast(t('save_the_profile_name_first'));
    if (!await ctx.discardBindingDraft()) return;
    if (ctx.session.profile.modes.length >= 64) return ctx.options.toast(t('up_to_64_modes_are_supported'));
    const copy = JSON.parse(JSON.stringify(ctx.currentMode()));
    copy.id = crypto.randomUUID(); copy.name = `${copy.name} copy`; copy.selectorPad = null; delete copy.selectorButton;
    ctx.session.profile.modes.push(copy); ctx.session.editorModeId = copy.id; ctx.commit();
    renderModes(ctx); ctx.renderBinding(); ctx.renderMap(); ctx.renderPressed(); ctx.queueModeLights();
    ctx.session.editingMode = true; renderEditStates(ctx); ctx.el<HTMLInputElement>('mode-name').focus();
    ctx.el<HTMLInputElement>('mode-name').select();
  });
  ctx.el('delete-mode').addEventListener('click', async () => {
    if (!await ctx.discardBindingDraft()) return;
    if (ctx.session.profile.modes.length === 1) return ctx.options.toast(t('keep_at_least_one_mode'));
    if (!await confirmAction(t('delete_mode_actions_targeting_this_mode_will_be_disabled', { p0: ctx.currentMode().name }), t('delete_mode'))) return;
    const removed = ctx.session.editorModeId;
    ctx.session.profile.modes = ctx.session.profile.modes.filter(m => m.id !== removed);
    for (const mode of ctx.session.profile.modes) for (const [id, binding] of Object.entries(mode.bindings)) {
      if (binding?.type === 'mode' && binding.modeId === removed) delete mode.bindings[id as ControlId];
    }
    if (ctx.session.profile.initialModeId === removed) ctx.session.profile.initialModeId = ctx.session.profile.modes[0].id;
    ctx.session.editingMode = false; ctx.commit(); ctx.renderBinding(); renderEditStates(ctx);
  });
  ctx.el('mode-color').addEventListener('change', () => ctx.guard(() => {
    if (!ctx.currentMode().selectorPad) return renderModes(ctx);
    const next = parseProfile(ctx.session.profile);
    next.modes.find(mode => mode.id === ctx.session.editorModeId)!.color = Number(ctx.el<HTMLSelectElement>('mode-color').value);
    try {
      ctx.library.save(next); ctx.session.profile = next; ctx.session.history.record(next);
      ctx.runtime.updateFeedback(next); renderSaveState(ctx);
    } finally { renderModes(ctx); }
  }));
  ctx.el('mode-selector').addEventListener('change', () => ctx.guard(async () => {
    const key = ctx.el<HTMLSelectElement>('mode-selector').value as Profile['modeSelector'];
    if (!await ctx.discardBindingDraft()) return renderModes(ctx);
    const next = parseProfile(ctx.session.profile);
    if (next.modes.some(mode => mode.selectorButton === key)) return renderModes(ctx);
    if (next.modes.some(mode => mode.bindings[key] && mode.bindings[key]?.type !== 'none')
      && !await confirmAction(t('replace_selector_binding'), t('mode_selector_key'))) return renderModes(ctx);
    next.modeSelector = key;
    for (const mode of next.modes) delete mode.bindings[key];
    ctx.session.profile = parseProfile(next); ctx.commit(); ctx.renderBinding();
  }));
  ctx.el('initial').addEventListener('change', () => {
    if (ctx.el<HTMLInputElement>('initial').checked) { ctx.session.profile.initialModeId = ctx.session.editorModeId; ctx.commit(); }
    else renderModes(ctx);
  });
  ctx.el('save').addEventListener('click', () => save(ctx));
  ctx.el('export').addEventListener('click', () => {
    if (ctx.session.editingMode) return ctx.options.toast(t('save_the_mode_name_first'));
    if (!applyPending(ctx)) return;
    const a = document.createElement('a'), url = URL.createObjectURL(new Blob([JSON.stringify(ctx.session.profile, null, 2)], { type: 'application/json' }));
    a.href = url; a.download = 'midiy-profile.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  ctx.el('import').addEventListener('change', event => ctx.guard(async () => {
    const input = event.target as HTMLInputElement, file = input.files?.[0]; input.value = '';
    if (!file) return;
    if (file.size > 1024 * 1024) throw new Error(t('midi_profile_exceeds_1_mb'));
    const next = parseProfile(JSON.parse(await file.text()));
    if (!await confirmAction(t('import_creates_and_selects_a_new_profile_capture_sessions_are_unaffected'), t('import_profile'))) return;
    ctx.library.save(next, true); loadProfile(ctx, next, false);
    ctx.options.toast(t('imported_and_saved_as_a_new_profile'));
  }));
}

export function renderLibrary(ctx: ProfileModePanelContext): void {
  ctx.el<HTMLSelectElement>('library').innerHTML = (ctx.library.activeId ? '' : `<option value="" data-i18n="newly_imported_profile">${t('newly_imported_profile')}</option>`) + ctx.library.entries.map(e => `<option value="${html(e.id)}">${html(e.profile.name)}</option>`).join('');
  ctx.el<HTMLSelectElement>('library').value = ctx.library.activeId;
}

export function renderEditStates(ctx: ProfileModePanelContext): void {
  for (const [id, hidden] of [
    ['library', ctx.session.editingProfile], ['profile-name', !ctx.session.editingProfile],
    ['profile-edit', ctx.session.editingProfile], ['profile-duplicate', ctx.session.editingProfile],
    ['profile-new', ctx.session.editingProfile], ['profile-cancel', !ctx.session.editingProfile],
    ['save', !ctx.session.editingProfile], ['profile-delete', !ctx.session.editingProfile],
    ['mode', ctx.session.editingMode], ['mode-name', !ctx.session.editingMode],
    ['mode-edit', ctx.session.editingMode], ['add-mode', ctx.session.editingMode],
    ['mode-new', ctx.session.editingMode], ['mode-cancel', !ctx.session.editingMode],
    ['mode-save', !ctx.session.editingMode], ['delete-mode', !ctx.session.editingMode]
  ] as [string, boolean][]) ctx.el(id).hidden = hidden;
  ctx.el<HTMLButtonElement>('profile-delete').disabled = ctx.library.entries.length <= 1;
  ctx.el<HTMLButtonElement>('delete-mode').disabled = ctx.session.profile.modes.length <= 1;
  if (ctx.session.editingProfile) ctx.el<HTMLInputElement>('profile-name').value = ctx.session.profile.name;
  if (ctx.session.editingMode) ctx.el<HTMLInputElement>('mode-name').value = ctx.currentMode().name;
}

export function renderSaveState(ctx: ProfileModePanelContext): void {
  ctx.el('save-status').textContent = ctx.session.profileDirty || ctx.session.bindingDirty ? t('unsaved_changes') : ctx.library.persisted ? t('saved_in_this_browser') : t('built_in_default_saves_automatically_after_your_first_edit');
  ctx.el('save-status').classList.toggle('unsaved', ctx.session.profileDirty || ctx.session.bindingDirty);
  ctx.renderEditActions();
}

export function loadProfile(ctx: ProfileModePanelContext, profile: Profile, dirty: boolean): void {
  ctx.session.load(profile, dirty); ctx.runtime.applyProfile(ctx.session.profile, true);
  ctx.el<HTMLInputElement>('profile-name').value = ctx.session.profile.name;
  renderLibrary(ctx); renderModes(ctx); renderEditStates(ctx); ctx.renderBinding(); ctx.renderMap(); renderSaveState(ctx); ctx.queueModeLights();
}

export function renderPlayingMode(ctx: ProfileModePanelContext): void {
  const name = ctx.session.profile.modes.find(mode => mode.id === ctx.runtime.activeModeId)?.name ?? '';
  ctx.el('playing-mode').textContent = t('playing_mode', { p0: name });
  ctx.el('mode').title = t('edit_mode_only');
}

export async function setModeTrigger(ctx: ProfileModePanelContext, control: ControlId | ''): Promise<void> {
  if (control && (control === ctx.session.profile.modeSelector || !isPad(control) && !MODE_TRIGGER_BUTTONS.includes(control as typeof MODE_TRIGGER_BUTTONS[number])
    || ctx.session.profile.modes.some(mode => mode.id !== ctx.session.editorModeId && (mode.selectorButton ?? mode.selectorPad) === control))) return renderTriggerPicker(ctx);
  if (!await ctx.discardBindingDraft()) return renderTriggerPicker(ctx);
  const next = parseProfile(ctx.session.profile), mode = next.modes.find(mode => mode.id === ctx.session.editorModeId)!;
  mode.selectorPad = control && isPad(control) ? control : null;
  if (control && !isPad(control)) mode.selectorButton = control as NonNullable<typeof mode.selectorButton>;
  else delete mode.selectorButton;
  ctx.session.profile = parseProfile(next); ctx.commit(); ctx.renderBinding();
}

export function renderTriggerPicker(ctx: ProfileModePanelContext): void {
  const picker = ctx.el<HTMLSelectElement>('mode-trigger');
  picker.innerHTML = `<option value="">${t('unassigned_mode_pad')}</option>` + [...PAD_IDS, ...MODE_TRIGGER_BUTTONS].filter(id => id !== ctx.session.profile.modeSelector).map(id => {
    const owner = ctx.session.profile.modes.find(mode => (mode.selectorButton ?? mode.selectorPad) === id);
    const occupied = owner && owner.id !== ctx.session.editorModeId;
    return `<option value="${id}" ${occupied ? 'disabled' : ''}>${html(controlName(id))}${occupied ? ` · ${html(owner.name)} (${t('assigned_mode_pad')})` : ''}</option>`;
  }).join('');
  picker.value = ctx.currentMode().selectorButton ?? ctx.currentMode().selectorPad ?? '';
  ctx.el<HTMLButtonElement>('clear-trigger').disabled = !picker.value;
  const owner = ctx.session.profile.modes.find(mode => (mode.selectorButton ?? mode.selectorPad) === ctx.session.selected);
  ctx.el('mode-selection-status').textContent = ctx.session.selection.size === 1 ? t('mode_selection_status', { p0: controlName(ctx.session.selected), p1: owner?.name ?? t('unassigned_mode_pad') }) : t('selected_control_count', { p0: ctx.session.selection.size });
}

export function renderModeShortcut(ctx: ProfileModePanelContext): void {
  const mode = ctx.currentMode(), control = mode.selectorButton ?? mode.selectorPad;
  ctx.el('mode-shortcut').textContent = control ? `${controlName(ctx.session.profile.modeSelector)} + ${controlName(control)}` : t('unassigned_mode_pad');
}

export function renderModes(ctx: ProfileModePanelContext): void {
  ctx.ensureEditorMode(); renderPlayingMode(ctx);
  renderModeShortcut(ctx);
  ctx.el<HTMLSelectElement>('mode').innerHTML = ctx.session.profile.modes.map(m => `<option value="${html(m.id)}">${html(m.name)}</option>`).join('');
  ctx.el<HTMLSelectElement>('mode').value = ctx.session.editorModeId;
  if (!ctx.session.editingProfile) ctx.el<HTMLInputElement>('profile-name').value = ctx.session.profile.name;
  if (!ctx.session.editingMode) ctx.el<HTMLInputElement>('mode-name').value = ctx.currentMode().name;
  const mode = ctx.currentMode();
  ctx.el('mode-title').textContent = mode.name;
  ctx.el<HTMLSelectElement>('mode-selector').value = ctx.session.profile.modeSelector;
  for (const option of ctx.el<HTMLSelectElement>('mode-selector').options) option.disabled = ctx.session.profile.modes.some(candidate => candidate.selectorButton === option.value);
  renderTriggerPicker(ctx);
  const colorSelect = ctx.el<HTMLSelectElement>('mode-color');
  colorSelect.disabled = mode.selectorPad === null;
  colorSelect.innerHTML = mode.selectorPad === null
    ? `<option value="" data-i18n="mode_color_unavailable">${t('mode_color_unavailable')}</option>`
    : PAD_COLORS.map((name, i) => `<option value="${i}">${name}</option>`).join('');
  colorSelect.value = mode.selectorPad === null ? '' : String(mode.color);
  colorSelect.style.setProperty('--mode-color', mode.selectorPad === null ? 'transparent' : PAD_PREVIEW[mode.color]);
  ctx.el<HTMLInputElement>('initial').checked = ctx.session.profile.initialModeId === ctx.session.editorModeId;
  ctx.el<HTMLInputElement>('initial').disabled = ctx.session.profile.initialModeId === ctx.session.editorModeId;
  ctx.renderLedSettings();
}

export function cancelRename(ctx: ProfileModePanelContext, scope: 'profile' | 'mode'): void {
  if (scope === 'profile') ctx.session.editingProfile = false;
  else ctx.session.editingMode = false;
  ctx.el<HTMLInputElement>(`${scope}-name`).value = scope === 'profile' ? ctx.session.profile.name : ctx.currentMode().name;
  ctx.session.profileDirty = false; renderEditStates(ctx); renderSaveState(ctx);
}

export async function addBlank(ctx: ProfileModePanelContext, scope: 'profile' | 'mode'): Promise<void> {
  if (ctx.session.editingProfile || ctx.session.editingMode) return ctx.options.toast(t(ctx.session.editingProfile ? 'save_the_profile_name_first' : 'save_the_mode_name_first'));
  if (!await ctx.discardBindingDraft()) return;
  if (scope === 'mode' && ctx.session.profile.modes.length >= 64) return ctx.options.toast(t('up_to_64_modes_are_supported'));
  const mode = createMode(crypto.randomUUID(), t('new_mode'));
  mode.bindings = {};
  if (scope === 'profile') {
    const profile: Profile = { schema: 'midiy-profile-v2', name: t('new_profile'), modeSelector: 'GROUP', padVelocityCurve: 'linear', initialModeId: mode.id, modes: [mode] };
    ctx.library.save(profile, true); loadProfile(ctx, profile, false); ctx.session.editingProfile = true;
  } else {
    const next = parseProfile(ctx.session.profile); next.modes.push(mode);
    ctx.library.save(next); ctx.session.profile = next; ctx.session.editorModeId = mode.id; ctx.runtime.applyProfile(next); ctx.session.history.record(next);
    ctx.session.editingMode = true;
    renderModes(ctx); ctx.renderBinding(); ctx.renderMap();
  }
  renderEditStates(ctx); renderSaveState(ctx);
  ctx.el<HTMLInputElement>(`${scope}-name`).focus(); ctx.el<HTMLInputElement>(`${scope}-name`).select();
}

export function saveModeEdit(ctx: ProfileModePanelContext): void {
  const name = ctx.el<HTMLInputElement>('mode-name').value.trim();
  if (!name) return ctx.options.toast(t('enter_a_mode_name'));
  ctx.currentMode().name = name; ctx.session.editingMode = false;
  const saved = ctx.commit();
  if (!saved) ctx.session.editingMode = true;
  renderEditStates(ctx);
}

export function save(ctx: ProfileModePanelContext): void {
  const name = ctx.el<HTMLInputElement>('profile-name').value.trim();
  if (!name) return ctx.options.toast(t('enter_a_profile_name'));
  ctx.session.profile.name = name;
  try {
    ctx.library.save(ctx.session.profile); ctx.session.history.record(ctx.session.profile); ctx.session.profileDirty = false; ctx.session.editingProfile = false;
    renderLibrary(ctx); renderEditStates(ctx); renderSaveState(ctx);
    ctx.options.toast(t('profile_saved'));
  } catch (error) { ctx.options.toast(t('could_not_save', { p0: formatError(error) })); }
}

export function applyPending(ctx: ProfileModePanelContext): boolean {
  if (ctx.session.bindingDirty) {
    if (!ctx.el<HTMLFormElement>('binding-form').reportValidity()) return false;
    try { ctx.applyBinding(); } catch (error) { ctx.options.toast(formatError(error)); return false; }
  }
  const name = ctx.el<HTMLInputElement>('profile-name').value.trim();
  if (!name) { ctx.options.toast(t('enter_a_profile_name')); ctx.el('profile-name').focus(); return false; }
  ctx.session.profile.name = name; return true;
}

