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
const brightnessOptions = (selected: Brightness) => ([['off', '關閉'], ['dim', '低'], ['normal', '中'], ['bright', '高']] as const)
  .map(([value, label]) => `<option value="${value}" ${selected === value ? 'selected' : ''}>${label}</option>`).join('');
const controlName = (id: ControlId) => getControl(id)?.label ?? id;
const html = (text: unknown) => String(text).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const field = (id: string, label: string, value: number, min = 0, max = 127) => `<label>${label}<input id="bind-${id}" type="number" min="${min}" max="${max}" value="${value}" required></label>`;
const ccFields = (prefix: string, binding?: Binding, max = 127, includeActionOn = true) => {
  const cc = binding?.type === 'cc' && !['strip', 'encoder'].includes(binding.style) ? binding : undefined;
  const other = binding?.type === 'button-value' ? binding : undefined;
  const state = cc ?? other;
  const style = cc?.style ?? (other?.mode === 'gate' ? 'momentary' : other?.mode) ?? 'momentary';
  const number = (name: string, label: string, value: number, min: number, max: number, styles: string) =>
    `<label data-cc-fields="${styles}">${label}<input id="bind-${prefix}${name}" type="number" min="${min}" max="${max}" value="${value}" required></label>`;
  return `<label>Mode<select id="bind-${prefix}style"><option value="momentary">Gate（按住／放開）</option><option value="toggle">Toggle</option><option value="trigger">Trigger</option><option value="inc">Inc</option></select></label>`
    + number('on', 'On 值', state && 'on' in state ? state.on ?? max : max, 0, max, 'momentary toggle')
    + number('off', 'Off 值', state && 'off' in state ? state.off ?? 0 : 0, 0, max, 'momentary toggle')
    + number('value', '觸發值', state && 'value' in state ? state.value ?? max : max, 0, max, 'trigger')
    + number('from', 'Range From', state && 'from' in state ? state.from ?? 0 : 0, 0, max, 'inc')
    + number('to', 'Range To', state && 'to' in state ? state.to ?? max : max, 0, max, 'inc')
    + number('step', 'Step', state && 'step' in state ? state.step ?? 1 : 1, -127, 127, 'inc')
    + `<label data-cc-fields="inc">Wrap<input id="bind-${prefix}wrap" type="checkbox" ${state && 'wrap' in state && state.wrap ? 'checked' : ''}></label>`
    + (includeActionOn ? `<label data-cc-fields="toggle trigger inc">Action on<select id="bind-${prefix}action-on"><option value="down">按下</option><option value="up">放開</option></select></label>` : '')
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
  private hardwareSelectionPending = false;
  private get activeModeId() { return this.runtime.activeModeId; }
  constructor(private readonly runtime: TranslatorRuntime, private readonly library: ProfileLibrary,
    private readonly options: TranslatorOptions) {
    this.profile = library.current;
    this.mount();
    let midiStatus = '', deviceStatus = '';
    runtime.subscribe(event => {
      if (event.type === 'state') {
        const midi = JSON.stringify(event.state.midi);
        const device = JSON.stringify([event.state.device, event.state.ledEnabled, event.state.ledStatus]);
        if (device !== deviceStatus) { deviceStatus = device; this.renderDevice(); }
        if (midi !== midiStatus) { midiStatus = midi; this.renderPorts(); }
        this.renderPressed(); this.queueModeLights();
      } else if (event.type === 'decoded') this.handleEvent(event.event);
      else if (event.type === 'mode') { this.renderModes(); this.renderBinding(); this.renderMap(); }
    });
    if (library.warning) options.toast(library.warning);
  }
  private el<T extends HTMLElement = HTMLElement>(id: string): T { return document.getElementById(`midi-${id}`) as T; }
  private mount(): void {
    this.el('panel').innerHTML = `
      <section class="config-panel" aria-label="設定檔與模式">
        <div class="config-row">
          <label class="config-picker"><span class="config-picker-heading">設定檔 <span id="midi-save-status" class="save-status" role="status"></span></span><select id="midi-library" aria-label="選擇設定檔"></select><input id="midi-profile-name" maxlength="80" aria-label="編輯設定檔名稱" hidden></label>
          <div class="config-actions"><button id="midi-profile-edit" class="outline">編輯</button><button id="midi-profile-duplicate" class="outline">複製</button><button id="midi-save" class="primary" hidden>儲存</button><button id="midi-profile-delete" class="text-button danger" hidden>刪除</button></div>
          <div class="profile-file-actions"><button id="midi-export" class="text-button">匯出</button><label class="text-button file-button" tabindex="0" role="button">匯入<input id="midi-import" type="file" accept=".json,application/json" hidden></label></div>
        </div>
        <div class="config-row">
          <label class="config-picker">模式<select id="midi-mode" aria-label="選擇模式"></select><input id="midi-mode-name" maxlength="80" aria-label="編輯模式名稱" hidden></label>
          <div class="config-actions"><button id="midi-mode-edit" class="outline">編輯</button><button id="midi-add-mode" class="outline">複製</button><button id="midi-mode-save" class="primary" hidden>儲存</button><button id="midi-delete-mode" class="text-button danger" hidden>刪除</button></div>
          <label class="switch default-switch"><input id="midi-initial" type="checkbox">設為啟動模式</label>
        </div>
      </section>
      <div class="workspace mapping-workspace">
        <section class="panel mapping-device">
          <div class="section-heading"><div><p class="eyebrow">HARDWARE</p><h2>控制器參照圖</h2></div><span id="midi-mapped-count" class="section-note"></span></div>
          <div class="hardware-scroll"><div id="midi-hardware" class="hardware" aria-label="Mapping 控制器參照圖"></div></div>
          <div class="map-footer"><span><i class="dot selected-dot"></i>目前選取</span><span><i class="dot mapped-dot"></i>已映射</span><span><i class="dot idle-dot"></i>未映射</span></div>
          <p class="map-hint">點選參照圖上的控制項編輯。Pad 下方顯示 Channel／Note；控制項燈光套用後儲存，裝置燈光中的共用亮度切換後立即儲存。</p>
          <div class="device-settings">
          <details class="device-options" open><summary>裝置燈光 <span id="midi-led-summary">尚未接管</span></summary>
            <div class="led-takeover-row">
              <label class="switch"><input id="midi-led-enable" type="checkbox" disabled>接管 LED 輸出</label>
              <p id="midi-led-status" class="caption" role="status"></p>
            </div>
            <div class="led-settings">
              <p class="editor-section-label">本模式共用亮度</p>
              <label>一般按鍵待機亮度<select id="midi-button-idle-brightness"></select></label>
              <label>一般按鍵按下亮度<select id="midi-button-on-brightness"></select></label>
              <label>16 顆 Pad 按下亮度<select id="midi-pad-on-brightness"></select></label>
            </div>
            <p class="caption">變更後立即儲存於目前模式；一般按鍵亮度只套用至有映射的按鍵；Pad 待機亮度仍在各 Pad 設定。</p>
          </details>
          <details class="device-options velocity-options" open><summary>Pad 力度曲線</summary>
            <div class="led-settings">
              <label>Pad Velocity Curve<select id="midi-pad-velocity-curve">${PAD_VELOCITY_CURVES.map(value => `<option value="${value}">${value === 'linear' ? 'Linear' : value.replace('-', ' ').replace(/^./, c => c.toUpperCase())}</option>`).join('')}</select></label>
            </div>
            <p class="caption">套用至整份設定檔的 Pad 打擊力度，變更後立即儲存。Soft 讓輕敲更響亮；Hard 需要更用力敲。固定力度與 Press 壓力不受影響。</p>
          </details>
          </div>
        </section>
        <aside class="panel mapping-editor" aria-label="控制項編輯">
          <div class="editor-heading"><p class="eyebrow">CONTROL INSPECTOR</p><span id="midi-draft-state" class="draft-state" role="status">已套用</span></div>
          <h2 id="midi-selected">Pad 1</h2><p id="midi-binding-summary" class="binding-summary"></p>
          <form id="midi-binding-form">
            <div id="midi-hit-heading" class="editor-section-label">MIDI OUTPUT</div><label>輸出動作<select id="midi-action"></select></label>
            <div id="midi-fields" class="binding-fields"></div><div id="midi-strip-touch" class="binding-fields"></div><div id="midi-pad-press" class="binding-fields"></div><div id="midi-pad-light" class="binding-fields"></div>
            <button id="midi-apply" class="primary wide" type="submit">套用至目前模式</button>
          </form>
          <p id="midi-binding-help" class="caption"></p>
        </aside>
      </div>
      <div class="mapping-status"><span id="midi-status" role="status">未選擇 MIDI 輸出</span><span>設定檔保存在此瀏覽器 · 可匯出 JSON</span></div>`;
    renderHardware(this.el('hardware'), (id: string) => this.selectControl(id as ControlId), { includeEncoderTouch: true });
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
      if (this.editingMode) return this.options.toast('請先儲存模式名稱。');
      this.editingProfile = true; this.renderEditStates(); this.el<HTMLInputElement>('profile-name').focus();
    });
    this.el('profile-duplicate').addEventListener('click', () => this.guard(async () => {
      if (this.editingMode) return this.options.toast('請先儲存模式名稱。');
      if (!await this.discardBindingDraft()) return;
      const copy = parseProfile(this.profile); copy.name = `${copy.name} copy`;
      this.library.save(copy, true); this.loadProfile(copy, false);
      this.editingProfile = true; this.renderEditStates(); this.el<HTMLInputElement>('profile-name').focus();
      this.el<HTMLInputElement>('profile-name').select();
    }));
    this.el('profile-delete').addEventListener('click', () => this.guard(async () => {
      if (this.library.entries.length <= 1) return this.options.toast('至少保留一份設定檔。');
      if (!await confirmAction(`刪除整份設定檔「${this.profile.name}」及其所有模式？`, '刪除設定檔')) return;
      this.loadProfile(this.library.deleteActive(), false);
    }));
    this.el('profile-name').addEventListener('keydown', event => {
      if (event.key === 'Enter') { event.preventDefault(); this.save(); }
      if (event.key === 'Escape') { this.editingProfile = false; this.profileDirty = false; this.renderEditStates(); this.renderSaveState(); }
    });
    this.el('library').addEventListener('change', () => this.guard(async () => {
      const id = this.el<HTMLSelectElement>('library').value;
      if ((this.profileDirty || this.bindingDirty) && !await confirmAction('目前設定尚未儲存。捨棄變更並載入選取的設定檔？', '捨棄並載入')) return this.renderLibrary();
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
      if (this.editingProfile) return this.options.toast('請先儲存設定檔名稱。');
      this.editingMode = true; this.renderEditStates(); this.el<HTMLInputElement>('mode-name').focus();
    });
    this.el('mode-save').addEventListener('click', () => this.saveModeEdit());
    this.el('mode-name').addEventListener('keydown', event => {
      if (event.key === 'Enter') { event.preventDefault(); this.saveModeEdit(); }
      if (event.key === 'Escape') { this.editingMode = false; this.profileDirty = false; this.renderEditStates(); this.renderSaveState(); }
    });
    this.el('action').addEventListener('change', () => {
      const lightDraft = this.readPadLightDraft();
      const stripDraft = this.readStripLightDraft();
      this.renderFields(undefined, lightDraft ?? undefined, stripDraft ?? undefined); this.markBindingDirty(); this.previewPadLight();
    });
    this.el('binding-form').addEventListener('submit', event => { event.preventDefault(); this.guard(() => this.applyBinding()); });
    this.el('panic').addEventListener('click', () => {
      this.runtime.panic(); this.options.toast('已釋放目前音符及按住的 CC。');
    });
    this.el('add-mode').addEventListener('click', async () => {
      if (this.editingProfile) return this.options.toast('請先儲存設定檔名稱。');
      if (!await this.discardBindingDraft()) return;
      if (this.profile.modes.length >= 64) return this.options.toast('最多 64 個模式。');
      const copy = JSON.parse(JSON.stringify(this.currentMode()));
      copy.id = crypto.randomUUID(); copy.name = `${copy.name} copy`;
      this.profile.modes.push(copy); this.commit(); this.runtime.switchMode(copy.id);
      this.renderModes(); this.renderBinding(); this.renderMap(); this.renderPressed(); this.queueModeLights();
      this.editingMode = true; this.renderEditStates(); this.el<HTMLInputElement>('mode-name').focus();
      this.el<HTMLInputElement>('mode-name').select();
    });
    this.el('delete-mode').addEventListener('click', async () => {
      if (!await this.discardBindingDraft()) return;
      if (this.profile.modes.length === 1) return this.options.toast('至少保留一個模式。');
      if (!await confirmAction(`刪除模式「${this.currentMode().name}」？指向它的切換動作會停用。`, '刪除模式')) return;
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
      if (this.editingMode) return this.options.toast('請先儲存模式名稱。');
      if (!this.applyPending()) return;
      const a = document.createElement('a'), url = URL.createObjectURL(new Blob([JSON.stringify(this.profile, null, 2)], { type: 'application/json' }));
      a.href = url; a.download = 'midiy-profile.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
    this.el('import').addEventListener('change', event => this.guard(async () => {
      const input = event.target as HTMLInputElement, file = input.files?.[0]; input.value = '';
      if (!file) return;
      if (file.size > 1024 * 1024) throw new Error('MIDI 設定檔超過 1 MB');
      const next = parseProfile(JSON.parse(await file.text()));
      if (!await confirmAction('匯入會新增一份設定檔並切換到它；擷取工作階段不受影響。繼續？', '匯入設定檔')) return;
      this.library.save(next, true); this.loadProfile(next, false);
      this.options.toast('已匯入並儲存為新的設定檔。');
    }));
    this.el('led-enable').addEventListener('change', () => {
      this.runtime.setLedEnabled(this.el<HTMLInputElement>('led-enable').checked);
      this.renderDevice();
    });
    for (const id of ['button-idle-brightness', 'button-on-brightness', 'pad-on-brightness']) {
      this.el<HTMLSelectElement>(id).addEventListener('change', () => this.saveLedSettings());
    }
    this.el<HTMLSelectElement>('pad-velocity-curve').addEventListener('change', () => this.saveVelocityCurve());
    this.renderLibrary(); this.renderModes(); this.renderEditStates(); this.selectControl(this.selected); this.renderPorts(); this.renderDevice(); this.renderSaveState(); this.queueModeLights();
  }
  private async guard(action: () => void | Promise<void>): Promise<void> {
    try { await action(); } catch (error) { this.options.toast(error instanceof Error ? error.message : String(error)); }
  }
  private currentMode() { return this.profile.modes.find(m => m.id === this.activeModeId)!; }
  async selectControl(id: ControlId): Promise<void> {
    if (id !== this.selected && !await this.discardBindingDraft()) return;
    this.selected = id;
    this.el('selected').textContent = controlName(id); this.renderBinding(); this.renderMap();
  }
  private selectHardwareControl(id: ControlId): void {
    if (id === this.selected || this.hardwareSelectionPending || document.getElementById('page-mapping')?.hidden !== false) return;
    this.hardwareSelectionPending = true;
    void this.guard(async () => {
      try { await this.selectControl(id); }
      finally { this.hardwareSelectionPending = false; }
    });
  }
  private async discardBindingDraft(): Promise<boolean> {
    if (!this.bindingDirty) return true;
    if (!await confirmAction('此控制項的變更尚未套用。捨棄變更？', '捨棄變更')) return false;
    this.bindingDirty = false; return true;
  }
  private markBindingDirty(): void {
    this.bindingDirty = true;
    this.el('draft-state').textContent = '尚未套用'; this.el('draft-state').classList.add('unsaved');
    this.renderSaveState();
  }
  private renderLibrary(): void {
    this.el<HTMLSelectElement>('library').innerHTML = (this.library.activeId ? '' : '<option value="">新匯入的設定檔</option>') + this.library.entries.map(e => `<option value="${html(e.id)}">${html(e.profile.name)}</option>`).join('');
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
    this.el('save-status').textContent = this.profileDirty || this.bindingDirty ? '● 尚未儲存' : this.library.persisted ? '已儲存於此瀏覽器' : '內建預設 · 首次編輯後自動儲存';
    this.el('save-status').classList.toggle('unsaved', this.profileDirty || this.bindingDirty);
  }
  private loadProfile(profile: Profile, dirty: boolean): void {
    this.profile = profile; this.runtime.applyProfile(profile, true);
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
    this.el<HTMLSelectElement>('pad-on-brightness').innerHTML = brightnessOptions(mode.padOnBrightness ?? 'bright');
  }
  private saveVelocityCurve(): void {
    const next = parseProfile({ ...this.profile, padVelocityCurve: this.el<HTMLSelectElement>('pad-velocity-curve').value as PadVelocityCurve });
    try {
      this.library.save(next);
      this.profile = next;
      // Only future hits change; preserve held notes and their release targets.
      this.runtime.setVelocityCurve(next.padVelocityCurve!);
      this.renderSaveState();
    } catch (error) {
      this.el<HTMLSelectElement>('pad-velocity-curve').value = this.profile.padVelocityCurve ?? 'linear';
      this.options.toast(`力度曲線儲存失敗：${String(error)}`);
    }
  }
  private saveLedSettings(): void {
    const off = this.el<HTMLSelectElement>('button-idle-brightness').value as Brightness;
    const on = this.el<HTMLSelectElement>('button-on-brightness').value as Brightness;
    const padOn = this.el<HTMLSelectElement>('pad-on-brightness').value as Brightness;
    const next = parseProfile(this.profile);
    const mode = next.modes.find(m => m.id === this.activeModeId)!;
    mode.buttonLight = { off, on };
    mode.padOnBrightness = padOn;
    try {
      this.library.save(next);
      this.profile = next;
      this.runtime.updateFeedback(next); this.renderPressed(); this.queueModeLights(); this.renderSaveState();
    } catch (error) {
      this.renderLedSettings();
      this.options.toast(`燈光設定儲存失敗：${String(error)}`);
    }
  }
  private renderBinding(): void {
    this.bindingDirty = false;
    this.el('draft-state').textContent = '已套用'; this.el('draft-state').classList.remove('unsaved');
    this.el('hit-heading').textContent = isPad(this.selected) ? 'PAD HIT · 敲擊' : this.selected === 'SMART_STRIP' ? 'STRIP POSITION · 位置' : 'MIDI OUTPUT';
    const press = isPad(this.selected) ? this.currentMode().pressureBindings?.[this.selected] : undefined;
    const touch = this.selected === 'SMART_STRIP' ? this.currentMode().bindings.SMART_STRIP_TOUCH : undefined;
    this.el('binding-summary').textContent = this.controlSummary(this.selected);
    const continuous = this.selected === 'ENCODER_ROTATE' || this.selected === 'SMART_STRIP';
    const actions = this.selected === 'SMART_STRIP'
      ? [['none', '停用'], ['cc', 'MIDI CC'], ['poly-pressure', 'Poly Pressure'], ['channel-pressure', 'Channel Pressure'], ['program', 'Program Change'], ['pitchbend', 'Pitchbend']]
      : continuous ? [['none', '停用'], ['cc', 'MIDI CC']] : isPad(this.selected)
        ? [['none', '停用'], ['note', 'MIDI Note'], ['cc', 'MIDI CC'], ['poly-pressure', 'Poly Pressure'], ['channel-pressure', 'Channel Pressure'], ['program', 'Program Change'], ['pitchbend', 'Pitchbend'], ['mode', '切換模式']]
        : [['none', '停用'], ['note', 'MIDI Note'], ['cc', 'MIDI CC'], ['poly-pressure', 'Poly Pressure'], ['channel-pressure', 'Channel Pressure'], ['program', 'Program Change'], ['pitchbend', 'Pitchbend'], ['mode', '切換模式']];
    this.el<HTMLSelectElement>('action').innerHTML = actions.map(([id, label]) => `<option value="${id}">${label}</option>`).join('');
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
    let fields = '<div class="editor-section-label">STRIP TOUCH · 觸碰／放開</div>';
    fields += `<label>Touch 動作<select id="bind-touch-type">${[['none','停用'],['note','Note'],['cc','Control Change'],['poly-pressure','Poly Pressure'],['channel-pressure','Channel Pressure'],['program','Program Change'],['pitchbend','Pitchbend'],['start','Start'],['stop','Stop'],['continue','Continue'],['song-position','Song Position']].map(([id,label]) => `<option value="${id}">${label}</option>`).join('')}</select></label>`;
    if (!['none', 'start', 'stop', 'continue', 'song-position'].includes(action)) fields += field('touch-channel', 'MIDI Channel', b && 'channel' in b ? b.channel : 1, 1, 16);
    if (action === 'note') fields += field('touch-note', 'Note Number', b?.type === 'note' ? b.note : 36) + '';
    else if (action === 'cc') {
      fields += field('touch-controller', 'CC Number', b?.type === 'cc' ? b.controller : 1);
      fields += ccFields('touch-', b);
    } else if (action === 'poly-pressure' || action === 'channel-pressure' || action === 'pitchbend') {
      const v = b?.type === 'value' && b.output === action ? b : undefined;
      const max = action === 'pitchbend' ? 16383 : 127;
      if (action === 'poly-pressure') fields += field('touch-note', 'Note Number', v?.note ?? 36);
      fields += field('touch-on', '碰上值', v?.on ?? max, 0, max) + field('touch-off', '放開值', v?.off ?? (action === 'pitchbend' ? 8192 : 0), 0, max);
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
    if (binding.type === 'off') return '停用';
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
    let fields = `<div class="editor-section-label">PAD PRESS · 持續施壓</div><label>壓力動作<select id="bind-press-type"><option value="off">停用</option><option value="note">MIDI Note（壓力門檻）</option><option value="cc">MIDI CC</option><option value="poly-pressure">Poly Pressure</option><option value="channel-pressure">Channel Pressure</option><option value="pitchbend">Pitchbend</option></select></label>`;
    if (action !== 'off') {
      fields += field('press-channel', '壓力 MIDI Channel', b && 'channel' in b ? b.channel : 1, 1, 16);
      if (action === 'note') {
        const n = b?.type === 'note' ? b : undefined;
        const hit = this.currentMode().bindings[this.selected];
        fields += field('press-note', '壓力 Note', n?.note ?? (hit?.type === 'note' ? hit.note : 36));
        fields += field('press-velocity', '觸發力度', n?.velocity ?? 100, 1, 127);
        fields += field('press-off-threshold', '放開門檻 %', n?.offThreshold ?? 10, 0, 99);
        fields += field('press-on-threshold', '觸發門檻 %', n?.onThreshold ?? 20, 1, 100);
      } else {
        if (action === 'cc') fields += field('press-controller', '壓力 CC Number', b?.type === 'cc' ? b.controller : 1);
        if (action === 'poly-pressure') {
          const hit = this.currentMode().bindings[this.selected];
          fields += field('press-note', '壓力 Note', b?.type === 'poly-pressure' ? b.note : hit?.type === 'note' ? hit.note : 36);
        }
        const bend = action === 'pitchbend';
        fields += field('press-from', bend ? '最小彎音 %' : '輸出最小值', b && 'from' in b ? b.from : 0, bend ? -100 : 0, bend ? 100 : 127);
        fields += field('press-to', bend ? '最大彎音 %' : '輸出最大值', b && 'to' in b ? b.to : bend ? 100 : 127, bend ? -100 : 0, bend ? 100 : 127);
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
    if (action !== 'none' && action !== 'mode') fields += field('channel', 'MIDI Channel', b && 'channel' in b ? b.channel : 1, 1, 16);
    if (action === 'note') {
      const note = b?.type === 'note' ? b : undefined;
      fields += field('note', 'Note Number', note?.note ?? 36);
      const pad = isPad(this.selected);
      fields += '<label>Mode<select id="bind-note-mode"><option value="gate">Gate</option><option value="toggle">Toggle</option></select></label>';
      if (pad) {
        const fixed = typeof note?.velocity === 'number' ? note.velocity : undefined;
        fields += field('velocity-min', '輸出最小值', fixed ?? note?.velocityMin ?? 0)
          + field('velocity-max', '輸出最大值', fixed ?? note?.velocityMax ?? 127);
      }
      if (!pad) fields += '<label>Action on<select id="bind-note-action-on"><option value="down">按下</option><option value="up">放開</option></select></label>';
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
          fields += field('step', '每格 CC 增量', enc?.step ?? 1, 1) + field('initial', '起始 CC 值', enc?.initial ?? 64) + field('modulus', '計數回繞範圍（0＝不回繞）', enc?.modulus ?? 0, 0, 256);
        } else if (this.selected === 'SMART_STRIP') {
          const strip = cc?.style === 'strip' ? cc : undefined;
          fields += field('raw-min', '原始有效最小值', strip?.rawMin ?? 1, 1, 254) + field('raw-max', '原始有效最大值', strip?.rawMax ?? 200, 2, 255);
          fields += '<label>Mode<select id="bind-strip-mode"><option value="absolute">Absolute</option><option value="relative">Relative</option><option value="relative-offset">Relative (Offset)</option></select></label>';
          fields += `<label data-strip-cc-fields="absolute">Range From<input id="bind-strip-from" type="number" min="0" max="127" value="${strip?.from ?? 0}" required></label>`;
          fields += `<label data-strip-cc-fields="absolute">Range To<input id="bind-strip-to" type="number" min="0" max="127" value="${strip?.to ?? 127}" required></label>`;
          fields += `<label data-strip-cc-fields="relative relative-offset">Step<input id="bind-strip-step" type="number" min="-127" max="127" value="${strip?.step ?? 1}" required></label>`;
          fields += `<label data-strip-cc-fields="relative relative-offset">Resolution（全長步數；越大越靈敏）<input id="bind-strip-resolution" type="number" min="1" max="200" value="${strip?.resolution ?? 25}" required></label>`;
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
      } else if (action === 'mode') fields += `<label>目標模式<select id="bind-mode">${this.profile.modes.map(m => `<option value="${html(m.id)}">${html(m.name)}</option>`).join('')}</select></label>`;
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
      ? `<div class="editor-section-label">PAD LIGHT</div><label>Color Mode<select id="bind-color-mode"><option value="single">Single · 同色明暗</option><option value="dual">Dual · 兩種顏色</option></select></label><label>待機色（Color Off）<select id="bind-color">${PAD_COLORS.map((name, i) => `<option value="${i}">${name}</option>`).join('')}</select></label><label data-pad-dual>按下色（Color On）<select id="bind-on-color">${PAD_COLORS.map((name, i) => `<option value="${i}">${name}</option>`).join('')}</select></label><label>待機亮度<select id="bind-brightness">${brightnessOptions(light.brightness)}</select></label>`
      : stripLight
          ? `<div class="editor-section-label">STRIP LIGHT</div><label>LED Mode<select id="bind-strip-led-mode"><option value="dot">Dot · 單點</option><option value="bar">Bar · 左側累積</option><option value="pan">Pan · 中央向兩側</option></select></label><label>Color Value<select id="bind-strip-led-color">${PAD_COLORS.slice(1).map((name, i) => `<option value="${i + 1}">${name}</option>`).join('')}</select></label><label>亮度<select id="bind-strip-led-brightness">${brightnessOptions(stripLight.brightness)}</select></label>` : '';
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
    this.el('binding-help').textContent = this.selected === 'ENCODER_ROTATE'
      ? '輸入保留原始計數差。Rust 未定義回繞範圍；預設不回繞，可依實機觀察設定。首份報告只建立基線。'
      : this.selected === 'SMART_STRIP' ? '實機確認：0 是放開、1 是最左、200 是最右。Position 與 Touch 分別設定；Touch 在碰上與放開時觸發。'
      : isPad(this.selected) ? 'Hit Note 先套用力度曲線，再換算至輸出最小值／最大值；兩者相同可固定力度。有效敲擊至少輸出 1。Press 獨立設定。待機色立即在圖上預覽，按「套用至目前模式」後才儲存。'
      : '按「套用至目前模式」會更新這個模式的控制項，並自動儲存整份設定檔。Note Number 使用 0–127 數字；Note 輸出力度固定為 127。';
  }
  private applyBinding(): void {
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
      if (pad && num('velocity-min') > num('velocity-max')) throw new Error('輸出最小值不可大於輸出最大值。');
      b = { type: 'note', channel: num('channel'), note: num('note'), velocity: pad ? 'pad' : 127,
        ...(pad ? { velocityMin: num('velocity-min'), velocityMax: num('velocity-max') } : {}),
        mode: noteMode, ...(noteMode === 'toggle' && !isPad(this.selected) ? { actionOn: val('note-action-on') as 'down' | 'up' } : {}) };
    }
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
      mode.pads[Number(this.selected.slice(4)) - 1] = { color: num('color'), brightness: val('brightness') as PadLight['brightness'],
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
    if (saved) this.options.toast('已套用至目前模式，設定檔已儲存。');
  }
  private saveModeEdit(): void {
    const name = this.el<HTMLInputElement>('mode-name').value.trim();
    if (!name) return this.options.toast('請填寫模式名稱。');
    if (this.bindingDirty && !this.applyPending()) return;
    this.currentMode().name = name; this.editingMode = false;
    const saved = this.commit(); this.renderBinding();
    if (!saved) this.editingMode = true;
    this.renderEditStates();
  }
  private commit(): boolean {
    this.runtime.applyProfile(this.profile); this.renderPressed();
    let saved = false;
    try {
      this.library.save(this.profile);
      saved = true;
      this.profileDirty = this.editingProfile && this.el<HTMLInputElement>('profile-name').value.trim() !== this.profile.name
        || this.editingMode && this.el<HTMLInputElement>('mode-name').value.trim() !== this.currentMode().name;
    } catch (error) {
      this.profileDirty = true;
      this.options.toast(`儲存失敗：${String(error)}`);
    }
    this.renderLibrary(); this.renderModes(); this.renderMap(); this.queueModeLights(); this.renderSaveState();
    return saved;
  }
  private applyPending(): boolean {
    if (this.bindingDirty) {
      if (!this.el<HTMLFormElement>('binding-form').reportValidity()) return false;
      try { this.applyBinding(); } catch (error) { this.options.toast(String(error)); return false; }
    }
    const name = this.el<HTMLInputElement>('profile-name').value.trim();
    if (!name) { this.options.toast('請填寫設定檔名稱。'); this.el('profile-name').focus(); return false; }
    this.profile.name = name; return true;
  }
  private save(): void {
    if (!this.applyPending()) return;
    try {
      this.library.save(this.profile); this.profileDirty = false; this.editingProfile = false;
      this.renderLibrary(); this.renderEditStates(); this.renderSaveState();
      this.options.toast('設定檔已儲存。');
    } catch (error) { this.options.toast(`儲存失敗：${String(error)}`); }
  }
  private controlSummary(id: ControlId): string {
    const mode = this.currentMode();
    const hit = this.bindingLabel(mode.bindings[id]);
    if (isPad(id)) {
      const press = mode.pressureBindings?.[id];
      return `Hit：${hit}\nPress：${press && press.type !== 'off' ? this.pressureLabel(press) : '停用'}`;
    }
    const touch = id === 'SMART_STRIP' ? mode.bindings.SMART_STRIP_TOUCH : undefined;
    return `${hit}${touch && touch.type !== 'none' ? ` · Touch ${this.bindingLabel(touch)}` : ''}`;
  }
  private bindingLabel(binding?: Binding): string {
    if (!binding || binding.type === 'none') return '未映射';
    if (binding.type === 'mode') return `模式 → ${this.profile.modes.find(m => m.id === binding.modeId)?.name ?? binding.modeId}`;
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
    if (!isPad(this.selected)) return null;
    const colorInput = document.getElementById('bind-color') as HTMLSelectElement | null;
    const brightnessInput = document.getElementById('bind-brightness') as HTMLSelectElement | null;
    if (!colorInput || !brightnessInput) return null;
    const color = Number(colorInput.value);
    const dual = (document.getElementById('bind-color-mode') as HTMLSelectElement | null)?.value === 'dual';
    const onColor = dual ? Number((document.getElementById('bind-on-color') as HTMLSelectElement | null)?.value) : undefined;
    const brightness = brightnessInput.value as PadLight['brightness'];
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
    const preview = draft.color !== saved.color || draft.onColor !== (saved.onColor ?? saved.color) || draft.brightness !== saved.brightness;
    const button = this.el('hardware').querySelector<HTMLButtonElement>(`[data-control="${this.selected}"]`);
    if (!button) return;
    this.paintPad(button, draft, preview);
    button.title = `${controlName(this.selected)} · ${this.controlSummary(this.selected)}${preview ? ' · 燈色預覽，尚未套用' : ''}`;
    button.setAttribute('aria-label', `選取 ${button.title}`);
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
      button.classList.toggle('is-mapped', mapped); button.classList.toggle('selected', id === this.selected);
      button.setAttribute('aria-pressed', String(id === this.selected));
      button.title = `${controlName(id)} · ${this.controlSummary(id)}`;
      button.setAttribute('aria-label', `選取 ${button.title}`);
      if (PAD_IDS.includes(id as `PAD_${number}`)) {
        const light = this.currentMode().pads[Number(id.slice(4)) - 1];
        this.paintPad(button, light);
        button.querySelector('.pad-assignment')!.textContent = binding?.type === 'note' ? `CH ${binding.channel} / ${binding.note}` : this.bindingLabel(binding);
      }
    });
    this.el('mapped-count').textContent = `${count} 個控制項已映射`;
  }
  private renderPorts(): void {
    const select = this.el<HTMLSelectElement>('output');
    if (!select) return;
    const midi = this.runtime.snapshot.midi;
    select.innerHTML = '<option value="">停用 MIDI 輸出</option>' + midi.ports.map(p => `<option value="${html(p.id)}">${html(p.name)}</option>`).join('');
    select.disabled = !midi.enabled; select.value = midi.output?.id ?? '';
    this.el('status').textContent = midi.output ? `輸出：${midi.output.name}` : '未選擇 MIDI 輸出';
  }
  private handleEvent(event: InputEvent): void {
    if (event.kind === 'button' && event.pressed)
      this.selectHardwareControl(event.controlId === 'SMART_STRIP_TOUCH' ? 'SMART_STRIP' : event.controlId);
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
      this.paintPad(button, pressed ? { color: light.onColor ?? light.color, brightness: this.currentMode().padOnBrightness ?? 'bright' } : light);
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
    this.el('led-summary').textContent = state.ledEnabled ? '已接管' : '尚未接管';
    this.el('led-status').textContent = state.ledStatus || (!connected
      ? '連線時不會自動發送 LED 或螢幕封包。'
      : !supported ? '此 HID 介面未宣告 0x80 輸出，無法接管 LED。'
      : !state.ledEnabled ? '裝置已就緒。啟用接管後才能控制 Pad、按鍵與 Strip 燈光。' : '');
  }
}
