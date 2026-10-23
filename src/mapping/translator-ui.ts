import { mappingShortcut, EditHistory, selectControls, controlsInRect, commonActions, commonFields, patchControls, copyControls, pasteControls, isPadControl, type ControlCopy } from './editor-model';
import { t, l, attribute, labelMarkup, labelAttributes, onLocaleChange, translateLabel, getLocale, formatError } from '../i18n/index';
import {
  PAD_VELOCITY_CURVES, type PadVelocityCurve, parseProfile, PAD_IDS, PAD_COLORS, BUTTON_IDS,
  type Binding, type Brightness, type ControlId, type Profile, type InputEvent, 
  type PadLight, type OutputReport, type PressureBinding, type StripLightMode
} from '@midiy/mikro-core';
import { TranslatorRuntime } from '../runtime/translator-runtime';
import { renderHardware } from '../devices/mikro-mk3/hardware-view.js';
import { getControl } from '../devices/mikro-mk3/controls.js';
import { ProfileLibrary } from './profile-library';
import { confirmAction } from '../shared/dialogs';

const PAD_PREVIEW = ['#666666', '#ef6262', '#ef914b', '#efac70', '#eab760', '#e4cd5c', '#a9d866', '#60be82', '#6bd0ad', '#71cdd9', '#52b1c8', '#749ee9', '#9d87c9', '#a087e4', '#b377d4', '#cf77bc', '#e979ae', '#e7e7df'];
const isPad = (id: ControlId): id is `PAD_${number}` => PAD_IDS.includes(id as `PAD_${number}`);
const brightnessOptions = (selected: Brightness) => ([['off', t('off')], ['dim', t('low')], ['normal', t('medium')], ['bright', t('high')]] as const)
  .map(([value, label]) => `<option value="${value}" ${labelAttributes(label)} ${selected === value ? 'selected' : ''}>${label}</option>`).join('');
const controlName = (id: ControlId) => translateLabel(getControl(id)?.label ?? id);
const html = (text: unknown) => String(text).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const field = (id: string, label: string, value: number, min = 0, max = 127) => `<label>${labelMarkup(label)}<input id="bind-${id}" type="number" min="${min}" max="${max}" value="${value}" required></label>`;
const ccFields = (prefix: string, binding?: Binding, max = 127, includeActionOn = true) => {
  const cc = binding?.type === 'cc' && !['strip', 'encoder'].includes(binding.style) ? binding : undefined;
  const other = binding?.type === 'button-value' ? binding : undefined;
  const state = cc ?? other;
  const style = cc?.style ?? (other?.mode === 'gate' ? 'momentary' : other?.mode) ?? 'momentary';
  const number = (name: string, label: string, value: number, min: number, max: number, styles: string) =>
    `<label data-cc-fields="${styles}">${labelMarkup(label)}<input id="bind-${prefix}${name}" type="number" min="${min}" max="${max}" value="${value}" required></label>`;
  return `<label>Mode<select id="bind-${prefix}style"><option value="momentary" data-i18n="gate_hold_release">${t('gate_hold_release')}</option><option value="toggle">Toggle</option><option value="trigger">Trigger</option><option value="inc">Inc</option></select></label>`
    + number('on', t('on_value'), state && 'on' in state ? state.on ?? max : max, 0, max, 'momentary toggle')
    + number('off', t('off_value'), state && 'off' in state ? state.off ?? 0 : 0, 0, max, 'momentary toggle')
    + number('value', t('trigger_value'), state && 'value' in state ? state.value ?? max : max, 0, max, 'trigger')
    + number('from', 'Range From', state && 'from' in state ? state.from ?? 0 : 0, 0, max, 'inc')
    + number('to', 'Range To', state && 'to' in state ? state.to ?? max : max, 0, max, 'inc')
    + number('step', 'Step', state && 'step' in state ? state.step ?? 1 : 1, -127, 127, 'inc')
    + `<label data-cc-fields="inc">Wrap<input id="bind-${prefix}wrap" type="checkbox" ${state && 'wrap' in state && state.wrap ? 'checked' : ''}></label>`
    + (includeActionOn ? `<label data-cc-fields="toggle trigger inc">Action on<select id="bind-${prefix}action-on"><option value="down" data-i18n="press">${t('press')}</option><option value="up" data-i18n="release">${t('release')}</option></select></label>` : '')
    + `<input type="hidden" id="bind-${prefix}initial-style" value="${style}">`;
};
export interface TranslatorOptions { toast: (message: string) => void }
export class TranslatorUI {
  private profile: Profile;
  private profileDirty = false;
  private bindingDirty = false;
  private editingProfile = false;
  private editingMode = false;
  private selected: ControlId = 'PAD_1';
  private selection = new Set<ControlId>(['PAD_1']);
  private batchChanges: Record<string, unknown> = {};
  private pendingPaste: Profile | null = null;
  private copied: ControlCopy[] = [];
  private history: EditHistory;
  private hardwareSelectionPending = false;
  private followHardwareSelection = false;
  private get activeModeId() { return this.runtime.activeModeId; }
  constructor(private readonly runtime: TranslatorRuntime, private readonly library: ProfileLibrary,
    private readonly options: TranslatorOptions) {
    this.profile = library.current; this.history = new EditHistory(this.profile);
    this.mount();
    let midiStatus = '', deviceStatus = '';
    runtime.subscribe(event => {
      if (event.type === 'state') {
        const midi = JSON.stringify(event.state.midi);
        const device = JSON.stringify([event.state.device, event.state.ledEnabled, event.state.ledStatus]);
        if (device !== deviceStatus) { deviceStatus = device; this.renderDevice(); }
        if (midi !== midiStatus) { midiStatus = midi; this.renderPorts(); }
        this.renderPressed(); this.queueModeLights(); this.previewBatch();
      } else if (event.type === 'decoded' && !event.handled) this.handleEvent(event.event);
      else if (event.type === 'mode') { this.pendingPaste = null; this.batchChanges = {}; this.bindingDirty = false; this.renderModes(); this.renderBinding(); this.renderMap(); }
    });
    onLocaleChange(() => {
      // Translate labels in place: never re-render forms or reset their dirty state.
      this.el('selected').textContent = this.selection.size === 1 ? controlName(this.selected) : t('selected_control_count', {p0: this.selection.size});
      this.el('draft-state').textContent = this.bindingDirty ? t('not_applied') : t('applied');
      this.el('hit-heading').textContent = isPad(this.selected) ? t('pad_hit_strike') : this.selected === 'SMART_STRIP' ? t('strip_position_position') : 'MIDI OUTPUT';
      this.el('binding-summary').textContent = this.controlSummary(this.selected);
      this.renderHelp(); this.renderSaveState(); this.renderPorts(); this.renderDevice();
      this.renderMap(); this.renderPressed();
      if (this.bindingDirty) this.previewPadLight();
    });
    if (library.warning) options.toast(translateLabel(library.warning));
  }
  private el<T extends HTMLElement = HTMLElement>(id: string): T { return document.getElementById(`midi-${id}`) as T; }
  private mount(): void {
    this.el('panel').innerHTML = `
      <section class="config-panel" ${attribute('aria-label', 'profiles_modes', {})}>
        <div class="config-row">
          <label class="config-picker"><span class="config-picker-heading">${l('profile', {})}<span id="midi-save-status" class="save-status" role="status"></span></span><select id="midi-library" ${attribute('aria-label', 'select_profile', {})}></select><input id="midi-profile-name" maxlength="80" ${attribute('aria-label', 'edit_profile_name', {})} hidden></label>
          <div class="config-actions"><button id="midi-profile-edit" class="outline">${l('edit', {})}</button><button id="midi-profile-duplicate" class="outline">${l('duplicate', {})}</button><button id="midi-save" class="primary" hidden>${l('save', {})}</button><button id="midi-profile-delete" class="text-button danger" hidden>${l('delete', {})}</button></div>
          <div class="profile-file-actions"><button id="midi-export" class="text-button">${l('export', {})}</button><label class="text-button file-button" tabindex="0" role="button">${l('import', {})}<input id="midi-import" type="file" accept=".json,application/json" hidden></label></div>
        </div>
        <div class="config-row">
          <label class="config-picker">${l('mode', {})}<select id="midi-mode" ${attribute('aria-label', 'select_mode', {})}></select><input id="midi-mode-name" maxlength="80" ${attribute('aria-label', 'edit_mode_name', {})} hidden></label>
          <div class="config-actions"><button id="midi-mode-edit" class="outline">${l('edit', {})}</button><button id="midi-add-mode" class="outline">${l('duplicate', {})}</button><button id="midi-mode-save" class="primary" hidden>${l('save', {})}</button><button id="midi-delete-mode" class="text-button danger" hidden>${l('delete', {})}</button></div>
          <label class="switch default-switch"><input id="midi-initial" type="checkbox">${l('set_as_startup_mode', {})}</label>
        </div>
      </section>
      <div class="workspace mapping-workspace">
        <section class="panel mapping-device">
          <div class="section-heading mapping-controller-heading">
            <div><p class="eyebrow">HARDWARE</p><h2>${l('controller_reference', {})}</h2></div>
            <div class="map-footer mapping-legend"><span><i class="dot selected-dot"></i>${l('selected', {})}</span><span><i class="dot mapped-dot"></i>${l('mapped', {})}</span><span><i class="dot idle-dot"></i>${l('unmapped', {})}</span></div>
            <span id="midi-mapped-count" class="section-note"></span>
          </div>
          <div class="hardware-scroll"><div id="midi-hardware" class="hardware" ${attribute('aria-label', 'mapping_controller_reference', {})}></div></div>
          <div class="mapping-footer-row">
          <p class="map-hint" title="${html(t('selection_shortcuts_hint'))}">${l('selection_shortcuts_compact', {})}</p>
          <div class="mapping-edit-actions" role="toolbar" ${attribute('aria-label', 'mapping_edit_actions', {})}>
            <button id="midi-undo" type="button">${l('undo_edit', {})}</button><button id="midi-redo" type="button">${l('redo_edit', {})}</button>
            <button id="midi-copy-controls" type="button">${l('copy_controls', {})}</button><button id="midi-paste-controls" type="button">${l('paste_controls', {})}</button>
            <span id="midi-selection-count"></span>
            <label class="switch hardware-follow-toggle" title="${html(t('follow_hardware_selection_help'))}"><input id="midi-follow-hardware-selection" type="checkbox">${l('follow_hardware_selection', {})}</label>
          </div>
          </div>
          <div class="device-settings">
          <details class="device-options" open><summary>${l('device_lights', {})}<span id="midi-led-summary">${l('not_controlled', {})}</span></summary>
            <div class="led-takeover-row">
              <label class="switch"><input id="midi-led-enable" type="checkbox" disabled>${l('take_over_led_output', {})}</label>
              <p id="midi-led-status" class="caption" role="status"></p>
            </div>
            <div class="led-settings">
              <p class="editor-section-label">${l('shared_brightness_for_this_mode', {})}</p>
              <label>${l('button_idle_brightness', {})}<select id="midi-button-idle-brightness"></select></label>
              <label>${l('button_pressed_brightness', {})}<select id="midi-button-on-brightness"></select></label>
              <label>${l('toggle_button_off_brightness', {})}<select id="midi-toggle-button-off-brightness"></select></label>
              <label>${l('toggle_button_on_brightness', {})}<select id="midi-toggle-button-on-brightness"></select></label>
              <label>${l('idle_brightness_for_all_16_pads', {})}<select id="midi-pad-off-brightness"></select></label>
              <label>${l('pressed_brightness_for_all_16_pads', {})}<select id="midi-pad-on-brightness"></select></label>
            </div>
            <p class="caption">${l('led_takeover_shortcut', {})}</p>
            <p class="caption">${l('changes_save_immediately_to_this_mode_button_brightness_only_affects_map', {})}</p>
          </details>
          <details class="device-options velocity-options" open><summary>${l('pad_velocity_curve', {})}</summary>
            <div class="led-settings">
              <label>Pad Velocity Curve<select id="midi-pad-velocity-curve">${PAD_VELOCITY_CURVES.map(value => `<option value="${value}">${value === 'linear' ? 'Linear' : value.replace('-', ' ').replace(/^./, c => c.toUpperCase())}</option>`).join('')}</select></label>
            </div>
            <p class="caption">${l('applies_to_pad_hit_velocity_across_this_profile_and_saves_immediately_so', {})}</p>
          </details>
          </div>
        </section>
        <aside class="panel mapping-editor" ${attribute('aria-label', 'control_editor', {})}>
          <div class="editor-heading"><p class="eyebrow">CONTROL INSPECTOR</p><span id="midi-draft-state" class="draft-state" role="status">${l('applied', {})}</span></div>
          <h2 id="midi-selected">Pad 1</h2><p id="midi-binding-summary" class="binding-summary"></p>
          <form id="midi-binding-form">
            <div id="midi-hit-heading" class="editor-section-label">MIDI OUTPUT</div><label>${l('output_action', {})}<select id="midi-action"></select></label>
            <div id="midi-fields" class="binding-fields"></div><div id="midi-strip-touch" class="binding-fields"></div><div id="midi-pad-press" class="binding-fields"></div><div id="midi-pad-light" class="binding-fields"></div>
            <button id="midi-apply" class="primary wide" type="submit">${l('apply_to_current_mode', {})}</button>
          </form>
          <p id="midi-binding-help" class="caption"></p>
        </aside>
      </div>
      <div class="mapping-status"><span id="midi-status" role="status">${l('no_midi_output_selected', {})}</span><span>${l('profiles_are_saved_in_this_browser_export_as_json', {})}</span></div>`;
    renderHardware(this.el('hardware'), (id: string, event: MouseEvent) => this.selectControl(id as ControlId, event.shiftKey), { includeEncoderTouch: true });
    this.mountSelection();
    this.el<HTMLInputElement>('follow-hardware-selection').addEventListener('change', () => {
      this.followHardwareSelection = this.el<HTMLInputElement>('follow-hardware-selection').checked;
    });
    this.el('binding-form').addEventListener('input', () => this.markBindingDirty());
    this.el('binding-form').addEventListener('change', () => this.markBindingDirty());
    this.el('pad-light').addEventListener('input', () => this.previewPadLight());
    this.el('pad-light').addEventListener('change', () => this.previewPadLight());
    this.el('pad-light').addEventListener('change', event => {
      if ((event.target as HTMLElement).id === 'bind-color-mode') this.syncPadColorFields();
    });
    this.el('pad-press').addEventListener('change', event => {
      if ((event.target as HTMLElement).id === 'bind-press-type') this.renderPressFields(undefined, true);
    });
    this.el('fields').addEventListener('change', event => {
      if ((event.target as HTMLElement).id === 'bind-style') this.syncCcFields('fields', '');
      if ((event.target as HTMLElement).id === 'bind-note-mode') this.syncNoteFields();
      if ((event.target as HTMLElement).id === 'bind-strip-mode') this.syncStripCcFields();
    });
    this.el('strip-touch').addEventListener('change', event => {
      const id = (event.target as HTMLElement).id;
      if (id === 'bind-touch-type') this.renderTouchFields(undefined, true);
      if (id === 'bind-touch-style') this.syncCcFields('strip-touch', 'touch-');
    });
    this.el('profile-name').addEventListener('input', () => { this.profileDirty = true; this.renderSaveState(); });
    this.el('mode-name').addEventListener('input', () => { this.profileDirty = true; this.renderSaveState(); });
    this.el('profile-edit').addEventListener('click', () => {
      if (this.editingMode) return this.options.toast(t('save_the_mode_name_first'));
      this.editingProfile = true; this.renderEditStates(); this.el<HTMLInputElement>('profile-name').focus();
    });
    this.el('profile-duplicate').addEventListener('click', () => this.guard(async () => {
      if (this.editingMode) return this.options.toast(t('save_the_mode_name_first'));
      if (!await this.discardBindingDraft()) return;
      const copy = parseProfile(this.profile); copy.name = `${copy.name} copy`;
      this.library.save(copy, true); this.loadProfile(copy, false);
      this.editingProfile = true; this.renderEditStates(); this.el<HTMLInputElement>('profile-name').focus();
      this.el<HTMLInputElement>('profile-name').select();
    }));
    this.el('profile-delete').addEventListener('click', () => this.guard(async () => {
      if (this.library.entries.length <= 1) return this.options.toast(t('keep_at_least_one_profile'));
      if (!await confirmAction(t('delete_profile_and_all_its_modes', {p0: this.profile.name}), t('delete_profile'))) return;
      this.loadProfile(this.library.deleteActive(), false);
    }));
    this.el('profile-name').addEventListener('keydown', event => {
      if (event.key === 'Enter') { event.preventDefault(); this.save(); }
      if (event.key === 'Escape') { this.editingProfile = false; this.profileDirty = false; this.renderEditStates(); this.renderSaveState(); }
    });
    this.el('library').addEventListener('change', () => this.guard(async () => {
      const id = this.el<HTMLSelectElement>('library').value;
      if ((this.profileDirty || this.bindingDirty) && !await confirmAction(t('this_profile_has_unsaved_changes_discard_them_and_load_the_selected_prof'), t('discard_load'))) return this.renderLibrary();
      try { this.loadProfile(this.library.select(id), false); } finally { this.renderLibrary(); }
    }));
    this.el('enable').addEventListener('click', () => this.guard(() => this.runtime.enableMidi()));
    this.el('output').addEventListener('change', () => this.guard(async () => {
      const id = this.el<HTMLSelectElement>('output').value;
      await this.runtime.selectOutput(id); this.renderPorts();
    }));
    this.el('mode').addEventListener('change', async () => {
      if (!await this.discardBindingDraft()) { this.renderModes(); return; }
      this.runtime.switchMode(this.el<HTMLSelectElement>('mode').value);
      this.renderModes(); this.renderBinding(); this.renderMap(); this.renderPressed(); this.queueModeLights();
    });
    this.el('mode-edit').addEventListener('click', () => {
      if (this.editingProfile) return this.options.toast(t('save_the_profile_name_first'));
      this.editingMode = true; this.renderEditStates(); this.el<HTMLInputElement>('mode-name').focus();
    });
    this.el('mode-save').addEventListener('click', () => this.saveModeEdit());
    this.el('mode-name').addEventListener('keydown', event => {
      if (event.key === 'Enter') { event.preventDefault(); this.saveModeEdit(); }
      if (event.key === 'Escape') { this.editingMode = false; this.profileDirty = false; this.renderEditStates(); this.renderSaveState(); }
    });
    this.el('action').addEventListener('change', () => {
      if (this.selection.size !== 1 || this.pendingPaste) return;
      const lightDraft = this.readPadLightDraft();
      const stripDraft = this.readStripLightDraft();
      this.renderFields(undefined, lightDraft ?? undefined, stripDraft ?? undefined); this.markBindingDirty(); this.previewPadLight();
    });
    this.el('binding-form').addEventListener('submit', event => { event.preventDefault(); this.guard(() => this.applyBinding()); });
    this.el('panic').addEventListener('click', () => {
      this.runtime.panic(); this.options.toast(t('active_notes_and_held_cc_values_have_been_released'));
    });
    this.el('add-mode').addEventListener('click', async () => {
      if (this.editingProfile) return this.options.toast(t('save_the_profile_name_first'));
      if (!await this.discardBindingDraft()) return;
      if (this.profile.modes.length >= 64) return this.options.toast(t('up_to_64_modes_are_supported'));
      const copy = JSON.parse(JSON.stringify(this.currentMode()));
      copy.id = crypto.randomUUID(); copy.name = `${copy.name} copy`;
      this.profile.modes.push(copy); this.commit(); this.runtime.switchMode(copy.id);
      this.renderModes(); this.renderBinding(); this.renderMap(); this.renderPressed(); this.queueModeLights();
      this.editingMode = true; this.renderEditStates(); this.el<HTMLInputElement>('mode-name').focus();
      this.el<HTMLInputElement>('mode-name').select();
    });
    this.el('delete-mode').addEventListener('click', async () => {
      if (!await this.discardBindingDraft()) return;
      if (this.profile.modes.length === 1) return this.options.toast(t('keep_at_least_one_mode'));
      if (!await confirmAction(t('delete_mode_actions_targeting_this_mode_will_be_disabled', {p0: this.currentMode().name}), t('delete_mode'))) return;
      const removed = this.activeModeId;
      this.profile.modes = this.profile.modes.filter(m => m.id !== removed);
      for (const mode of this.profile.modes) for (const [id, binding] of Object.entries(mode.bindings)) {
        if (binding?.type === 'mode' && binding.modeId === removed) delete mode.bindings[id as ControlId];
      }
      if (this.profile.initialModeId === removed) this.profile.initialModeId = this.profile.modes[0].id;
      this.editingMode = false; this.commit(); this.renderBinding(); this.renderEditStates();
    });
    this.el('initial').addEventListener('change', () => {
      if (this.el<HTMLInputElement>('initial').checked) { this.profile.initialModeId = this.activeModeId; this.commit(); }
      else this.renderModes();
    });
    this.el('save').addEventListener('click', () => this.save());
    this.el('export').addEventListener('click', () => {
      if (this.editingMode) return this.options.toast(t('save_the_mode_name_first'));
      if (!this.applyPending()) return;
      const a = document.createElement('a'), url = URL.createObjectURL(new Blob([JSON.stringify(this.profile, null, 2)], { type: 'application/json' }));
      a.href = url; a.download = 'midiy-profile.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
    this.el('import').addEventListener('change', event => this.guard(async () => {
      const input = event.target as HTMLInputElement, file = input.files?.[0]; input.value = '';
      if (!file) return;
      if (file.size > 1024 * 1024) throw new Error(t('midi_profile_exceeds_1_mb'));
      const next = parseProfile(JSON.parse(await file.text()));
      if (!await confirmAction(t('import_creates_and_selects_a_new_profile_capture_sessions_are_unaffected'), t('import_profile'))) return;
      this.library.save(next, true); this.loadProfile(next, false);
      this.options.toast(t('imported_and_saved_as_a_new_profile'));
    }));
    this.el('led-enable').addEventListener('change', () => {
      this.runtime.setLedEnabled(this.el<HTMLInputElement>('led-enable').checked);
      this.renderDevice();
    });
    for (const id of ['button-idle-brightness', 'button-on-brightness', 'toggle-button-off-brightness', 'toggle-button-on-brightness', 'pad-off-brightness', 'pad-on-brightness']) {
      this.el<HTMLSelectElement>(id).addEventListener('change', () => this.saveLedSettings());
    }
    this.el<HTMLSelectElement>('pad-velocity-curve').addEventListener('change', () => this.saveVelocityCurve());
    this.renderLibrary(); this.renderModes(); this.renderEditStates(); this.renderBinding(); this.renderMap(); this.renderPorts(); this.renderDevice(); this.renderSaveState(); this.queueModeLights();
  }
  private renderEditActions(): void {
    this.el<HTMLButtonElement>('undo').disabled = !this.history.canUndo;
    this.el<HTMLButtonElement>('redo').disabled = !this.history.canRedo;
    this.el<HTMLButtonElement>('copy-controls').disabled = !this.selection.size;
    this.el<HTMLButtonElement>('paste-controls').disabled = !this.selection.size || !this.copied.length;
    this.el('selection-count').textContent = t('selected_control_count', {p0: this.selection.size});
  }
  private async selectGroup(ids: ControlId[]): Promise<void> {
    if (ids.length === this.selection.size && ids.every(id => this.selection.has(id))) return;
    if (!await this.discardBindingDraft()) return;
    this.selection = new Set(ids); this.batchChanges = {}; this.pendingPaste = null;
    this.selected = ids[0] ?? this.selected;
    this.renderBinding(); this.renderMap();
  }
  private mountSelection(): void {
    const hardware = this.el('hardware');
    hardware.tabIndex = 0;
    let drag: { pointer: number; start: { x: number; y: number }; shift: boolean; base: ControlId[]; moved: boolean } | null = null;
    let box: HTMLDivElement | null = null, suppressClick = false;
    hardware.addEventListener('click', event => {
      if (suppressClick) { event.preventDefault(); event.stopImmediatePropagation(); suppressClick = false; }
    }, true);
    hardware.addEventListener('pointerdown', event => {
      if (event.button !== 0 || event.pointerType === 'touch') return;
      suppressClick = false;
      drag = { pointer: event.pointerId, start: { x: event.clientX, y: event.clientY }, shift: event.shiftKey, base: [...this.selection], moved: false };
    });
    hardware.addEventListener('pointermove', event => {
      if (!drag || event.pointerId !== drag.pointer) return;
      if (!drag.moved && Math.hypot(event.clientX - drag.start.x, event.clientY - drag.start.y) < 5) return;
      drag.moved = true; event.preventDefault(); hardware.setPointerCapture(event.pointerId);
      const bounds = hardware.getBoundingClientRect();
      if (!box) { box = document.createElement('div'); box.className = 'mapping-marquee'; hardware.append(box); }
      Object.assign(box.style, { left: `${Math.min(drag.start.x, event.clientX) - bounds.left}px`, top: `${Math.min(drag.start.y, event.clientY) - bounds.top}px`,
        width: `${Math.abs(event.clientX - drag.start.x)}px`, height: `${Math.abs(event.clientY - drag.start.y)}px` });
    });
    hardware.addEventListener('pointerup', event => {
      if (!drag || event.pointerId !== drag.pointer) return;
      const current = drag; drag = null; box?.remove(); box = null;
      if (hardware.hasPointerCapture(event.pointerId)) hardware.releasePointerCapture(event.pointerId);
      if (!current.moved) return;
      suppressClick = true; event.preventDefault();
      const rects = [...hardware.querySelectorAll<HTMLElement>('[data-control]')].map(button => ({ id: button.dataset.control as ControlId, ...button.getBoundingClientRect().toJSON() }));
      const hits = controlsInRect(rects, current.start, { x: event.clientX, y: event.clientY });
      void this.guard(() => this.selectGroup(selectControls(current.base, hits, current.shift)));
    });
    const cancel = () => { drag = null; box?.remove(); box = null; };
    hardware.addEventListener('pointercancel', cancel);
    hardware.addEventListener('lostpointercapture', cancel);
    this.el('undo').addEventListener('click', () => this.guard(() => this.restoreEdit(false)));
    this.el('redo').addEventListener('click', () => this.guard(() => this.restoreEdit(true)));
    this.el('copy-controls').addEventListener('click', () => this.copySelection());
    this.el('paste-controls').addEventListener('click', () => this.guard(() => this.pasteSelection()));
    document.addEventListener('keydown', event => {
      if (document.getElementById('page-mapping')?.hidden !== false || document.querySelector('dialog[open]') || event.isComposing) return;
      const target = event.target as HTMLElement;
      const action = mappingShortcut(event, Boolean(target.closest('input, select, textarea, [contenteditable]:not([contenteditable="false"])')));
      if (!action) return;
      event.preventDefault();
      if (action === 'copy') this.copySelection();
      else if (action === 'paste') void this.guard(() => this.pasteSelection());
      else void this.guard(() => this.restoreEdit(action === 'redo'));
    });
    this.el('action').addEventListener('change', () => {
      if (this.selection.size <= 1 || this.pendingPaste) return;
      this.batchChanges = { ...Object.fromEntries(Object.entries(this.batchChanges).filter(([key]) => !key.startsWith('hit.'))), action: this.el<HTMLSelectElement>('action').value };
      this.markBindingDirty(); this.renderBatch();
    });
    this.el('fields').addEventListener('input', event => {
      const input = event.target as HTMLInputElement;
      if (!input.dataset.batchKey) return;
      if (input.value === '') delete this.batchChanges[input.dataset.batchKey];
      else this.batchChanges[input.dataset.batchKey] = input.type === 'number' ? Number(input.value) : input.value;
      this.markBindingDirty(); this.previewBatch();
    });
    this.el('fields').addEventListener('change', event => {
      const input = event.target as HTMLInputElement;
      const key = input.dataset.batchKey; if (!key) return;
      if (input.value === '') delete this.batchChanges[key];
      else this.batchChanges[key] = input.type === 'number' ? Number(input.value) : input.value;
      this.markBindingDirty();
      if (key === 'pressAction' || key.endsWith('.mode') || key.endsWith('.style') || key === 'pad.dual') this.renderBatch();
      this.previewBatch();
    });
  }
  private copySelection(): void {
    if (!this.selection.size) return;
    this.copied = copyControls(this.profile, this.activeModeId, [...this.selection]);
    this.renderEditActions(); this.options.toast(t('controls_copied', {p0: this.copied.length}));
  }
  private async pasteSelection(): Promise<void> {
    if (!this.selection.size || !this.copied.length) return;
    let draft: Profile;
    try { draft = pasteControls(this.profile, this.activeModeId, [...this.selection], this.copied); }
    catch (error) { this.options.toast(t(error instanceof Error && error.message === 'paste_count_mismatch' ? 'paste_count_mismatch' : 'paste_incompatible')); return; }
    if (!await this.discardBindingDraft()) return;
    this.pendingPaste = draft; this.markBindingDirty(); this.renderBatch(); this.previewBatch();
    this.options.toast(t('paste_ready_to_apply'));
  }
  private async restoreEdit(redo: boolean): Promise<void> {
    const next = this.history.peek(redo); if (!next) return;
    if (this.editingProfile || this.editingMode) return this.options.toast(t('finish_name_edit_first'));
    if (!await this.discardBindingDraft()) return;
    try { this.library.save(next); } catch (error) { this.options.toast(t('could_not_save', {p0: formatError(error)})); return; }
    const previous = this.profile;
    // Feedback-only history must not flush a held note or a Toggle's ownership.
    const structure = (profile: Profile) => JSON.stringify({ ...profile, padVelocityCurve: undefined, modes: profile.modes.map(mode => ({ ...mode,
      buttonLight: undefined, toggleButtonLight: undefined, padOffBrightness: undefined, padOnBrightness: undefined })) });
    this.history.move(redo); this.profile = next; this.profileDirty = false;
    if (structure(previous) === structure(next)) { this.runtime.updateFeedback(next); this.runtime.setVelocityCurve(next.padVelocityCurve ?? 'linear'); }
    else this.runtime.applyProfile(next);
    this.renderLibrary(); this.renderModes(); this.renderBinding(); this.renderMap(); this.renderPressed(); this.queueModeLights(); this.renderSaveState();
  }
  private renderBatch(): void {
    const ids = [...this.selection];
    this.el('selected').textContent = t('selected_control_count', {p0: ids.length});
    this.el('binding-form').hidden = !ids.length;
    this.el('binding-summary').textContent = ids.map(controlName).join(' · ');
    this.el('draft-state').textContent = this.bindingDirty ? t('not_applied') : t('applied');
    this.el('draft-state').classList.toggle('unsaved', this.bindingDirty);
    if (!ids.length) return;
    this.el('strip-touch').innerHTML = ''; this.el('pad-press').innerHTML = ''; this.el('pad-light').innerHTML = '';
    const actionSelect = this.el<HTMLSelectElement>('action');
    actionSelect.closest('label')!.hidden = Boolean(this.pendingPaste);
    if (this.pendingPaste) {
      this.el('fields').innerHTML = `<p class="caption batch-hint">${l('paste_ready_to_apply', {})}</p>`;
      this.el('binding-help').textContent = ''; return;
    }
    let view = this.profile;
    try { view = patchControls(this.profile, this.activeModeId, ids, this.batchChanges); } catch { /* Keep incomplete draft editable; apply validates atomically. */ }
    const mode = view.modes.find(m => m.id === this.activeModeId)!;
    const actionOf = (id: ControlId) => { const binding = mode.bindings[id]; return binding?.type === 'button-value' || binding?.type === 'strip-position' ? binding.output : binding?.type ?? 'none'; };
    const action = ids.every(id => actionOf(id) === actionOf(ids[0])) ? actionOf(ids[0]) : '';
    const actionLabels: Record<string, string> = { none: t('disabled'), note: 'MIDI Note', cc: 'MIDI CC', mode: t('switch_mode'), 'poly-pressure': 'Poly Pressure', 'channel-pressure': 'Channel Pressure', program: 'Program Change', pitchbend: 'Pitchbend' };
    actionSelect.innerHTML = `<option value="" disabled>${t('multiple_values')}</option>` + commonActions(ids).map(value => `<option value="${value}">${actionLabels[value] ?? value}</option>`).join('');
    actionSelect.value = action;
    this.el('hit-heading').textContent = ids.every(isPadControl) ? t('pad_hit_strike') : 'MIDI OUTPUT';
    const fields = commonFields(view, this.activeModeId, ids);
    const fieldLabel = (label: string) => label.includes('_') ? t(label as Parameters<typeof t>[0]) : label;
    let section = '';
    let markup = `<p class="caption batch-hint">${l('batch_edit_hint', {})}</p>`;
    if (ids.every(isPadControl)) {
      const types = ids.map(id => mode.pressureBindings?.[id as `PAD_${number}`]?.type ?? 'off');
      const same = types.every(type => type === types[0]);
      markup += `<label>${l('pressure_action', {})}<select data-batch-key="pressAction"><option value="" disabled ${same ? '' : 'selected'}>${t('multiple_values')}</option>${['off', 'note', 'cc', 'poly-pressure', 'channel-pressure', 'pitchbend'].map(type => `<option value="${type}" ${same && types[0] === type ? 'selected' : ''}>${type === 'off' ? t('disabled') : type}</option>`).join('')}</select></label>`;
    }
    for (const field of fields) {
      const currentSection = field.key.split('.')[0];
      if (currentSection !== section) { section = currentSection; markup += `<p class="batch-section">${section === 'hit' ? 'MIDI / HIT' : section === 'press' ? 'PAD PRESS' : 'PAD LIGHT'}</p>`; }
      const same = field.values.every(value => value === field.values[0]);
      const value = field.key in this.batchChanges ? this.batchChanges[field.key] : same ? field.values[0] : '';
      let options = field.options;
      if (field.key === 'pad.color' || field.key === 'pad.onColor') options = PAD_COLORS.map((label, value) => ({ label, value: String(value) }));
      if (field.key === 'pad.onColor' && ids.every(id => mode.pads[Number(id.slice(4)) - 1].onColor === undefined)) continue;
      markup += `<label>${labelMarkup(fieldLabel(field.label))}${options
        ? `<select data-batch-key="${field.key}" data-batch-number="${field.key.startsWith('pad.') && field.key !== 'pad.dual' ? 'true' : 'false'}"><option value="" ${value === '' ? 'selected' : ''} disabled>${t('multiple_values')}</option>${options.map(option => `<option value="${html(option.value)}" ${String(value) === option.value ? 'selected' : ''}>${html(field.key === 'pad.dual' ? option.value === 'true' ? 'Dual' : 'Single' : option.label)}</option>`).join('')}</select>`
        : `<input type="number" data-batch-key="${field.key}" min="${field.min}" max="${field.max}" step="1" value="${html(value)}" placeholder="${t('multiple_values')}">`}</label>`;
    }
    this.el('fields').innerHTML = markup;
    this.el('binding-help').textContent = t('selection_shortcuts_hint');
    this.renderEditActions();
  }
  private previewBatch(): void {
    let draft = this.pendingPaste;
    if (!draft && this.selection.size > 1) {
      try { draft = patchControls(this.profile, this.activeModeId, [...this.selection], this.batchChanges); } catch { return; }
    }
    if (!draft) return;
    const mode = draft.modes.find(m => m.id === this.activeModeId)!;
    for (const id of this.selection) if (isPadControl(id)) {
      const button = this.el('hardware').querySelector<HTMLButtonElement>(`[data-control="${id}"]`);
      const light = mode.pads[Number(id.slice(4)) - 1];
      if (button) this.paintPad(button, { ...light, brightness: mode.padOffBrightness ?? light.brightness }, true);
    }
  }
  private async guard(action: () => void | Promise<void>): Promise<void> {
    try { await action(); } catch (error) { this.options.toast(formatError(error)); }
  }
  private currentMode() { return this.profile.modes.find(m => m.id === this.activeModeId)!; }
  async selectControl(id: ControlId, extend = false): Promise<void> {
    await this.selectGroup(selectControls([...this.selection], [id], extend));
  }
  private selectHardwareControl(id: ControlId): void {
    if (!this.followHardwareSelection || this.selection.size > 1 || id === this.selected || this.hardwareSelectionPending || document.getElementById('page-mapping')?.hidden !== false) return;
    this.hardwareSelectionPending = true;
    void this.guard(async () => {
      try { await this.selectControl(id); }
      finally { this.hardwareSelectionPending = false; }
    });
  }
  private async discardBindingDraft(): Promise<boolean> {
    if (!this.bindingDirty) return true;
    if (!await confirmAction(t('this_control_has_unapplied_changes_discard_them'), t('discard_changes'))) return false;
    this.bindingDirty = false; this.batchChanges = {}; this.pendingPaste = null; return true;
  }
  private markBindingDirty(): void {
    this.bindingDirty = true;
    this.el('draft-state').textContent = t('not_applied'); this.el('draft-state').classList.add('unsaved');
    this.renderSaveState();
  }
  private renderLibrary(): void {
    this.el<HTMLSelectElement>('library').innerHTML = (this.library.activeId ? '' : `<option value="" data-i18n="newly_imported_profile">${t('newly_imported_profile')}</option>`) + this.library.entries.map(e => `<option value="${html(e.id)}">${html(e.profile.name)}</option>`).join('');
    this.el<HTMLSelectElement>('library').value = this.library.activeId;
  }
  private renderEditStates(): void {
    for (const [id, hidden] of [
      ['library', this.editingProfile], ['profile-name', !this.editingProfile],
      ['profile-edit', this.editingProfile], ['profile-duplicate', this.editingProfile],
      ['save', !this.editingProfile], ['profile-delete', !this.editingProfile],
      ['mode', this.editingMode], ['mode-name', !this.editingMode],
      ['mode-edit', this.editingMode], ['add-mode', this.editingMode],
      ['mode-save', !this.editingMode], ['delete-mode', !this.editingMode]
    ] as [string, boolean][]) this.el(id).hidden = hidden;
    this.el<HTMLButtonElement>('profile-delete').disabled = this.library.entries.length <= 1;
    this.el<HTMLButtonElement>('delete-mode').disabled = this.profile.modes.length <= 1;
    if (this.editingProfile) this.el<HTMLInputElement>('profile-name').value = this.profile.name;
    if (this.editingMode) this.el<HTMLInputElement>('mode-name').value = this.currentMode().name;
  }
  private renderSaveState(): void {
    this.el('save-status').textContent = this.profileDirty || this.bindingDirty ? t('unsaved_changes') : this.library.persisted ? t('saved_in_this_browser') : t('built_in_default_saves_automatically_after_your_first_edit');
    this.el('save-status').classList.toggle('unsaved', this.profileDirty || this.bindingDirty);
    this.renderEditActions();
  }
  private loadProfile(profile: Profile, dirty: boolean): void {
    this.profile = profile; this.history = new EditHistory(profile); this.batchChanges = {}; this.pendingPaste = null; this.runtime.applyProfile(profile, true);
    this.profileDirty = dirty; this.bindingDirty = false; this.editingProfile = false; this.editingMode = false;
    this.el<HTMLInputElement>('profile-name').value = this.profile.name;
    this.renderLibrary(); this.renderModes(); this.renderEditStates(); this.renderBinding(); this.renderMap(); this.renderSaveState(); this.queueModeLights();
  }
  private renderModes(): void {
    this.el<HTMLSelectElement>('mode').innerHTML = this.profile.modes.map(m => `<option value="${html(m.id)}">${html(m.name)}</option>`).join('');
    this.el<HTMLSelectElement>('mode').value = this.activeModeId;
    if (!this.editingProfile) this.el<HTMLInputElement>('profile-name').value = this.profile.name;
    if (!this.editingMode) this.el<HTMLInputElement>('mode-name').value = this.currentMode().name;
    this.el<HTMLInputElement>('initial').checked = this.profile.initialModeId === this.activeModeId;
    this.renderLedSettings();
  }
  private renderLedSettings(): void {
    this.el<HTMLSelectElement>('pad-velocity-curve').value = this.profile.padVelocityCurve ?? 'linear';
    const mode = this.currentMode();
    this.el<HTMLSelectElement>('button-idle-brightness').innerHTML = brightnessOptions(mode.buttonLight?.off ?? 'off');
    this.el<HTMLSelectElement>('button-on-brightness').innerHTML = brightnessOptions(mode.buttonLight?.on ?? 'normal');
    this.el<HTMLSelectElement>('toggle-button-off-brightness').innerHTML = brightnessOptions(mode.toggleButtonLight?.off ?? mode.buttonLight?.off ?? 'off');
    this.el<HTMLSelectElement>('toggle-button-on-brightness').innerHTML = brightnessOptions(mode.toggleButtonLight?.on ?? mode.buttonLight?.on ?? 'normal');
    const mixed = mode.padOffBrightness === undefined && mode.pads.some(pad => pad.brightness !== mode.pads[0].brightness);
    this.el<HTMLSelectElement>('pad-off-brightness').innerHTML = (mixed ? `<option value="legacy" selected>${t('legacy_pad_brightness')}</option>` : '')
      + brightnessOptions(mode.padOffBrightness ?? mode.pads[0].brightness);
    if (mixed) this.el<HTMLSelectElement>('pad-off-brightness').value = 'legacy';
    this.el<HTMLSelectElement>('pad-on-brightness').innerHTML = brightnessOptions(mode.padOnBrightness ?? 'bright');
  }
  private saveVelocityCurve(): void {
    const next = parseProfile({ ...this.profile, padVelocityCurve: this.el<HTMLSelectElement>('pad-velocity-curve').value as PadVelocityCurve });
    try {
      this.library.save(next);
      this.history.record(next); this.profile = next;
      // Only future hits change; preserve held notes and their release targets.
      this.runtime.setVelocityCurve(next.padVelocityCurve!);
      this.renderSaveState();
    } catch (error) {
      this.el<HTMLSelectElement>('pad-velocity-curve').value = this.profile.padVelocityCurve ?? 'linear';
      this.options.toast(t('could_not_save_velocity_curve', {p0: formatError(error)}));
    }
  }
  private saveLedSettings(): void {
    const off = this.el<HTMLSelectElement>('button-idle-brightness').value as Brightness;
    const on = this.el<HTMLSelectElement>('button-on-brightness').value as Brightness;
    const padOn = this.el<HTMLSelectElement>('pad-on-brightness').value as Brightness;
    const next = parseProfile(this.profile);
    const mode = next.modes.find(m => m.id === this.activeModeId)!;
    mode.buttonLight = { off, on };
    mode.toggleButtonLight = {
      off: this.el<HTMLSelectElement>('toggle-button-off-brightness').value as Brightness,
      on: this.el<HTMLSelectElement>('toggle-button-on-brightness').value as Brightness,
    };
    mode.padOnBrightness = padOn;
    const padOff = this.el<HTMLSelectElement>('pad-off-brightness').value;
    if (padOff !== 'legacy') mode.padOffBrightness = padOff as Brightness;
    try {
      this.library.save(next);
      this.history.record(next); this.profile = next;
      this.runtime.updateFeedback(next); this.renderPressed(); this.queueModeLights(); this.renderSaveState();
    } catch (error) {
      this.renderLedSettings();
      this.options.toast(t('could_not_save_light_settings', {p0: formatError(error)}));
    }
  }
  private renderBinding(): void {
    if (this.selection.size !== 1 || this.pendingPaste) { this.renderBatch(); return; }
    this.batchChanges = {};
    this.el('action').closest('label')!.hidden = false;
    this.el('binding-form').hidden = false;
    this.el('selected').textContent = controlName(this.selected);
    this.bindingDirty = false;
    this.el('draft-state').textContent = t('applied'); this.el('draft-state').classList.remove('unsaved');
    this.el('hit-heading').textContent = isPad(this.selected) ? t('pad_hit_strike') : this.selected === 'SMART_STRIP' ? t('strip_position_position') : 'MIDI OUTPUT';
    const press = isPad(this.selected) ? this.currentMode().pressureBindings?.[this.selected] : undefined;
    const touch = this.selected === 'SMART_STRIP' ? this.currentMode().bindings.SMART_STRIP_TOUCH : undefined;
    this.el('binding-summary').textContent = this.controlSummary(this.selected);
    const continuous = this.selected === 'ENCODER_ROTATE' || this.selected === 'SMART_STRIP';
    const actions = this.selected === 'SMART_STRIP'
      ? [['none', t('disabled')], ['cc', 'MIDI CC'], ['poly-pressure', 'Poly Pressure'], ['channel-pressure', 'Channel Pressure'], ['program', 'Program Change'], ['pitchbend', 'Pitchbend']]
      : continuous ? [['none', t('disabled')], ['cc', 'MIDI CC']] : isPad(this.selected)
        ? [['none', t('disabled')], ['note', 'MIDI Note'], ['cc', 'MIDI CC'], ['poly-pressure', 'Poly Pressure'], ['channel-pressure', 'Channel Pressure'], ['program', 'Program Change'], ['pitchbend', 'Pitchbend'], ['mode', t('switch_mode')]]
        : [['none', t('disabled')], ['note', 'MIDI Note'], ['cc', 'MIDI CC'], ['poly-pressure', 'Poly Pressure'], ['channel-pressure', 'Channel Pressure'], ['program', 'Program Change'], ['pitchbend', 'Pitchbend'], ['mode', t('switch_mode')]];
    if (this.selected === 'FIXED_VEL') actions.push(['fixed-velocity', t('fixed_velocity_output')]);
    this.el<HTMLSelectElement>('action').innerHTML = actions.map(([id, label]) => `<option value="${id}" ${labelAttributes(label)}>${label}</option>`).join('');
    const b = this.currentMode().bindings[this.selected];
    this.el<HTMLSelectElement>('action').value = b?.type === 'strip-position' || b?.type === 'button-value' ? b.output : b?.type ?? 'none';
    this.renderFields(b); this.renderTouchFields(touch); this.renderPressFields(press); this.renderSaveState();
  }
  private syncCcFields(container: 'fields' | 'strip-touch', prefix: string): void {
    const root = this.el(container);
    const style = (document.getElementById(`bind-${prefix}style`) as HTMLSelectElement).value;
    root.querySelectorAll<HTMLElement>('[data-cc-fields]').forEach(label => {
      const show = label.dataset.ccFields!.split(' ').includes(style);
      label.hidden = !show;
      label.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input,select').forEach(input => { input.disabled = !show; });
    });
  }
  private syncNoteFields(): void {
    const toggle = (document.getElementById('bind-note-mode') as HTMLSelectElement).value === 'toggle';
    const label = document.getElementById('bind-note-action-on')?.closest('label');
    if (!label) return;
    label.hidden = !toggle;
    (document.getElementById('bind-note-action-on') as HTMLSelectElement).disabled = !toggle;
  }
  private syncStripCcFields(): void {
    const mode = (document.getElementById('bind-strip-mode') as HTMLSelectElement).value;
    this.el('fields').querySelectorAll<HTMLElement>('[data-strip-cc-fields]').forEach(label => {
      const show = label.dataset.stripCcFields!.split(' ').includes(mode);
      label.hidden = !show;
      label.querySelectorAll<HTMLInputElement>('input').forEach(input => { input.disabled = !show; });
    });
  }
  private renderTouchFields(existing?: Binding, fromSelection = false): void {
    if (this.selected !== 'SMART_STRIP') { this.el('strip-touch').innerHTML = ''; return; }
    const action = fromSelection ? (document.getElementById('bind-touch-type') as HTMLSelectElement).value
      : existing?.type === 'value' ? existing.output : existing?.type === 'system' ? existing.command : existing?.type ?? 'none';
    const b = fromSelection ? undefined : existing;
    let fields = `<div class="editor-section-label">${l('strip_touch_touch_release', {})}</div>`;
    fields += `<label>${l('touch_action', {})}<select id="bind-touch-type">${[['none',t('disabled')],['note','Note'],['cc','Control Change'],['poly-pressure','Poly Pressure'],['channel-pressure','Channel Pressure'],['program','Program Change'],['pitchbend','Pitchbend'],['start','Start'],['stop','Stop'],['continue','Continue'],['song-position','Song Position']].map(([id,label]) => `<option value="${id}" ${labelAttributes(label)}>${label}</option>`).join('')}</select></label>`;
    if (!['none', 'start', 'stop', 'continue', 'song-position'].includes(action)) fields += field('touch-channel', 'MIDI Channel', b && 'channel' in b ? b.channel : 1, 1, 16);
    if (action === 'note') fields += field('touch-note', 'Note Number', b?.type === 'note' ? b.note : 36) + '';
    else if (action === 'cc') {
      fields += field('touch-controller', 'CC Number', b?.type === 'cc' ? b.controller : 1);
      fields += ccFields('touch-', b);
    } else if (action === 'poly-pressure' || action === 'channel-pressure' || action === 'pitchbend') {
      const v = b?.type === 'value' && b.output === action ? b : undefined;
      const max = action === 'pitchbend' ? 16383 : 127;
      if (action === 'poly-pressure') fields += field('touch-note', 'Note Number', v?.note ?? 36);
      fields += field('touch-on', t('touch_value'), v?.on ?? max, 0, max) + field('touch-off', t('release_value'), v?.off ?? (action === 'pitchbend' ? 8192 : 0), 0, max);
    } else if (action === 'program') fields += field('touch-program', 'Program Number', b?.type === 'program' ? b.program : 0);
    else if (action === 'song-position') fields += field('touch-position', 'Song Position', b?.type === 'system' ? b.position ?? 0 : 0, 0, 16383);
    this.el('strip-touch').innerHTML = fields;
    (document.getElementById('bind-touch-type') as HTMLSelectElement).value = action;
    if (action === 'cc') {
      (document.getElementById('bind-touch-style') as HTMLSelectElement).value = b?.type === 'cc' ? b.style : 'momentary';
      (document.getElementById('bind-touch-action-on') as HTMLSelectElement).value = b?.type === 'cc' && 'actionOn' in b ? b.actionOn ?? 'down' : 'down';
      this.syncCcFields('strip-touch', 'touch-');
    }
  }
  private pressureLabel(binding: PressureBinding): string {
    if (binding.type === 'off') return t('disabled');
    const prefix = `CH ${binding.channel} · `;
    if (binding.type === 'note') return `${prefix}Note ${binding.note}`;
    if (binding.type === 'poly-pressure') return `${prefix}Poly Pressure · Note ${binding.note}`;
    if (binding.type === 'cc') return `${prefix}CC ${binding.controller}`;
    return prefix + (binding.type === 'channel-pressure' ? 'Channel Pressure' : 'Pitchbend');
  }
  private renderPressFields(existing?: PressureBinding, fromSelection = false): void {
    if (!isPad(this.selected)) { this.el('pad-press').innerHTML = ''; return; }
    const action = fromSelection ? (document.getElementById('bind-press-type') as HTMLSelectElement).value : existing?.type ?? 'off';
    const b = existing?.type === action ? existing : undefined;
    let fields = `<div class="editor-section-label">${l('pad_press_continuous_pressure', {})}</div><label>${l('pressure_action', {})}<select id="bind-press-type"><option value="off" data-i18n="disabled">${t('disabled')}</option><option value="note" data-i18n="midi_note_pressure_threshold">${t('midi_note_pressure_threshold')}</option><option value="cc">MIDI CC</option><option value="poly-pressure">Poly Pressure</option><option value="channel-pressure">Channel Pressure</option><option value="pitchbend">Pitchbend</option></select></label>`;
    if (action !== 'off') {
      fields += field('press-channel', t('pressure_midi_channel'), b && 'channel' in b ? b.channel : 1, 1, 16);
      if (action === 'note') {
        const n = b?.type === 'note' ? b : undefined;
        const hit = this.currentMode().bindings[this.selected];
        fields += field('press-note', t('pressure_note'), n?.note ?? (hit?.type === 'note' ? hit.note : 36));
        fields += field('press-velocity', t('trigger_velocity'), n?.velocity ?? 100, 1, 127);
        fields += field('press-off-threshold', t('release_threshold'), n?.offThreshold ?? 10, 0, 99);
        fields += field('press-on-threshold', t('trigger_threshold'), n?.onThreshold ?? 20, 1, 100);
      } else {
        if (action === 'cc') fields += field('press-controller', t('pressure_cc_number'), b?.type === 'cc' ? b.controller : 1);
        if (action === 'poly-pressure') {
          const hit = this.currentMode().bindings[this.selected];
          fields += field('press-note', t('pressure_note'), b?.type === 'poly-pressure' ? b.note : hit?.type === 'note' ? hit.note : 36);
        }
        const bend = action === 'pitchbend';
        fields += field('press-from', bend ? t('minimum_pitch_bend') : t('output_minimum'), b && 'from' in b ? b.from : 0, bend ? -100 : 0, bend ? 100 : 127);
        fields += field('press-to', bend ? t('maximum_pitch_bend') : t('output_maximum'), b && 'to' in b ? b.to : bend ? 100 : 127, bend ? -100 : 0, bend ? 100 : 127);
      }
    }
    this.el('pad-press').innerHTML = fields;
    (document.getElementById('bind-press-type') as HTMLSelectElement).value = action;
  }
  private renderFields(existing?: Binding, lightDraft?: PadLight,
    stripDraft?: { mode: StripLightMode; brightness: Brightness; color?: number }): void {
    const action = this.el<HTMLSelectElement>('action').value;
    const b = existing?.type === action || (existing?.type === 'strip-position' || existing?.type === 'button-value') && existing.output === action ? existing : undefined;
    let fields = '';
    if (action !== 'none' && action !== 'mode' && action !== 'fixed-velocity') fields += field('channel', 'MIDI Channel', b && 'channel' in b ? b.channel : 1, 1, 16);
    if (action === 'note') {
      const note = b?.type === 'note' ? b : undefined;
      fields += field('note', 'Note Number', note?.note ?? 36);
      const pad = isPad(this.selected);
      fields += '<label>Mode<select id="bind-note-mode"><option value="gate">Gate</option><option value="toggle">Toggle</option></select></label>';
      if (pad) {
        const fixed = typeof note?.velocity === 'number' ? note.velocity : undefined;
        fields += field('velocity-min', t('output_minimum'), fixed ?? note?.velocityMin ?? 0)
          + field('velocity-max', t('output_maximum'), fixed ?? note?.velocityMax ?? 127);
      }
      if (!pad) fields += `<label>Action on<select id="bind-note-action-on"><option value="down" data-i18n="press">${t('press')}</option><option value="up" data-i18n="release">${t('release')}</option></select></label>`;
      this.el('fields').innerHTML = fields;
      (document.getElementById('bind-note-mode') as HTMLSelectElement).value = note?.mode ?? 'gate';
      if (!pad) (document.getElementById('bind-note-action-on') as HTMLSelectElement).value = note?.actionOn ?? 'down';
      this.syncNoteFields();
    } else {
      if (action === 'cc') {
        const cc = b?.type === 'cc' ? b : undefined;
        fields += field('controller', 'CC Number', cc?.controller ?? 1);
        if (this.selected === 'ENCODER_ROTATE') {
          const enc = cc?.style === 'encoder' ? cc : undefined;
          fields += field('step', t('cc_increment_per_detent'), enc?.step ?? 1, 1) + field('initial', t('initial_cc_value'), enc?.initial ?? 64) + field('modulus', t('counter_modulus_0_no_wrap'), enc?.modulus ?? 0, 0, 256);
        } else if (this.selected === 'SMART_STRIP') {
          const strip = cc?.style === 'strip' ? cc : undefined;
          fields += field('raw-min', t('raw_minimum'), strip?.rawMin ?? 1, 1, 254) + field('raw-max', t('raw_maximum'), strip?.rawMax ?? 200, 2, 255);
          fields += '<label>Mode<select id="bind-strip-mode"><option value="absolute">Absolute</option><option value="relative">Relative</option><option value="relative-offset">Relative (Offset)</option></select></label>';
          fields += `<label data-strip-cc-fields="absolute">Range From<input id="bind-strip-from" type="number" min="0" max="127" value="${strip?.from ?? 0}" required></label>`;
          fields += `<label data-strip-cc-fields="absolute">Range To<input id="bind-strip-to" type="number" min="0" max="127" value="${strip?.to ?? 127}" required></label>`;
          fields += `<label data-strip-cc-fields="relative relative-offset">Step<input id="bind-strip-step" type="number" min="-127" max="127" value="${strip?.step ?? 1}" required></label>`;
          fields += `<label data-strip-cc-fields="relative relative-offset">${l('resolution_steps_per_full_swipe_higher_is_more_sensitive', {})}<input id="bind-strip-resolution" type="number" min="1" max="200" value="${strip?.resolution ?? 25}" required></label>`;
        } else {
          fields += ccFields('', cc, 127, !isPad(this.selected));
        }
      } else if (this.selected === 'SMART_STRIP' && ['poly-pressure', 'channel-pressure', 'program', 'pitchbend'].includes(action)) {
        const position = b?.type === 'strip-position' ? b : undefined;
        const max = action === 'pitchbend' ? 16383 : 127;
        if (action === 'poly-pressure') fields += field('note', 'Note Number', position?.note ?? 36);
        fields += field('from', 'Range From', position?.from ?? 0, 0, max) + field('to', 'Range To', position?.to ?? max, 0, max);
      } else if (['poly-pressure', 'channel-pressure', 'program', 'pitchbend'].includes(action)) {
        const button = b?.type === 'button-value' ? b : b?.type === 'program' && action === 'program'
          ? { type: 'button-value' as const, channel: b.channel, output: 'program' as const, mode: 'trigger' as const, value: b.program } : undefined;
        if (action === 'poly-pressure') fields += field('note', 'Note Number', button?.note ?? 36);
        fields += ccFields('', button, action === 'pitchbend' ? 16383 : 127, !isPad(this.selected));
      } else if (action === 'fixed-velocity') {
        fields += field('fixed-velocity', t('fixed_velocity_value'), b?.type === 'fixed-velocity' ? b.velocity : 127, 1, 127);
        fields += `<p class="caption fixed-velocity-hint">${l('fixed_velocity_hint', {})}</p>`;
      } else if (action === 'mode') fields += `<label>${l('target_mode', {})}<select id="bind-mode">${this.profile.modes.map(m => `<option value="${html(m.id)}">${html(m.name)}</option>`).join('')}</select></label>`;
      this.el('fields').innerHTML = fields;
      if (b?.type === 'mode') (document.getElementById('bind-mode') as HTMLSelectElement).value = b.modeId;
      if (action === 'cc' && this.selected !== 'ENCODER_ROTATE' && this.selected !== 'SMART_STRIP') {
        (document.getElementById('bind-style') as HTMLSelectElement).value = b?.type === 'cc' ? b.style : 'momentary';
        if (!isPad(this.selected)) (document.getElementById('bind-action-on') as HTMLSelectElement).value = b?.type === 'cc' && 'actionOn' in b ? b.actionOn ?? 'down' : 'down';
        this.syncCcFields('fields', '');
      }
      if (['poly-pressure', 'channel-pressure', 'program', 'pitchbend'].includes(action) && this.selected !== 'SMART_STRIP') {
        const button = b?.type === 'button-value' ? b : undefined;
        (document.getElementById('bind-style') as HTMLSelectElement).value = button?.mode === 'gate' ? 'momentary' : button?.mode ?? (b?.type === 'program' ? 'trigger' : 'momentary');
        if (!isPad(this.selected)) (document.getElementById('bind-action-on') as HTMLSelectElement).value = button?.actionOn ?? 'down';
        this.syncCcFields('fields', '');
      }
      if (action === 'cc' && this.selected === 'SMART_STRIP') {
        (document.getElementById('bind-strip-mode') as HTMLSelectElement).value = b?.type === 'cc' && b.style === 'strip' ? b.mode ?? 'absolute' : 'absolute';
        this.syncStripCcFields();
      }
    }
    const index = isPad(this.selected) ? Number(this.selected.slice(4)) - 1 : -1;
    const light = lightDraft ?? this.currentMode().pads[index];
    const stripLight = this.selected === 'SMART_STRIP' ? stripDraft ?? this.currentMode().stripLight ?? { mode: 'dot', brightness: 'normal' } : null;
    this.el('pad-light').innerHTML = light
      ? `<div class="editor-section-label">PAD LIGHT</div><label>Color Mode<select id="bind-color-mode"><option value="single" data-i18n="single_one_color_two_brightness_levels">${t('single_one_color_two_brightness_levels')}</option><option value="dual" data-i18n="dual_two_colors">${t('dual_two_colors')}</option></select></label><label>${l('idle_color_color_off', {})}<select id="bind-color">${PAD_COLORS.map((name, i) => `<option value="${i}">${name}</option>`).join('')}</select></label><label data-pad-dual>${l('pressed_color_color_on', {})}<select id="bind-on-color">${PAD_COLORS.map((name, i) => `<option value="${i}">${name}</option>`).join('')}</select></label>`
      : stripLight
          ? `<div class="editor-section-label">STRIP LIGHT</div><label>LED Mode<select id="bind-strip-led-mode"><option value="dot" data-i18n="dot_single_point">${t('dot_single_point')}</option><option value="bar" data-i18n="bar_fill_from_left">${t('bar_fill_from_left')}</option><option value="pan" data-i18n="pan_center_outward">${t('pan_center_outward')}</option></select></label><label>Color Value<select id="bind-strip-led-color">${PAD_COLORS.slice(1).map((name, i) => `<option value="${i + 1}">${name}</option>`).join('')}</select></label><label>${l('brightness', {})}<select id="bind-strip-led-brightness">${brightnessOptions(stripLight.brightness)}</select></label>` : '';
    if (light) {
      (document.getElementById('bind-color-mode') as HTMLSelectElement).value = light.onColor === undefined ? 'single' : 'dual';
      (document.getElementById('bind-color') as HTMLSelectElement).value = String(light.color);
      (document.getElementById('bind-on-color') as HTMLSelectElement).value = String(light.onColor ?? light.color);
      this.syncPadColorFields();
    }
    if (stripLight) {
      (document.getElementById('bind-strip-led-mode') as HTMLSelectElement).value = stripLight.mode;
      (document.getElementById('bind-strip-led-color') as HTMLSelectElement).value = String(stripLight.color ?? 17);
    }
    this.renderHelp();
  }
  private renderHelp(): void {
    this.el('binding-help').textContent = this.selected === 'ENCODER_ROTATE'
      ? t('input_keeps_the_raw_counter_difference_rust_defines_no_wrap_range_the_de')
      : this.selected === 'SMART_STRIP' ? t('hardware_observations_0_is_release_1_is_leftmost_and_200_is_rightmost_co')
      : isPad(this.selected) ? t('hit_note_applies_the_velocity_curve_before_scaling_to_the_output_range_e')
      : t('apply_updates_this_mode_s_control_and_saves_the_entire_profile_note_numb');
  }
  private applyBinding(): void {
    if (this.pendingPaste || this.selection.size !== 1) {
      if (!this.selection.size) return;
      if (!this.el<HTMLFormElement>('binding-form').reportValidity()) return;
      const next = this.pendingPaste ?? patchControls(this.profile, this.activeModeId, [...this.selection], this.batchChanges);
      this.profile = next; this.pendingPaste = null; this.batchChanges = {}; this.bindingDirty = false;
      this.commit(); this.renderBinding(); return;
    }
    const val = (id: string) => (document.getElementById(`bind-${id}`) as HTMLInputElement).value;
    const num = (id: string) => Number(val(id));
    const switchCc = (prefix: string, shared: { type: 'cc'; channel: number; controller: number }): Binding => {
      const style = val(`${prefix}style`);
      if (style === 'momentary') return { ...shared, style, on: num(`${prefix}on`), off: num(`${prefix}off`) };
      const actionOn = prefix || !isPad(this.selected) ? { actionOn: val(`${prefix}action-on`) as 'down' | 'up' } : {};
      if (style === 'toggle') return { ...shared, style, on: num(`${prefix}on`), off: num(`${prefix}off`), ...actionOn };
      if (style === 'trigger') return { ...shared, style, value: num(`${prefix}value`), ...actionOn };
      return { ...shared, style: 'inc', from: num(`${prefix}from`), to: num(`${prefix}to`), step: num(`${prefix}step`), wrap: (document.getElementById(`bind-${prefix}wrap`) as HTMLInputElement).checked, ...actionOn };
    };
    const action = this.el<HTMLSelectElement>('action').value;
    let b: Binding = { type: 'none' };
    if (action === 'note') {
      const noteMode = val('note-mode') as 'gate' | 'toggle';
      const pad = isPad(this.selected);
      if (pad && num('velocity-min') > num('velocity-max')) throw new Error(t('output_minimum_cannot_exceed_output_maximum'));
      b = { type: 'note', channel: num('channel'), note: num('note'), velocity: pad ? 'pad' : 127,
        ...(pad ? { velocityMin: num('velocity-min'), velocityMax: num('velocity-max') } : {}),
        mode: noteMode, ...(noteMode === 'toggle' && !isPad(this.selected) ? { actionOn: val('note-action-on') as 'down' | 'up' } : {}) };
    }
    else if (action === 'fixed-velocity') b = { type: 'fixed-velocity', velocity: num('fixed-velocity') };
    else if (action === 'mode') b = { type: 'mode', modeId: val('mode') };
    else if (action === 'cc') {
      const shared = { type: 'cc' as const, channel: num('channel'), controller: num('controller') };
      if (this.selected === 'ENCODER_ROTATE') b = { ...shared, style: 'encoder', step: num('step'), initial: num('initial'), modulus: num('modulus') };
      else if (this.selected === 'SMART_STRIP') {
        const mode = val('strip-mode') as 'absolute' | 'relative' | 'relative-offset';
        b = { ...shared, style: 'strip', rawMin: num('raw-min'), rawMax: num('raw-max'), mode,
          ...(mode === 'absolute' ? { from: num('strip-from'), to: num('strip-to') } : { step: num('strip-step'), resolution: num('strip-resolution') }) };
      }
      else b = switchCc('', shared);
    } else if (this.selected === 'SMART_STRIP' && ['poly-pressure', 'channel-pressure', 'program', 'pitchbend'].includes(action)) {
      b = { type: 'strip-position', channel: num('channel'), output: action as 'poly-pressure' | 'channel-pressure' | 'program' | 'pitchbend',
        ...(action === 'poly-pressure' ? { note: num('note') } : {}), from: num('from'), to: num('to') };
    } else if (['poly-pressure', 'channel-pressure', 'program', 'pitchbend'].includes(action)) {
      const shared = { type: 'button-value' as const, channel: num('channel'), output: action as 'poly-pressure' | 'channel-pressure' | 'program' | 'pitchbend',
        ...(action === 'poly-pressure' ? { note: num('note') } : {}) };
      const style = val('style');
      const actionOn = !isPad(this.selected) ? { actionOn: val('action-on') as 'down' | 'up' } : {};
      if (style === 'momentary') b = { ...shared, mode: 'gate', on: num('on'), off: num('off') };
      else if (style === 'toggle') b = { ...shared, mode: 'toggle', on: num('on'), off: num('off'), ...actionOn };
      else if (style === 'trigger') b = { ...shared, mode: 'trigger', value: num('value'), ...actionOn };
      else b = { ...shared, mode: 'inc', from: num('from'), to: num('to'), step: num('step'), wrap: (document.getElementById('bind-wrap') as HTMLInputElement).checked, ...actionOn };
    }
    const next = JSON.parse(JSON.stringify(this.profile)) as Profile;
    const mode = next.modes.find(m => m.id === this.activeModeId)!;
    mode.bindings[this.selected] = b;
    if (this.selected === 'SMART_STRIP') {
      const touch = val('touch-type');
      let touchBinding: Binding = { type: 'none' };
      if (touch === 'note') touchBinding = { type: 'note', channel: num('touch-channel'), note: num('touch-note'), velocity: 127 };
      else if (touch === 'cc') touchBinding = switchCc('touch-', { type: 'cc', channel: num('touch-channel'), controller: num('touch-controller') });
      else if (touch === 'program') touchBinding = { type: 'program', channel: num('touch-channel'), program: num('touch-program') };
      else if (touch === 'poly-pressure' || touch === 'channel-pressure' || touch === 'pitchbend') touchBinding = {
        type: 'value', channel: num('touch-channel'), output: touch,
        ...(touch === 'poly-pressure' ? { note: num('touch-note') } : {}), on: num('touch-on'), off: num('touch-off')
      };
      else if (touch === 'start' || touch === 'stop' || touch === 'continue' || touch === 'song-position') touchBinding = {
        type: 'system', command: touch, ...(touch === 'song-position' ? { position: num('touch-position') } : {})
      };
      if (touchBinding.type === 'none') delete mode.bindings.SMART_STRIP_TOUCH;
      else mode.bindings.SMART_STRIP_TOUCH = touchBinding;
    }
    if (isPad(this.selected)) {
      mode.pads[Number(this.selected.slice(4)) - 1] = { color: num('color'), brightness: mode.pads[Number(this.selected.slice(4)) - 1].brightness,
        ...(val('color-mode') === 'dual' ? { onColor: num('on-color') } : {}) };
      const action = val('press-type');
      let press: PressureBinding = { type: 'off' };
      if (action === 'note') press = { type: 'note', channel: num('press-channel'), note: num('press-note'), velocity: num('press-velocity'), offThreshold: num('press-off-threshold'), onThreshold: num('press-on-threshold') };
      else if (action === 'cc') press = { type: 'cc', channel: num('press-channel'), controller: num('press-controller'), from: num('press-from'), to: num('press-to') };
      else if (action === 'poly-pressure') press = { type: 'poly-pressure', channel: num('press-channel'), note: num('press-note'), from: num('press-from'), to: num('press-to') };
      else if (action === 'channel-pressure') press = { type: 'channel-pressure', channel: num('press-channel'), from: num('press-from'), to: num('press-to') };
      else if (action === 'pitchbend') press = { type: 'pitchbend', channel: num('press-channel'), from: num('press-from'), to: num('press-to') };
      if (press.type === 'off') {
        delete mode.pressureBindings?.[this.selected];
        if (mode.pressureBindings && !Object.keys(mode.pressureBindings).length) delete mode.pressureBindings;
      } else (mode.pressureBindings ??= {})[this.selected] = press;
    }
    if (this.selected === 'SMART_STRIP') mode.stripLight = {
      mode: val('strip-led-mode') as StripLightMode, brightness: val('strip-led-brightness') as Brightness,
      color: num('strip-led-color')
    };
    this.profile = parseProfile(next); this.bindingDirty = false;
    const saved = this.commit(); this.renderBinding();
    if (saved) this.options.toast(t('applied_to_the_current_mode_and_saved_the_profile'));
  }
  private saveModeEdit(): void {
    const name = this.el<HTMLInputElement>('mode-name').value.trim();
    if (!name) return this.options.toast(t('enter_a_mode_name'));
    if (this.bindingDirty && !this.applyPending()) return;
    this.currentMode().name = name; this.editingMode = false;
    const saved = this.commit(); this.renderBinding();
    if (!saved) this.editingMode = true;
    this.renderEditStates();
  }
  private commit(): boolean {
    this.runtime.applyProfile(this.profile); this.history.record(this.profile); this.renderPressed();
    let saved = false;
    try {
      this.library.save(this.profile);
      saved = true;
      this.profileDirty = this.editingProfile && this.el<HTMLInputElement>('profile-name').value.trim() !== this.profile.name
        || this.editingMode && this.el<HTMLInputElement>('mode-name').value.trim() !== this.currentMode().name;
    } catch (error) {
      this.profileDirty = true;
      this.options.toast(t('could_not_save', {p0: formatError(error)}));
    }
    this.renderLibrary(); this.renderModes(); this.renderMap(); this.queueModeLights(); this.renderSaveState();
    return saved;
  }
  private applyPending(): boolean {
    if (this.bindingDirty) {
      if (!this.el<HTMLFormElement>('binding-form').reportValidity()) return false;
      try { this.applyBinding(); } catch (error) { this.options.toast(formatError(error)); return false; }
    }
    const name = this.el<HTMLInputElement>('profile-name').value.trim();
    if (!name) { this.options.toast(t('enter_a_profile_name')); this.el('profile-name').focus(); return false; }
    this.profile.name = name; return true;
  }
  private save(): void {
    if (!this.applyPending()) return;
    try {
      this.library.save(this.profile); this.history.record(this.profile); this.profileDirty = false; this.editingProfile = false;
      this.renderLibrary(); this.renderEditStates(); this.renderSaveState();
      this.options.toast(t('profile_saved'));
    } catch (error) { this.options.toast(t('could_not_save', {p0: formatError(error)})); }
  }
  private controlSummary(id: ControlId): string {
    const mode = this.currentMode();
    const hit = this.bindingLabel(mode.bindings[id]);
    if (isPad(id)) {
      const press = mode.pressureBindings?.[id];
      return `${getLocale() === 'en' ? 'Hit: ' : 'Hit：'}${hit}\n${getLocale() === 'en' ? 'Press: ' : 'Press：'}${press && press.type !== 'off' ? this.pressureLabel(press) : t('disabled')}`;
    }
    const touch = id === 'SMART_STRIP' ? mode.bindings.SMART_STRIP_TOUCH : undefined;
    return `${hit}${touch && touch.type !== 'none' ? ` · Touch ${this.bindingLabel(touch)}` : ''}`;
  }
  private bindingLabel(binding?: Binding): string {
    if (!binding || binding.type === 'none') return t('unmapped');
    if (binding.type === 'fixed-velocity') return `${t('fixed_velocity_output')} · ${binding.velocity} · Toggle`;
    if (binding.type === 'mode') return t('mode_2', {p0: this.profile.modes.find(m => m.id === binding.modeId)?.name ?? binding.modeId});
    if (binding.type === 'note') return `CH ${binding.channel} · Note ${binding.note} · ${binding.mode === 'toggle' ? 'Toggle' : 'Gate'}`;
    if (binding.type === 'cc') return `CH ${binding.channel} · CC ${binding.controller}${['momentary', 'toggle', 'trigger', 'inc'].includes(binding.style) ? ` · ${{ momentary: 'Gate', toggle: 'Toggle', trigger: 'Trigger', inc: 'Inc' }[binding.style as 'momentary' | 'toggle' | 'trigger' | 'inc']}` : binding.style === 'strip' ? ` · ${{ absolute: 'Absolute', relative: 'Relative', 'relative-offset': 'Relative (Offset)' }[binding.mode ?? 'absolute']}` : ''}`;
    if (binding.type === 'strip-position' || binding.type === 'value') return `CH ${binding.channel} · ${{ 'poly-pressure': 'Poly Pressure', 'channel-pressure': 'Channel Pressure', program: 'Program Change', pitchbend: 'Pitchbend' }[binding.output]}${binding.output === 'poly-pressure' ? ` · Note ${binding.note}` : ''}`;
    if (binding.type === 'button-value') return `CH ${binding.channel} · ${{ 'poly-pressure': 'Poly Pressure', 'channel-pressure': 'Channel Pressure', program: 'Program Change', pitchbend: 'Pitchbend' }[binding.output]}${binding.output === 'poly-pressure' ? ` · Note ${binding.note}` : ''} · ${binding.mode === 'gate' ? 'Gate' : binding.mode === 'inc' ? 'Inc' : binding.mode === 'trigger' ? 'Trigger' : 'Toggle'}`;
    if (binding.type === 'system') return binding.command;
    return `CH ${binding.channel} · Program ${binding.program}`;
  }
  private syncPadColorFields(): void {
    const dual = (document.getElementById('bind-color-mode') as HTMLSelectElement | null)?.value === 'dual';
    const label = this.el('pad-light').querySelector<HTMLElement>('[data-pad-dual]');
    if (label) {
      label.hidden = !dual;
      label.querySelector<HTMLSelectElement>('select')!.disabled = !dual;
    }
  }
  private readStripLightDraft(): { mode: StripLightMode; brightness: Brightness; color?: number } | null {
    if (this.selected !== 'SMART_STRIP') return null;
    const mode = (document.getElementById('bind-strip-led-mode') as HTMLSelectElement | null)?.value as StripLightMode | undefined;
    const brightness = (document.getElementById('bind-strip-led-brightness') as HTMLSelectElement | null)?.value as Brightness | undefined;
    const colorValue = (document.getElementById('bind-strip-led-color') as HTMLSelectElement | null)?.value;
    return mode && brightness ? { mode, brightness, color: colorValue === undefined ? 17 : Number(colorValue) } : null;
  }
  private readPadLightDraft(): PadLight | null {
    if (this.selection.size !== 1 || !isPad(this.selected)) return null;
    const colorInput = document.getElementById('bind-color') as HTMLSelectElement | null;
    if (!colorInput) return null;
    const color = Number(colorInput.value);
    const dual = (document.getElementById('bind-color-mode') as HTMLSelectElement | null)?.value === 'dual';
    const onColor = dual ? Number((document.getElementById('bind-on-color') as HTMLSelectElement | null)?.value) : undefined;
    const brightness = this.currentMode().pads[Number(this.selected.slice(4)) - 1].brightness;
    if (!Number.isInteger(color) || color < 0 || color >= PAD_COLORS.length ||
      onColor !== undefined && (!Number.isInteger(onColor) || onColor < 0 || onColor >= PAD_COLORS.length) ||
      !['off', 'dim', 'normal', 'bright'].includes(brightness)) return null;
    return { color, onColor, brightness };
  }
  private paintPad(button: HTMLButtonElement, light: PadLight, preview = false): void {
    button.style.setProperty('--pad-color', PAD_PREVIEW[light.color]);
    button.classList.toggle('has-light', light.color !== 0 && light.brightness !== 'off');
    button.classList.toggle('preview-light', preview);
    button.dataset.brightness = light.brightness;
  }
  private previewPadLight(): void {
    const draft = this.readPadLightDraft();
    if (!draft) return;
    const saved = this.currentMode().pads[Number(this.selected.slice(4)) - 1];
    const preview = draft.color !== saved.color || (draft.onColor ?? draft.color) !== (saved.onColor ?? saved.color) || draft.brightness !== saved.brightness;
    const button = this.el('hardware').querySelector<HTMLButtonElement>(`[data-control="${this.selected}"]`);
    if (!button) return;
    this.paintPad(button, { ...draft, brightness: this.currentMode().padOffBrightness ?? draft.brightness }, preview);
    button.title = `${controlName(this.selected)} · ${this.controlSummary(this.selected)}${preview ? t('light_preview_not_applied') : ''}`;
    button.setAttribute('aria-label', t('select', {p0: button.title}));
    button.removeAttribute('data-i18n-aria-label'); button.removeAttribute('data-i18n-aria-label-params');
  }
  private renderMap(): void {
    const count = new Set([
      ...Object.entries(this.currentMode().bindings).filter(([, b]) => b && b.type !== 'none').map(([id]) => id === 'SMART_STRIP_TOUCH' ? 'SMART_STRIP' : id),
      ...Object.entries(this.currentMode().pressureBindings ?? {}).filter(([, b]) => b && b.type !== 'off').map(([id]) => id)
    ]).size;
    this.el('hardware').querySelectorAll<HTMLButtonElement>('[data-control]').forEach(button => {
      const id = button.dataset.control as ControlId, binding = this.currentMode().bindings[id];
      const press = isPad(id) ? this.currentMode().pressureBindings?.[id] : undefined;
      const touch = id === 'SMART_STRIP' ? this.currentMode().bindings.SMART_STRIP_TOUCH : undefined;
      const mapped = Boolean(binding && binding.type !== 'none' || press && press.type !== 'off' || touch && touch.type !== 'none');
      button.classList.toggle('is-mapped', mapped); button.classList.toggle('selected', this.selection.has(id));
      button.setAttribute('aria-pressed', String(this.selection.has(id)));
      button.title = `${controlName(id)} · ${this.controlSummary(id)}`;
      button.setAttribute('aria-label', t('select', {p0: button.title}));
    button.removeAttribute('data-i18n-aria-label'); button.removeAttribute('data-i18n-aria-label-params');
      if (PAD_IDS.includes(id as `PAD_${number}`)) {
        const light = this.currentMode().pads[Number(id.slice(4)) - 1];
        this.paintPad(button, { ...light, brightness: this.currentMode().padOffBrightness ?? light.brightness });
        button.querySelector('.pad-assignment')!.textContent = binding?.type === 'note' ? `CH ${binding.channel} / ${binding.note}` : this.bindingLabel(binding);
      }
    });
    this.el('mapped-count').textContent = t('controls_mapped', {p0: count});
    this.renderEditActions();
  }
  private renderPorts(): void {
    const select = this.el<HTMLSelectElement>('output');
    if (!select) return;
    const midi = this.runtime.snapshot.midi;
    select.innerHTML = `<option value="" data-i18n="disable_midi_output">${t('disable_midi_output')}</option>` + midi.ports.map(p => `<option value="${html(p.id)}">${html(p.name)}</option>`).join('');
    select.disabled = !midi.enabled; select.value = midi.output?.id ?? '';
    this.el('status').textContent = midi.output ? t('output', {p0: midi.output.name}) : t('no_midi_output_selected');
  }
  private handleEvent(event: InputEvent): void {
    if (event.kind === 'button' && event.pressed)
      this.selectHardwareControl(event.controlId === 'SMART_STRIP_TOUCH' ? 'SMART_STRIP' : event.controlId);
    else if (event.kind === 'pad' && event.raw > 0 && (event.event === 'note-on' || event.event === 'press-on'))
      this.selectHardwareControl(event.controlId);
    else if (event.kind === 'encoder' && event.delta !== 0) this.selectHardwareControl('ENCODER_ROTATE');
    else if (event.kind === 'strip' && event.raw > 0) this.selectHardwareControl('SMART_STRIP');
  }
  private renderPressed(): void {
    const state = this.runtime.snapshot;
    const pressed = new Set(state.pressedButtons), activePads = new Set(state.activePads);
    document.querySelectorAll<HTMLElement>('[data-control]').forEach(button => {
      if (!button.dataset.control?.startsWith('PAD_')) button.classList.toggle('is-pressed', pressed.has(button.dataset.control!));
    });
    document.querySelectorAll<HTMLButtonElement>('[data-control^="PAD_"]').forEach(button => {
      const id = button.dataset.control as `PAD_${number}`;
      if (!PAD_IDS.includes(id)) return;
      const pressed = activePads.has(id);
      button.classList.toggle('is-pressed', pressed);
      const light = this.currentMode().pads[Number(id.slice(4)) - 1];
      this.paintPad(button, pressed ? { color: light.onColor ?? light.color, brightness: this.currentMode().padOnBrightness ?? 'bright' } : { ...light, brightness: this.currentMode().padOffBrightness ?? light.brightness });
    });
  }
  private queueModeLights(): void {
    this.renderLightPreview(this.runtime.snapshot.lightReport);
  }
  private renderLightPreview(report: OutputReport): void {
    const stripLight = this.currentMode().stripLight;
    this.el('hardware').querySelectorAll<HTMLElement>('.strip-light').forEach((dot, index) => {
      dot.classList.toggle('is-lit', report.data[55 + index] !== 0);
      dot.dataset.brightness = stripLight?.brightness ?? 'normal';
      dot.style.setProperty('--strip-led-color', PAD_PREVIEW[stripLight?.color ?? 17]);
    });
    for (let index = 0; index < 39; index++) {
      const button = this.el('hardware').querySelector<HTMLElement>(`[data-control="${BUTTON_IDS[index]}"]`);
      if (!button) continue;
      button.classList.toggle('has-button-light', report.data[index] !== 0);
      button.dataset.lightBrightness = report.data[index] === 0x7f ? 'bright' : report.data[index] === 0x7c ? 'dim' : 'normal';
    }
  }
  private renderDevice(): void {
    const state = this.runtime.snapshot;
    const connected = Boolean(state.device);
    const supported = state.device?.outputReportIds.includes(0x80);
    this.el<HTMLInputElement>('led-enable').disabled = !connected || !supported;
    this.el<HTMLInputElement>('led-enable').checked = state.ledEnabled;
    this.el('led-summary').textContent = state.ledEnabled ? t('controlled') : t('not_controlled');
    this.el('led-status').textContent = (state.ledIssue ? formatError(state.ledIssue) : state.ledStatus) || (!connected
      ? t('connecting_does_not_automatically_send_led_or_screen_reports')
      : !supported ? t('this_hid_interface_does_not_declare_output_0x80_led_takeover_is_unavaila')
      : !state.ledEnabled ? t('device_ready_enable_takeover_to_control_pad_button_and_strip_lights') : '');
  }
}
