import { parseProfile, type ControlId, type Profile } from '@midiy/mikro-core';
import { EditHistory, copyControls, pasteControls, patchControls, type ControlCopy } from './editor-model';

/** Mikro editor state only. No DOM, Runtime, storage or physical output. */
export class EditorSession {
  profile: Profile;
  profileDirty = false;
  bindingDirty = false;
  padTab: 'hit' | 'press' = 'hit';
  stripTab: 'position' | 'touch' = 'position';
  editingProfile = false;
  editingMode = false;
  selected: ControlId = 'PAD_1';
  selection = new Set<ControlId>(['PAD_1']);
  batchChanges: Record<string, unknown> = {};
  pendingPaste: Profile | null = null;
  singleDraft: { action: string; values: Record<string, string | boolean> } | null = null;
  copied: ControlCopy[] = [];
  history: EditHistory;
  hardwareSelectionPending = false;
  followHardwareSelection = false;
  editorModeId: string;
  inspector: 'mode' | 'control' = 'control';
  constructor(profile: Profile) {
    this.profile = parseProfile(profile);
    this.editorModeId = profile.initialModeId;
    this.history = new EditHistory(this.profile);
  }
  currentMode() { return this.profile.modes.find(mode => mode.id === this.editorModeId)!; }
  ensureEditorMode() {
    if (!this.profile.modes.some(mode => mode.id === this.editorModeId)) this.editorModeId = this.profile.initialModeId;
  }
  setSingleDraft(action: string, values: Record<string, string | boolean>) {
    this.singleDraft = { action, values: { ...values } };
  }
  discardDraft() { this.singleDraft = null; this.bindingDirty = false; this.batchChanges = {}; this.pendingPaste = null; }
  /** The caller decides whether the user confirmed discarding the current draft. */
  select(ids: ControlId[], confirmed: boolean): boolean {
    if (this.bindingDirty && !confirmed) return false;
    this.discardDraft(); this.selection = new Set(ids); this.selected = ids[0] ?? this.selected;
    return true;
  }
  copy() { this.copied = copyControls(this.profile, this.editorModeId, [...this.selection]); }
  pasteDraft() { return pasteControls(this.profile, this.editorModeId, [...this.selection], this.copied); }
  batchDraft() { return this.pendingPaste ?? patchControls(this.profile, this.editorModeId, [...this.selection], this.batchChanges); }
  applyDraft(next: Profile) { this.profile = parseProfile(next); this.discardDraft(); }
  load(profile: Profile, dirty: boolean) {
    this.profile = parseProfile(profile); this.editorModeId = profile.initialModeId;
    this.history = new EditHistory(this.profile); this.discardDraft();
    this.profileDirty = dirty; this.editingProfile = false; this.editingMode = false;
  }
}
