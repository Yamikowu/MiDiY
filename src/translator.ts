import {
  InputDecoder, MappingEngine, createDefaultProfile, parseProfile, PAD_IDS, PAD_COLORS,
  encodePadLights, type Binding, type ControlId, type Profile, type InputEvent, type MidiMessage,
  type PadLight, type OutputReport
} from '@mpa/mikro-core';
import { WebHidAdapter, outputReports } from './adapters/web-hid';
import { WebMidiAdapter } from './adapters/web-midi';
import { renderHardware } from './hardware-view.js';
import { getControl } from './controls.js';
import { ProfileLibrary } from './profile-library';
import { confirmAction } from './dialogs';

const PAD_PREVIEW = ['#666666', '#ef6262', '#ef914b', '#efac70', '#eab760', '#e4cd5c', '#a9d866', '#60be82', '#6bd0ad', '#71cdd9', '#52b1c8', '#749ee9', '#9d87c9', '#a087e4', '#b377d4', '#cf77bc', '#e979ae', '#e7e7df'];
const isPad = (id: ControlId) => PAD_IDS.includes(id as `PAD_${number}`);
const controlName = (id: ControlId) => getControl(id)?.label ?? 'Encoder 觸碰';
const html = (text: unknown) => String(text).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const field = (id: string, label: string, value: number, min = 0, max = 127) => `<label>${label}<input id="bind-${id}" type="number" min="${min}" max="${max}" value="${value}" required></label>`;
export interface TranslatorOptions {
  receive: (event: HIDInputReportEvent) => void;
  disconnected: () => void;
  toast: (message: string) => void;
}
export class TranslatorUI {
  readonly hid: WebHidAdapter;
  readonly midi: WebMidiAdapter;
  private decoder = new InputDecoder();
  private profile: Profile = createDefaultProfile();
  private library: ProfileLibrary;
  private profileDirty = false;
  private bindingDirty = false;
  private editingProfile = false;
  private editingMode = false;
  private engine: MappingEngine;
  private selected: ControlId = 'PAD_1';
  private activePads = new Set<string>();
  private ledEnabled = false;
  private pendingLed: OutputReport | null = null;
  private writingLed = false;
  private ledGeneration = 0;
  private eventRows: string[] = [];
  private frame = 0;
  private midiCount = 0;
  constructor(private readonly options: TranslatorOptions) {
    this.library = new ProfileLibrary({ getItem: key => localStorage.getItem(key), setItem: (key, value) => localStorage.setItem(key, value) });
    this.profile = this.library.current;
    this.engine = new MappingEngine(this.profile);
    this.midi = new WebMidiAdapter(() => this.renderPorts(), () => {
      // If an endpoint vanished, discard held notes; it may be impossible to deliver their offs.
      const messages = this.engine.flush();
      this.options.toast('MIDI 輸出埠已離線；已清除演奏狀態，接收端若仍有聲音請使用其 Panic。');
      return messages;
    });
    this.hid = new WebHidAdapter(event => {
      const bytes = new Uint8Array(event.data.buffer, event.data.byteOffset, event.data.byteLength);
      const decoded = this.decoder.decode(event.reportId, bytes);
      for (const event of decoded.events) this.handleEvent(event);
      decoded.diagnostics.forEach(d => this.addEvent(`⚠ ${d}`));
      this.options.receive(event);
    }, () => {
      this.release(); this.ledEnabled = false; this.pendingLed = null; this.ledGeneration++;
      this.renderDevice(); this.options.disconnected();
    });
    this.mount();
    if (this.library.warning) this.options.toast(this.library.warning);
    window.addEventListener('pagehide', () => { this.release(); });
  }
  private el<T extends HTMLElement = HTMLElement>(id: string): T { return document.getElementById(`midi-${id}`) as T; }
  private mount(): void {
    this.el('panel').innerHTML = `
      <section class="config-panel" aria-label="設定檔與模式">
        <div class="config-row">
          <label class="config-picker">設定檔<select id="midi-library" aria-label="選擇設定檔"></select><input id="midi-profile-name" maxlength="80" aria-label="編輯設定檔名稱" hidden></label>
          <div class="config-actions"><button id="midi-profile-edit" class="outline">編輯</button><button id="midi-profile-duplicate" class="outline">複製</button><button id="midi-save" class="primary" hidden>儲存</button><button id="midi-profile-delete" class="text-button danger" hidden>刪除</button></div>
          <div class="profile-file-actions"><button id="midi-export" class="text-button">匯出</button><label class="text-button file-button" tabindex="0" role="button">匯入<input id="midi-import" type="file" accept=".json,application/json" hidden></label></div>
          <p id="midi-save-status" class="save-status" role="status"></p>
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
          <p class="map-hint">點選參照圖上的控制項編輯。Pad 下方顯示 Channel／Note；選擇燈色即在圖上預覽，套用後才儲存。</p>
          <details class="device-options"><summary>裝置燈光 <span id="midi-led-summary">尚未接管</span></summary>
            <label class="switch"><input id="midi-led-enable" type="checkbox" disabled>接管 LED 輸出</label>
            <p class="caption">啟用後套用本模式 Pad 燈光，按鍵與 Strip 燈會關閉。連線時不會自動改燈，無法還原其他軟體的燈光。</p>
            <div class="inline-actions led-actions"><button id="midi-led-test" class="outline" disabled>測試選取 Pad</button><button id="midi-led-restore" class="outline" disabled>套用模式燈光</button><button id="midi-led-off" class="text-button" disabled>全部關閉</button></div>
            <p id="midi-led-status" class="caption" role="status"></p>
          </details>
        </section>
        <aside class="panel mapping-editor" aria-label="控制項編輯">
          <div class="editor-heading"><p class="eyebrow">CONTROL INSPECTOR</p><span id="midi-draft-state" class="draft-state" role="status">已套用</span></div>
          <h2 id="midi-selected">Pad 1</h2><p id="midi-binding-summary" class="binding-summary"></p>
          <form id="midi-binding-form">
            <div class="editor-section-label">MIDI OUTPUT</div><label>輸出動作<select id="midi-action"></select></label>
            <div id="midi-fields" class="binding-fields"></div><div id="midi-pad-light" class="binding-fields"></div>
            <button id="midi-apply" class="primary wide" type="submit">套用至目前模式</button>
          </form>
          <p id="midi-binding-help" class="caption"></p>
        </aside>
      </div>
      <div class="mapping-status"><span id="midi-status" role="status">未選擇 MIDI 輸出</span><span>設定檔保存在此瀏覽器 · 可匯出 JSON</span></div>`;
    renderHardware(this.el('hardware'), (id: string) => this.selectControl(id as ControlId), { includeEncoderTouch: true });
    document.getElementById('testing-decoded')!.innerHTML = `<div class="section-heading"><div><p class="eyebrow">DECODED INPUT</p><h2>即時解碼</h2></div><span id="midi-count" class="section-note">0 MIDI 訊息</span></div><label class="switch"><input id="midi-pressure-events" type="checkbox">顯示 Pad 壓力事件</label><pre id="midi-events" aria-live="off">等待控制器輸入…</pre>`;
    this.el('binding-form').addEventListener('input', () => this.markBindingDirty());
    this.el('binding-form').addEventListener('change', () => this.markBindingDirty());
    this.el('pad-light').addEventListener('input', () => this.previewPadLight());
    this.el('pad-light').addEventListener('change', () => this.previewPadLight());
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
    this.el('enable').addEventListener('click', () => this.guard(() => this.midi.enable()));
    this.el('output').addEventListener('change', () => this.guard(async () => {
      const id = this.el<HTMLSelectElement>('output').value;
      await this.midi.select(id, this.engine.flush()); this.renderPorts();
    }));
    this.el('mode').addEventListener('change', async () => {
      if (!await this.discardBindingDraft()) { this.renderModes(); return; }
      this.dispatch(this.engine.switchMode(this.el<HTMLSelectElement>('mode').value).messages);
      this.activePads.clear(); this.renderModes(); this.renderBinding(); this.renderMap(); this.renderPressed(); this.queueModeLights();
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
      this.renderFields(undefined, lightDraft ?? undefined); this.markBindingDirty(); this.previewPadLight();
    });
    this.el('binding-form').addEventListener('submit', event => { event.preventDefault(); this.guard(() => this.applyBinding()); });
    this.el('panic').addEventListener('click', () => {
      this.release(); this.options.toast('已釋放目前音符及按住的 CC。');
    });
    this.el('add-mode').addEventListener('click', async () => {
      if (this.editingProfile) return this.options.toast('請先儲存設定檔名稱。');
      if (!await this.discardBindingDraft()) return;
      if (this.profile.modes.length >= 64) return this.options.toast('最多 64 個模式。');
      const copy = JSON.parse(JSON.stringify(this.currentMode()));
      copy.id = crypto.randomUUID(); copy.name = `${copy.name} copy`;
      this.profile.modes.push(copy); this.commit(); this.dispatch(this.engine.switchMode(copy.id).messages);
      this.activePads.clear(); this.renderModes(); this.renderBinding(); this.renderMap(); this.renderPressed(); this.queueModeLights();
      this.editingMode = true; this.renderEditStates(); this.el<HTMLInputElement>('mode-name').focus();
      this.el<HTMLInputElement>('mode-name').select();
    });
    this.el('delete-mode').addEventListener('click', async () => {
      if (!await this.discardBindingDraft()) return;
      if (this.profile.modes.length === 1) return this.options.toast('至少保留一個模式。');
      if (!await confirmAction(`刪除模式「${this.currentMode().name}」？指向它的切換動作會停用。`, '刪除模式')) return;
      const removed = this.engine.activeModeId;
      this.profile.modes = this.profile.modes.filter(m => m.id !== removed);
      for (const mode of this.profile.modes) for (const [id, binding] of Object.entries(mode.bindings)) {
        if (binding?.type === 'mode' && binding.modeId === removed) delete mode.bindings[id as ControlId];
      }
      if (this.profile.initialModeId === removed) this.profile.initialModeId = this.profile.modes[0].id;
      this.editingMode = false; this.commit(); this.renderBinding(); this.renderEditStates();
    });
    this.el('initial').addEventListener('change', () => {
      if (this.el<HTMLInputElement>('initial').checked) { this.profile.initialModeId = this.engine.activeModeId; this.commit(); }
      else this.renderModes();
    });
    this.el('save').addEventListener('click', () => this.save());
    this.el('export').addEventListener('click', () => {
      if (this.editingMode) return this.options.toast('請先儲存模式名稱。');
      if (!this.applyPending()) return;
      const a = document.createElement('a'), url = URL.createObjectURL(new Blob([JSON.stringify(this.profile, null, 2)], { type: 'application/json' }));
      a.href = url; a.download = 'mpa-profile.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
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
      this.ledEnabled = this.el<HTMLInputElement>('led-enable').checked;
      this.ledGeneration++; this.pendingLed = null;
      if (this.ledEnabled) this.queueModeLights(); else this.queueLights(PAD_IDS.map(() => ({ color: 0, brightness: 'off' })));
      this.renderDevice();
    });
    this.el('led-test').addEventListener('click', () => {
      if (!isPad(this.selected)) return this.options.toast('請先選取一顆 Pad。');
      const index = Number(this.selected.slice(4)) - 1;
      const lights: PadLight[] = PAD_IDS.map(() => ({ color: 0, brightness: 'off' }));
      lights[index] = { color: this.currentMode().pads[index].color, brightness: this.currentMode().pads[index].brightness };
      this.queueLights(lights);
    });
    this.el('led-restore').addEventListener('click', () => this.queueModeLights());
    this.el('led-off').addEventListener('click', () => {
      this.ledEnabled = false; this.ledGeneration++; this.pendingLed = null;
      this.queueLights(PAD_IDS.map(() => ({ color: 0, brightness: 'off' }))); this.renderDevice();
    });
    this.renderLibrary(); this.renderModes(); this.renderEditStates(); this.selectControl(this.selected); this.renderPorts(); this.renderDevice(); this.renderSaveState();
  }
  private async guard(action: () => void | Promise<void>): Promise<void> {
    try { await action(); } catch (error) { this.options.toast(error instanceof Error ? error.message : String(error)); }
  }
  private currentMode() { return this.profile.modes.find(m => m.id === this.engine.activeModeId)!; }
  async selectControl(id: ControlId): Promise<void> {
    if (id !== this.selected && !await this.discardBindingDraft()) return;
    this.selected = id;
    this.el('selected').textContent = controlName(id); this.renderBinding(); this.renderMap();
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
    this.release(); this.profile = profile; this.engine = new MappingEngine(profile);
    this.profileDirty = dirty; this.bindingDirty = false; this.editingProfile = false; this.editingMode = false;
    this.el<HTMLInputElement>('profile-name').value = this.profile.name;
    this.renderLibrary(); this.renderModes(); this.renderEditStates(); this.renderBinding(); this.renderMap(); this.renderSaveState(); this.queueModeLights();
  }
  private renderModes(): void {
    this.el<HTMLSelectElement>('mode').innerHTML = this.profile.modes.map(m => `<option value="${html(m.id)}">${html(m.name)}</option>`).join('');
    this.el<HTMLSelectElement>('mode').value = this.engine.activeModeId;
    if (!this.editingProfile) this.el<HTMLInputElement>('profile-name').value = this.profile.name;
    if (!this.editingMode) this.el<HTMLInputElement>('mode-name').value = this.currentMode().name;
    this.el<HTMLInputElement>('initial').checked = this.profile.initialModeId === this.engine.activeModeId;
  }
  private renderBinding(): void {
    this.bindingDirty = false;
    this.el('draft-state').textContent = '已套用'; this.el('draft-state').classList.remove('unsaved');
    this.el('binding-summary').textContent = this.bindingLabel(this.currentMode().bindings[this.selected]);
    const continuous = this.selected === 'ENCODER_ROTATE' || this.selected === 'SMART_STRIP';
    const actions = continuous ? [['none', '停用'], ['cc', 'MIDI CC']] : [['none', '停用'], ['note', 'MIDI Note'], ['cc', 'MIDI CC'], ['program', 'Program Change'], ['mode', '切換模式']];
    this.el<HTMLSelectElement>('action').innerHTML = actions.map(([id, label]) => `<option value="${id}">${label}</option>`).join('');
    const b = this.currentMode().bindings[this.selected];
    this.el<HTMLSelectElement>('action').value = b?.type ?? 'none';
    this.renderFields(b); this.renderSaveState();
  }
  private renderFields(existing?: Binding, lightDraft?: PadLight): void {
    const action = this.el<HTMLSelectElement>('action').value;
    const b = existing?.type === action ? existing : undefined;
    let fields = '';
    if (action !== 'none' && action !== 'mode') fields += field('channel', 'MIDI Channel', b && 'channel' in b ? b.channel : 1, 1, 16);
    if (action === 'note') {
      const note = b?.type === 'note' ? b : undefined;
      fields += field('note', 'Note Number', note?.note ?? 36);
      const pad = isPad(this.selected);
      fields += `<label>力度來源<select id="bind-velocity-source">${pad ? '<option value="pad">Pad 原始力度換算</option>' : ''}<option value="fixed">固定力度</option></select></label>`;
      fields += field('velocity', '固定力度', typeof note?.velocity === 'number' ? note.velocity : 100, 1, 127);
      this.el('fields').innerHTML = fields;
      (document.getElementById('bind-velocity-source') as HTMLSelectElement).value = note?.velocity === 'pad' || !note && pad ? 'pad' : 'fixed';
      const velocitySource = document.getElementById('bind-velocity-source') as HTMLSelectElement;
      const fixedVelocity = document.getElementById('bind-velocity') as HTMLInputElement;
      const showVelocity = () => {
        const fixed = velocitySource.value === 'fixed';
        fixedVelocity.disabled = !fixed; fixedVelocity.closest('label')!.hidden = !fixed;
        velocitySource.closest('label')!.style.gridColumn = fixed ? '' : '1 / -1';
      };
      velocitySource.addEventListener('change', showVelocity); showVelocity();
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
        } else {
          fields += `<label>按鍵行為<select id="bind-style"><option value="momentary">按住／放開</option><option value="toggle">每次按下切換</option></select></label>`;
          fields += field('on', '開啟值', cc && 'on' in cc ? cc.on : 127) + field('off', '關閉值', cc && 'off' in cc ? cc.off : 0);
        }
      } else if (action === 'program') fields += field('program', 'Program Number（0–127）', b?.type === 'program' ? b.program : 0);
      else if (action === 'mode') fields += `<label>目標模式<select id="bind-mode">${this.profile.modes.map(m => `<option value="${html(m.id)}">${html(m.name)}</option>`).join('')}</select></label>`;
      this.el('fields').innerHTML = fields;
      if (b?.type === 'mode') (document.getElementById('bind-mode') as HTMLSelectElement).value = b.modeId;
      if (b?.type === 'cc' && (b.style === 'momentary' || b.style === 'toggle')) (document.getElementById('bind-style') as HTMLSelectElement).value = b.style;
    }
    const index = isPad(this.selected) ? Number(this.selected.slice(4)) - 1 : -1;
    const light = lightDraft ?? this.currentMode().pads[index];
    this.el('pad-light').innerHTML = light ? `<div class="editor-section-label">PAD LIGHT</div><label>Pad 色彩<select id="bind-color">${PAD_COLORS.map((name, i) => `<option value="${i}">${name}</option>`).join('')}</select></label><label>待機亮度<select id="bind-brightness">${[['off', '關閉'], ['dim', '低'], ['normal', '中'], ['bright', '高']].map(([v, label]) => `<option value="${v}">${label}</option>`).join('')}</select></label>` : '';
    if (light) {
      (document.getElementById('bind-color') as HTMLSelectElement).value = String(light.color);
      (document.getElementById('bind-brightness') as HTMLSelectElement).value = light.brightness;
    }
    this.el('binding-help').textContent = this.selected === 'ENCODER_ROTATE'
      ? '輸入保留原始計數差。Rust 未定義回繞範圍；預設不回繞，可依實機觀察設定。首份報告只建立基線。'
      : this.selected === 'SMART_STRIP' ? '原值 0 依 Rust 行為不送 CC；有效範圍預設 1–200，請依實機端點調整，不將它判定成觸碰手勢。'
      : isPad(this.selected) ? '燈色與亮度會立即在圖上預覽；按「套用至目前模式」後才儲存。若已接管燈光，也會更新裝置。'
      : '按「套用至目前模式」會更新這個模式的控制項，並自動儲存整份設定檔。Note 使用 0–127 數字。';
  }
  private applyBinding(): void {
    const val = (id: string) => (document.getElementById(`bind-${id}`) as HTMLInputElement).value;
    const num = (id: string) => Number(val(id));
    const action = this.el<HTMLSelectElement>('action').value;
    let b: Binding = { type: 'none' };
    if (action === 'note') b = { type: 'note', channel: num('channel'), note: num('note'), velocity: val('velocity-source') === 'pad' ? 'pad' : num('velocity') };
    else if (action === 'program') b = { type: 'program', channel: num('channel'), program: num('program') };
    else if (action === 'mode') b = { type: 'mode', modeId: val('mode') };
    else if (action === 'cc') {
      const shared = { type: 'cc' as const, channel: num('channel'), controller: num('controller') };
      if (this.selected === 'ENCODER_ROTATE') b = { ...shared, style: 'encoder', step: num('step'), initial: num('initial'), modulus: num('modulus') };
      else if (this.selected === 'SMART_STRIP') b = { ...shared, style: 'strip', rawMin: num('raw-min'), rawMax: num('raw-max') };
      else b = { ...shared, style: val('style') as 'momentary' | 'toggle', on: num('on'), off: num('off') };
    }
    const next = JSON.parse(JSON.stringify(this.profile)) as Profile;
    const mode = next.modes.find(m => m.id === this.engine.activeModeId)!;
    mode.bindings[this.selected] = b;
    if (isPad(this.selected)) mode.pads[Number(this.selected.slice(4)) - 1] = { color: num('color'), brightness: val('brightness') as PadLight['brightness'] };
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
    this.dispatch(this.engine.reconfigure(this.profile)); this.activePads.clear(); this.renderPressed();
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
  private bindingLabel(binding?: Binding): string {
    if (!binding || binding.type === 'none') return '未映射';
    if (binding.type === 'mode') return `模式 → ${this.profile.modes.find(m => m.id === binding.modeId)?.name ?? binding.modeId}`;
    if (binding.type === 'note') return `CH ${binding.channel} · Note ${binding.note}`;
    if (binding.type === 'cc') return `CC ${binding.controller} · CH ${binding.channel}`;
    return `Program ${binding.program} · CH ${binding.channel}`;
  }
  private readPadLightDraft(): PadLight | null {
    if (!isPad(this.selected)) return null;
    const colorInput = document.getElementById('bind-color') as HTMLSelectElement | null;
    const brightnessInput = document.getElementById('bind-brightness') as HTMLSelectElement | null;
    if (!colorInput || !brightnessInput) return null;
    const color = Number(colorInput.value);
    const brightness = brightnessInput.value as PadLight['brightness'];
    if (!Number.isInteger(color) || color < 0 || color >= PAD_COLORS.length || !['off', 'dim', 'normal', 'bright'].includes(brightness)) return null;
    return { color, brightness };
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
    const preview = draft.color !== saved.color || draft.brightness !== saved.brightness;
    const button = this.el('hardware').querySelector<HTMLButtonElement>(`[data-control="${this.selected}"]`);
    if (!button) return;
    this.paintPad(button, draft, preview);
    button.title = `${controlName(this.selected)} · ${this.bindingLabel(this.currentMode().bindings[this.selected])}${preview ? ' · 燈色預覽，尚未套用' : ''}`;
    button.setAttribute('aria-label', `選取 ${button.title}`);
  }
  private renderMap(): void {
    const count = Object.values(this.currentMode().bindings).filter(b => b && b.type !== 'none').length;
    this.el('hardware').querySelectorAll<HTMLButtonElement>('[data-control]').forEach(button => {
      const id = button.dataset.control as ControlId, binding = this.currentMode().bindings[id];
      const mapped = Boolean(binding && binding.type !== 'none');
      button.classList.toggle('is-mapped', mapped); button.classList.toggle('selected', id === this.selected);
      button.setAttribute('aria-pressed', String(id === this.selected));
      button.title = `${controlName(id)} · ${this.bindingLabel(binding)}`;
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
    select.innerHTML = '<option value="">停用 MIDI 輸出</option>' + [...this.midi.access?.outputs.values() ?? []].filter(p => p.state === 'connected').map(p => `<option value="${html(p.id)}">${html(p.name || p.id)}</option>`).join('');
    select.disabled = !this.midi.access; select.value = this.midi.output?.id ?? '';
    this.el('status').textContent = this.midi.output ? `輸出：${this.midi.output.name || this.midi.output.id}` : '未選擇 MIDI 輸出';
  }
  private dispatch(messages: MidiMessage[]): void {
    try { this.midi.send(messages); if (this.midi.output) this.midiCount += messages.length; }
    catch (error) { this.options.toast(`MIDI 發送失敗：${String(error)}`); }
    if (messages.length) this.addEvent(`${this.midi.output ? 'MIDI →' : '預覽 MIDI'} ${messages.map(m => m.map(v => v.toString(16).padStart(2, '0')).join(' ')).join(' | ')}`);
  }
  private handleEvent(event: InputEvent): void {
    if (event.kind === 'pad') {
      const wasActive = this.activePads.has(event.controlId);
      if ((event.event === 'note-on' || event.event === 'press-on') && event.raw > 0) this.activePads.add(event.controlId);
      if (event.event === 'note-off' || event.event === 'press-off') this.activePads.delete(event.controlId);
      if (wasActive !== this.activePads.has(event.controlId)) this.queueModeLights();
    }
    if (event.kind === 'button') {
      document.querySelectorAll<HTMLElement>('[data-control]').forEach(b => { if (b.dataset.control === event.controlId) b.classList.toggle('is-pressed', event.pressed); });
    }
    const result = this.engine.process(event); this.dispatch(result.messages);
    if (result.modeChanged) { this.activePads.clear(); this.renderModes(); this.renderBinding(); this.renderMap(); this.queueModeLights(); }
    this.renderPressed();
    if (event.kind !== 'pad' || event.event !== 'aftertouch' || this.el<HTMLInputElement>('pressure-events').checked) this.addEvent(JSON.stringify(event));
  }
  private addEvent(text: string): void {
    this.eventRows.unshift(text); this.eventRows.length = Math.min(40, this.eventRows.length);
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0; this.el('events').textContent = this.eventRows.join('\n'); this.el('count').textContent = `${this.midiCount} MIDI 訊息`;
    });
  }
  private renderPressed(): void {
    document.querySelectorAll<HTMLElement>('[data-control^="PAD_"]').forEach(b => { if (PAD_IDS.includes(b.dataset.control as `PAD_${number}`)) b.classList.toggle('is-pressed', this.activePads.has(b.dataset.control!)); });
  }
  private queueModeLights(): void {
    if (!this.ledEnabled) return;
    this.queueLights(this.currentMode().pads.map((pad, i) => this.activePads.has(PAD_IDS[i]) && pad.color !== 0 ? { ...pad, brightness: 'bright' } : pad));
  }
  private queueLights(pads: PadLight[]): void {
    if (!this.hid.device?.opened) return;
    this.pendingLed = encodePadLights(pads);
    if (!this.writingLed) void this.pumpLights();
  }
  private async pumpLights(): Promise<void> {
    this.writingLed = true;
    while (this.pendingLed) {
      const report = this.pendingLed, generation = this.ledGeneration; this.pendingLed = null;
      try {
        await this.hid.send(report);
        if (generation === this.ledGeneration) this.el('led-status').textContent = '已送出 0x80 / 80 bytes。請確認實體燈光；此狀態不代表裝置已回報顯示成功。';
      } catch (error) {
        if (generation === this.ledGeneration) {
          this.ledEnabled = false; this.pendingLed = null; this.renderDevice();
          this.el('led-status').textContent = `LED 發送失敗：${String(error)}`;
        }
      }
    }
    this.writingLed = false;
  }
  private renderDevice(): void {
    const connected = Boolean(this.hid.device?.opened);
    const reports = this.hid.device ? outputReports(this.hid.device.collections) : [];
    const supported = reports.some(r => r.reportId === 0x80);
    this.el<HTMLInputElement>('led-enable').disabled = !connected || !supported;
    this.el<HTMLInputElement>('led-enable').checked = this.ledEnabled;
    this.el('led-summary').textContent = this.ledEnabled ? '已接管' : '尚未接管';
    for (const id of ['led-test', 'led-restore', 'led-off']) this.el<HTMLButtonElement>(id).disabled = !connected || !this.ledEnabled;
    if (!connected) this.el('led-status').textContent = '連線時不會自動發送 LED 或螢幕封包。';
    else if (!supported) this.el('led-status').textContent = '此 HID 介面未宣告 0x80 輸出，無法接管 LED。';
    else if (!this.ledEnabled) this.el('led-status').textContent = '裝置已就緒。啟用接管後才能控制 Pad 燈光。';
  }
  async connect(): Promise<HIDDevice | null> {
    this.decoder.reset(); this.release();
    const device = await this.hid.connect(); this.renderDevice(); return device;
  }
  async disconnect(): Promise<void> {
    this.release(); this.ledGeneration++; this.pendingLed = null;
    if (this.ledEnabled) {
      // Full-state all-off is the only known reset; the previous owner's state is unknown.
      await this.hid.send(encodePadLights(PAD_IDS.map(() => ({ color: 0, brightness: 'off' })))).catch(error => this.options.toast(String(error)));
    }
    this.ledEnabled = false; await this.hid.disconnect(); this.renderDevice();
  }
  private release(): void {
    this.dispatch(this.engine.reset()); this.decoder.reset(); this.activePads.clear(); this.renderPressed();
    document.querySelectorAll('[data-control]').forEach(b => b.classList.remove('is-pressed'));
    this.queueModeLights();
  }
}
