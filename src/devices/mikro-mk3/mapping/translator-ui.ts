import {
  type Binding, type Brightness, type ControlId,
  type InputEvent,
  type OutputReport,
  type PadLight,
  type PressureBinding,
  type Profile,
  type StripLightMode
} from '@midiy/mikro-core';
import { formatError, getLocale, onLocaleChange, t, translateLabel } from '../../../i18n/index';
import { confirmAction } from '../../../shared/dialogs';
import { NotePreferences, noteSummary, type MiddleC, type NoteInputMode } from '../../../shared/notes/note-format';
import { NoteInputs, noteFieldMarkup } from '../../../shared/notes/note-input';
import { MikroDriver } from '../driver';
import { TranslatorRuntime } from '../runtime';
import * as batchEditor from './batch-editor';
import * as bindingEditor from './binding-editor';
import * as connectionPanel from './connection-panel';
import { EditorSession } from './editor-session';
import * as feedbackPreview from './feedback-preview';
import * as feedbackSettings from './feedback-settings';
import * as hardwareWorkspace from './hardware-workspace';
import * as padEditor from './bindings/pad-editor';
import { ProfileLibrary } from './profile-library';
import * as profileModePanel from './profile-mode-panel';
import * as stripEditor from './bindings/strip-editor';
import * as workspaceMarkup from './workspace-markup';

import type { TranslatorOptions } from './view-contracts';
import { controlName, isPad } from './view-helpers';
export class TranslatorUI {
  private readonly notePreferences: NotePreferences;
  private noteInputs?: NoteInputs;
  private readonly workspaceMarkupContext: workspaceMarkup.WorkspaceMarkupContext;
  private readonly profileModePanelContext: profileModePanel.ProfileModePanelContext;
  private readonly hardwareWorkspaceContext: hardwareWorkspace.HardwareWorkspaceContext;
  private readonly feedbackPreviewContext: feedbackPreview.FeedbackPreviewContext;
  private readonly feedbackSettingsContext: feedbackSettings.FeedbackSettingsContext;
  private readonly connectionPanelContext: connectionPanel.ConnectionPanelContext;
  private readonly bindingEditorContext: bindingEditor.BindingEditorContext;
  private readonly padEditorContext: padEditor.PadEditorContext;
  private readonly stripEditorContext: stripEditor.StripEditorContext;
  private readonly batchEditorContext: batchEditor.BatchEditorContext;
  private readonly session: EditorSession;
  private readonly previewDriver = new MikroDriver();
  constructor(private readonly runtime: TranslatorRuntime, private readonly library: ProfileLibrary,
    private readonly options: TranslatorOptions) {
    this.notePreferences = options.notePreferences ?? new NotePreferences();
    this.session = new EditorSession(library.current);
    const owner = this;
    this.workspaceMarkupContext = {
      el: (...args) => this.el(...args),
    };
    this.profileModePanelContext = {
      applyBinding: (...args) => this.applyBinding(...args),
      commit: (...args) => this.commit(...args),
      currentMode: (...args) => this.currentMode(...args),
      discardBindingDraft: (...args) => this.discardBindingDraft(...args),
      el: (...args) => this.el(...args),
      ensureEditorMode: (...args) => this.ensureEditorMode(...args),
      guard: (...args) => this.guard(...args),
      library: this.library,
      options: this.options,
      queueModeLights: (...args) => this.queueModeLights(...args),
      renderBinding: (...args) => this.renderBinding(...args),
      renderEditActions: (...args) => this.renderEditActions(...args),
      renderLedSettings: (...args) => this.renderLedSettings(...args),
      renderMap: (...args) => this.renderMap(...args),
      renderPressed: (...args) => this.renderPressed(...args),
      runtime: this.runtime,
      session: this.session,
    };
    this.hardwareWorkspaceContext = {
      selectControl: (id, extend) => this.selectControl(id, extend),
      bindingLabel: (...args) => this.bindingLabel(...args),
      controlSummary: (...args) => this.controlSummary(...args),
      copySelection: (...args) => this.copySelection(...args),
      currentMode: (...args) => this.currentMode(...args),
      discardBindingDraft: (...args) => this.discardBindingDraft(...args),
      el: (...args) => this.el(...args),
      guard: (...args) => this.guard(...args),
      markBindingDirty: (...args) => this.markBindingDirty(...args),
      noteLabel: (...args) => this.noteLabel(...args),
      options: this.options,
      paintPad: (...args) => this.paintPad(...args),
      pasteSelection: (...args) => this.pasteSelection(...args),
      previewBatch: (...args) => this.previewBatch(...args),
      previewPadLight: (...args) => this.previewPadLight(...args),
      queueModeLights: (...args) => this.queueModeLights(...args),
      renderBatch: (...args) => this.renderBatch(...args),
      renderBinding: (...args) => this.renderBinding(...args),
      renderEditActions: (...args) => this.renderEditActions(...args),
      renderModes: (...args) => this.renderModes(...args),
      restoreEdit: (...args) => this.restoreEdit(...args),
      runtime: this.runtime,
      session: this.session,
    };
    this.feedbackPreviewContext = {
      controlSummary: (...args) => this.controlSummary(...args),
      currentMode: (...args) => this.currentMode(...args),
      el: (...args) => this.el(...args),
      previewDriver: this.previewDriver,
      readPadLightDraft: (...args) => this.readPadLightDraft(...args),
      runtime: this.runtime,
      session: this.session,
    };
    this.feedbackSettingsContext = {
      currentMode: (...args) => this.currentMode(...args),
      el: (...args) => this.el(...args),
      library: this.library,
      options: this.options,
      queueModeLights: (...args) => this.queueModeLights(...args),
      renderPressed: (...args) => this.renderPressed(...args),
      renderSaveState: (...args) => this.renderSaveState(...args),
      runtime: this.runtime,
      session: this.session,
    };
    this.connectionPanelContext = {
      el: (...args) => this.el(...args),
      guard: (...args) => this.guard(...args),
      options: this.options,
      runtime: this.runtime,
    };
    this.bindingEditorContext = {
      applyBinding: () => this.applyBinding(),
      controlSummary: (...args) => this.controlSummary(...args),
      currentMode: (...args) => this.currentMode(...args),
      el: (...args) => this.el(...args),
      guard: (...args) => this.guard(...args),
      markBindingDirty: (...args) => this.markBindingDirty(...args),
      noteField: (...args) => this.noteField(...args),
      get noteInputs() { return owner.noteInputs; },
      previewPadLight: (...args) => this.previewPadLight(...args),
      renderBatch: (...args) => this.renderBatch(...args),
      renderPressFields: (...args) => this.renderPressFields(...args),
      renderSaveState: (...args) => this.renderSaveState(...args),
      renderTouchFields: (...args) => this.renderTouchFields(...args),
      session: this.session,
      syncStripCcFields: (...args) => this.syncStripCcFields(...args),
    };
    this.padEditorContext = {
      currentMode: (...args) => this.currentMode(...args),
      el: (...args) => this.el(...args),
      noteField: (...args) => this.noteField(...args),
      get noteInputs() { return owner.noteInputs; },
      noteLabel: (...args) => this.noteLabel(...args),
      session: this.session,
    };
    this.stripEditorContext = {
      el: (...args) => this.el(...args),
      noteField: (...args) => this.noteField(...args),
      get noteInputs() { return owner.noteInputs; },
      session: this.session,
      syncCcFields: (...args) => this.syncCcFields(...args),
    };
    this.batchEditorContext = {
      el: (...args) => this.el(...args),
      get noteInputs() { return owner.noteInputs; },
      notePreferences: this.notePreferences,
      renderControlTabs: (...args) => this.renderControlTabs(...args),
      renderEditActions: (...args) => this.renderEditActions(...args),
      session: this.session,
    };
    this.mount();
    this.notePreferences.subscribe(() => this.refreshNoteDisplay());
    let midiStatus = '', deviceStatus = '';
    runtime.subscribe(event => {
      if (event.type === 'state') {
        const midi = JSON.stringify(event.state.midi);
        const device = JSON.stringify([event.state.device, event.state.ledEnabled, event.state.ledStatus]);
        if (device !== deviceStatus) { deviceStatus = device; this.renderDevice(); }
        if (midi !== midiStatus) { midiStatus = midi; this.renderPorts(); }
        this.renderPlayingMode(); this.renderPressed(); this.queueModeLights(); this.previewBatch();
      } else if (event.type === 'decoded' && !event.handled) this.handleEvent(event.event);
      else if (event.type === 'mode') {
        // Hardware mode changes may follow in the clean mapping editor; never replace Mode browsing or a draft.
        if (this.session.inspector === 'control' && !this.session.bindingDirty && !this.session.editingMode) {
          this.session.editorModeId = runtime.activeModeId;
          this.renderModes(); this.renderBinding(); this.renderMap();
        }
        this.renderPlayingMode();
      }
    });
    onLocaleChange(() => {
      // Translate labels in place: never re-render forms or reset their dirty state.
      this.el('selected').textContent = this.session.selection.size === 1 ? controlName(this.session.selected) : t('selected_control_count', { p0: this.session.selection.size });
      this.el('draft-state').textContent = this.session.bindingDirty ? t('not_applied') : t('applied');
      this.el('hit-heading').textContent = isPad(this.session.selected) ? t('pad_hit_strike') : this.session.selected === 'SMART_STRIP' ? t('strip_position_position') : 'MIDI OUTPUT';
      this.el('binding-summary').textContent = this.controlSummary(this.session.selected);
      this.noteInputs?.refresh();
      this.renderModeShortcut(); this.renderPlayingMode(); this.renderTriggerPicker(); this.renderHelp(); this.renderSaveState(); this.renderPorts(); this.renderDevice();
      this.renderMap(); this.renderPressed();
      if (this.session.bindingDirty) this.previewPadLight();
    });
    if (library.warning) options.toast(translateLabel(library.warning));
  }
  private noteField(id: string, label: string, value: number): string {
    return noteFieldMarkup(`bind-${id}`, label, value, this.notePreferences.current);
  }
  private noteLabel(note: number): string { return noteSummary(note, this.notePreferences.current.middleC); }
  private refreshNoteDisplay(): void {
    // Never renderBinding/applyProfile: canonical values, partial fields and all other drafts stay intact.
    this.noteInputs?.refresh();
    this.el('binding-summary').textContent = this.session.selection.size === 1 ? this.controlSummary(this.session.selected) : [...this.session.selection].map(controlName).join(' · ');
    this.renderMap(); this.renderPressed(); this.previewBatch();
    if (this.session.bindingDirty && this.session.selection.size === 1) this.previewPadLight();
  }
  private el<T extends HTMLElement = HTMLElement>(id: string): T { return document.getElementById(`midi-${id}`) as T; }
  private mount(): void {
    this.mountMarkup();
    this.mountHardware();
    this.noteInputs = new NoteInputs(this.el('binding-form'), this.notePreferences, () => this.markBindingDirty());
    this.el<HTMLSelectElement>('note-octave').value = String(this.notePreferences.current.middleC);
    this.el<HTMLSelectElement>('note-input-mode').value = this.notePreferences.current.inputMode;
    this.el('note-octave').addEventListener('change', () => this.notePreferences.update({ middleC: Number(this.el<HTMLSelectElement>('note-octave').value) as MiddleC }));
    this.el('note-input-mode').addEventListener('change', () => this.notePreferences.update({ inputMode: this.el<HTMLSelectElement>('note-input-mode').value as NoteInputMode }));
    const updateNotePreferences = () => {
      this.el('note-preferences').hidden = this.session.inspector === 'mode' || this.el('binding-form').hidden || !this.el('binding-form').querySelector('[data-note-input]');
    };
    new MutationObserver(updateNotePreferences).observe(this.el('binding-form'), { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden'] });
    this.mountBinding();
    this.mountProfiles();
    this.mountConnection();
    this.mountFeedback();
    this.renderLibrary();
    this.renderModes();
    this.renderEditStates();
    this.renderBinding();
    this.renderMap();
    this.renderPorts();
    this.renderDevice();
    this.renderSaveState();
    this.queueModeLights();
  }

  private renderEditActions(): void {
    this.renderTriggerPicker();
    this.el<HTMLButtonElement>('undo').disabled = !this.session.history.canUndo;
    this.el<HTMLButtonElement>('redo').disabled = !this.session.history.canRedo;
    this.el<HTMLButtonElement>('copy-controls').disabled = !this.session.selection.size;
    this.el<HTMLButtonElement>('paste-controls').disabled = !this.session.selection.size || !this.session.copied.length;
    this.el('selection-count').textContent = t('selected_control_count', { p0: this.session.selection.size });
  }
  private copySelection(): void {
    if (!this.session.selection.size) return;
    this.session.copy();
    this.renderEditActions(); this.options.toast(t('controls_copied', { p0: this.session.copied.length }));
  }
  private async pasteSelection(): Promise<void> {
    if (!this.session.selection.size || !this.session.copied.length) return;
    let draft: Profile;
    try { draft = this.session.pasteDraft(); }
    catch (error) { this.options.toast(t(error instanceof Error && error.message === 'paste_count_mismatch' ? 'paste_count_mismatch' : 'paste_incompatible')); return; }
    if (!await this.discardBindingDraft()) return;
    this.session.pendingPaste = draft; this.markBindingDirty(); this.renderBatch(); this.previewBatch();
    this.options.toast(t('paste_ready_to_apply'));
  }
  private async restoreEdit(redo: boolean): Promise<void> {
    const next = this.session.history.peek(redo); if (!next) return;
    if (this.session.editingProfile || this.session.editingMode) return this.options.toast(t('finish_name_edit_first'));
    if (!await this.discardBindingDraft()) return;
    try { this.library.save(next); } catch (error) { this.options.toast(t('could_not_save', { p0: formatError(error) })); return; }
    const previous = this.session.profile;
    // Feedback-only history must not flush a held note or a Toggle's ownership.
    const structure = (profile: Profile) => JSON.stringify({
      ...profile, padVelocityCurve: undefined, modes: profile.modes.map(mode => ({
        ...mode,
        color: undefined, buttonLight: undefined, toggleButtonLight: undefined, padOffBrightness: undefined, padOnBrightness: undefined
      }))
    });
    this.session.history.move(redo); this.session.profile = next; this.ensureEditorMode(); this.session.profileDirty = false;
    if (structure(previous) === structure(next)) { this.runtime.updateFeedback(next); this.runtime.setVelocityCurve(next.padVelocityCurve); }
    else this.runtime.applyProfile(next);
    this.renderLibrary(); this.renderModes(); this.renderBinding(); this.renderMap(); this.renderPressed(); this.queueModeLights(); this.renderSaveState();
  }
  private renderControlTabs(): void { return bindingEditor.renderControlTabs(this.bindingEditorContext); }
  private renderBatch(): void { return batchEditor.renderBatch(this.batchEditorContext); }
  private previewBatch(): void { return feedbackPreview.previewBatch(this.feedbackPreviewContext); }
  private async guard(action: () => void | Promise<void>): Promise<void> {
    try { await action(); } catch (error) { this.options.toast(formatError(error)); }
  }
  private ensureEditorMode(): void {
    this.session.ensureEditorMode();
  }
  private currentMode() { return this.session.currentMode(); }
  async selectControl(id: ControlId, extend = false): Promise<void> { return hardwareWorkspace.selectControl(this.hardwareWorkspaceContext, id, extend); }
  private async discardBindingDraft(): Promise<boolean> {
    if (!this.session.bindingDirty) return true;
    if (!await confirmAction(t('this_control_has_unapplied_changes_discard_them'), t('discard_changes'))) return false;
    this.session.discardDraft(); return true;
  }
  private markBindingDirty(): void {
    bindingEditor.captureDraft(this.bindingEditorContext);
    this.session.bindingDirty = true;
    this.el('draft-state').textContent = t('not_applied'); this.el('draft-state').classList.add('unsaved');
    this.renderSaveState();
  }
  private renderLibrary(): void { return profileModePanel.renderLibrary(this.profileModePanelContext); }
  private renderEditStates(): void { return profileModePanel.renderEditStates(this.profileModePanelContext); }
  private renderSaveState(): void { return profileModePanel.renderSaveState(this.profileModePanelContext); }
  private renderPlayingMode(): void { return profileModePanel.renderPlayingMode(this.profileModePanelContext); }
  private renderTriggerPicker(): void { return profileModePanel.renderTriggerPicker(this.profileModePanelContext); }
  private renderModeShortcut(): void { return profileModePanel.renderModeShortcut(this.profileModePanelContext); }
  private renderModes(): void { return profileModePanel.renderModes(this.profileModePanelContext); }
  private renderLedSettings(): void { return feedbackSettings.renderLedSettings(this.feedbackSettingsContext); }
  private renderBinding(): void { return bindingEditor.renderBinding(this.bindingEditorContext); }
  private syncCcFields(container: 'fields' | 'strip-touch', prefix: string): void { return bindingEditor.syncCcFields(this.bindingEditorContext, container, prefix); }
  private syncStripCcFields(): void { return stripEditor.syncStripCcFields(this.stripEditorContext); }
  private renderTouchFields(existing?: Binding, fromSelection = false): void { return stripEditor.renderTouchFields(this.stripEditorContext, existing, fromSelection); }
  private pressureLabel(binding: PressureBinding): string { return padEditor.pressureLabel(this.padEditorContext, binding); }
  private renderPressFields(existing?: PressureBinding, fromSelection = false): void { return padEditor.renderPressFields(this.padEditorContext, existing, fromSelection); }
  private renderHelp(): void { return bindingEditor.renderHelp(this.bindingEditorContext); }
  private applyBinding(): void {
    if (!this.session.selection.size) return;
    const batch = this.session.pendingPaste || this.session.selection.size !== 1;
    if (batch && !this.el<HTMLFormElement>('binding-form').reportValidity()) return;
    if (!batch && this.session.selected === this.session.profile.modeSelector) return;
    const next = batch ? this.session.batchDraft() : bindingEditor.readDraft(this.bindingEditorContext);
    this.session.applyDraft(next);
    const saved = this.commit(); this.renderBinding();
    if (saved && !batch) this.options.toast(t('applied_to_the_current_mode_and_saved_the_profile'));
  }
  private commit(): boolean {
    this.ensureEditorMode();
    this.runtime.applyProfile(this.session.profile); this.session.history.record(this.session.profile); this.renderPressed();
    let saved = false;
    try {
      this.library.save(this.session.profile);
      saved = true;
      this.session.profileDirty = this.session.editingProfile && this.el<HTMLInputElement>('profile-name').value.trim() !== this.session.profile.name
        || this.session.editingMode && this.el<HTMLInputElement>('mode-name').value.trim() !== this.currentMode().name;
    } catch (error) {
      this.session.profileDirty = true;
      this.options.toast(t('could_not_save', { p0: formatError(error) }));
    }
    this.renderLibrary(); this.renderModes(); this.renderMap(); this.queueModeLights(); this.renderSaveState();
    return saved;
  }
  private controlSummary(id: ControlId): string {
    const mode = this.currentMode();
    if (id === this.session.profile.modeSelector) return t('mode_selector_key');
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
    if (binding.type === 'mode') return t('mode_2', { p0: this.session.profile.modes.find(m => m.id === binding.modeId)?.name ?? binding.modeId });
    if (binding.type === 'note') return `CH ${binding.channel} · ${this.noteLabel(binding.note!)} · ${binding.mode === 'toggle' ? 'Toggle' : 'Gate'}`;
    if (binding.type === 'cc') return `CH ${binding.channel} · CC ${binding.controller}${['momentary', 'toggle', 'trigger', 'inc'].includes(binding.style) ? ` · ${{ momentary: 'Gate', toggle: 'Toggle', trigger: 'Trigger', inc: 'Inc' }[binding.style as 'momentary' | 'toggle' | 'trigger' | 'inc']}` : binding.style === 'strip' ? ` · ${{ absolute: 'Absolute', relative: 'Relative', 'relative-offset': 'Relative (Offset)' }[binding.mode ?? 'absolute']}` : ''}`;
    if (binding.type === 'strip-position' || binding.type === 'value') return `CH ${binding.channel} · ${{ 'poly-pressure': 'Poly Pressure', 'channel-pressure': 'Channel Pressure', program: 'Program Change', pitchbend: 'Pitchbend' }[binding.output]}${binding.output === 'poly-pressure' ? ` · ${this.noteLabel(binding.note!)}` : ''}`;
    if (binding.type === 'button-value') return `CH ${binding.channel} · ${{ 'poly-pressure': 'Poly Pressure', 'channel-pressure': 'Channel Pressure', program: 'Program Change', pitchbend: 'Pitchbend' }[binding.output]}${binding.output === 'poly-pressure' ? ` · ${this.noteLabel(binding.note!)}` : ''} · ${binding.mode === 'gate' ? 'Gate' : binding.mode === 'inc' ? 'Inc' : binding.mode === 'trigger' ? 'Trigger' : 'Toggle'}`;
    if (binding.type === 'system') return binding.command;
    return `CH ${binding.channel} · Program ${binding.program}`;
  }
  private readPadLightDraft(): PadLight | null { return bindingEditor.readPadLightDraft(this.bindingEditorContext); }
  private paintPad(button: HTMLButtonElement, light: PadLight, preview = false): void { return feedbackPreview.paintPad(this.feedbackPreviewContext, button, light, preview); }
  private previewPadLight(): void { return feedbackPreview.previewPadLight(this.feedbackPreviewContext); }
  private renderMap(): void { return hardwareWorkspace.renderMap(this.hardwareWorkspaceContext); }
  private renderPorts(): void { return connectionPanel.renderPorts(this.connectionPanelContext); }
  private handleEvent(event: InputEvent): void { return hardwareWorkspace.handleEvent(this.hardwareWorkspaceContext, event); }
  private renderPressed(): void { return hardwareWorkspace.renderPressed(this.hardwareWorkspaceContext); }
  private queueModeLights(): void { return feedbackPreview.queueModeLights(this.feedbackPreviewContext); }
  private renderDevice(): void { return connectionPanel.renderDevice(this.connectionPanelContext); }
  private mountMarkup(): void { return workspaceMarkup.mountMarkup(this.workspaceMarkupContext); }

  private mountHardware(): void { return hardwareWorkspace.mountHardware(this.hardwareWorkspaceContext); }

  private mountBinding(): void { return bindingEditor.mountBinding(this.bindingEditorContext); }

  private mountProfiles(): void { return profileModePanel.mountProfiles(this.profileModePanelContext); }

  private mountConnection(): void { return connectionPanel.mountConnection(this.connectionPanelContext); }

  private mountFeedback(): void { return feedbackSettings.mountFeedback(this.feedbackSettingsContext); }

}
