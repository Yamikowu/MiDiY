import {
  PAD_IDS,
  type Binding,
  type ControlId,
  type InputEvent,
  type PadLight
} from '@midiy/mikro-core';
import { t } from '../../../i18n/index';
import { TranslatorRuntime } from '../runtime';
import { renderHardware } from '../ui/hardware-view.js';
import { controlsInRect, mappingShortcut, selectControls } from './editor-model';
import { EditorSession } from './editor-session';

import type { Mode } from '@midiy/mikro-core';
import type { TranslatorOptions } from './view-contracts';
import { controlName, isPad } from './view-helpers';
export interface HardwareWorkspaceContext {
  bindingLabel: (binding?: Binding) => string;
  controlSummary: (id: ControlId) => string;
  copySelection: () => void;
  currentMode: () => Mode;
  discardBindingDraft: () => Promise<boolean>;
  el: <T extends HTMLElement = HTMLElement>(id: string) => T;
  guard: (action: () => void | Promise<void>) => Promise<void>;
  markBindingDirty: () => void;
  noteLabel: (note: number) => string;
  options: TranslatorOptions;
  paintPad: (button: HTMLButtonElement, light: PadLight, preview?: boolean) => void;
  pasteSelection: () => Promise<void>;
  previewBatch: () => void;
  previewPadLight: () => void;
  queueModeLights: () => void;
  renderBatch: () => void;
  renderBinding: () => void;
  renderEditActions: () => void;
  renderModes: () => void;
  restoreEdit: (redo: boolean) => Promise<void>;
  runtime: TranslatorRuntime;
  session: EditorSession;
  selectControl: (id: ControlId, extend?: boolean) => Promise<void>;
}

export function mountHardware(ctx: HardwareWorkspaceContext): void {
  renderHardware(ctx.el('hardware'), (id: string, event: MouseEvent) => selectControl(ctx, id as ControlId, event.shiftKey), { includeEncoderTouch: true });
  mountSelection(ctx);
  ctx.el<HTMLInputElement>('follow-hardware-selection').addEventListener('change', () => {
    ctx.session.followHardwareSelection = ctx.el<HTMLInputElement>('follow-hardware-selection').checked;
  });
  const showInspector = (scope: 'mode' | 'control') => {
    ctx.session.inspector = scope;
    const owner = scope === 'mode' && ctx.session.selection.size === 1 ? ctx.session.profile.modes.find(mode => (mode.selectorButton ?? mode.selectorPad) === ctx.session.selected) : undefined;
    if (owner && owner.id !== ctx.session.editorModeId && !ctx.session.bindingDirty && !ctx.session.editingMode) {
      ctx.session.editorModeId = owner.id; ctx.renderModes(); ctx.renderBinding();
    }
    for (const name of ['mode', 'control']) {
      const active = name === scope;
      ctx.el(`${name}-tab`).setAttribute('aria-selected', String(active));
      ctx.el(`${name}-tab`).tabIndex = active ? 0 : -1;
      ctx.el(`${name}-inspector`).hidden = !active;
    }
    renderMap(ctx); renderPressed(ctx); ctx.queueModeLights();
    if (scope === 'control' && ctx.session.bindingDirty) { ctx.previewPadLight(); ctx.previewBatch(); }
    ctx.el('note-preferences').hidden = scope === 'mode' || ctx.el('binding-form').hidden || !ctx.el('binding-form').querySelector('[data-note-input]');
  };
  for (const scope of ['mode', 'control'] as const) {
    ctx.el(`${scope}-tab`).addEventListener('click', () => showInspector(scope));
    ctx.el(`${scope}-tab`).addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const next = event.key === 'Home' ? 'mode' : event.key === 'End' ? 'control' : scope === 'mode' ? 'control' : 'mode';
      showInspector(next); ctx.el(`${next}-tab`).focus();
    });
  }
}

export function mountSelection(ctx: HardwareWorkspaceContext): void {
  const hardware = ctx.el('hardware');
  hardware.tabIndex = 0;
  let drag: { pointer: number; start: { x: number; y: number }; shift: boolean; base: ControlId[]; moved: boolean } | null = null;
  let box: HTMLDivElement | null = null, suppressClick = false;
  hardware.addEventListener('click', event => {
    if (suppressClick) { event.preventDefault(); event.stopImmediatePropagation(); suppressClick = false; }
  }, true);
  hardware.addEventListener('pointerdown', event => {
    if (event.button !== 0 || event.pointerType === 'touch') return;
    suppressClick = false;
    drag = { pointer: event.pointerId, start: { x: event.clientX, y: event.clientY }, shift: event.shiftKey, base: [...ctx.session.selection], moved: false };
  });
  hardware.addEventListener('pointermove', event => {
    if (!drag || event.pointerId !== drag.pointer) return;
    if (!drag.moved && Math.hypot(event.clientX - drag.start.x, event.clientY - drag.start.y) < 5) return;
    drag.moved = true; event.preventDefault(); hardware.setPointerCapture(event.pointerId);
    const bounds = hardware.getBoundingClientRect();
    if (!box) { box = document.createElement('div'); box.className = 'mapping-marquee'; hardware.append(box); }
    Object.assign(box.style, {
      left: `${Math.min(drag.start.x, event.clientX) - bounds.left}px`, top: `${Math.min(drag.start.y, event.clientY) - bounds.top}px`,
      width: `${Math.abs(event.clientX - drag.start.x)}px`, height: `${Math.abs(event.clientY - drag.start.y)}px`
    });
  });
  hardware.addEventListener('pointerup', event => {
    if (!drag || event.pointerId !== drag.pointer) return;
    const current = drag; drag = null; box?.remove(); box = null;
    if (hardware.hasPointerCapture(event.pointerId)) hardware.releasePointerCapture(event.pointerId);
    if (!current.moved) return;
    suppressClick = true; event.preventDefault();
    const rects = [...hardware.querySelectorAll<HTMLElement>('[data-control]')].map(button => ({ id: button.dataset.control as ControlId, ...button.getBoundingClientRect().toJSON() }));
    const hits = controlsInRect(rects, current.start, { x: event.clientX, y: event.clientY });
    void ctx.guard(() => selectGroup(ctx, selectControls(current.base, hits, current.shift)));
  });
  const cancel = () => { drag = null; box?.remove(); box = null; };
  hardware.addEventListener('pointercancel', cancel);
  hardware.addEventListener('lostpointercapture', cancel);
  ctx.el('undo').addEventListener('click', () => ctx.guard(() => ctx.restoreEdit(false)));
  ctx.el('redo').addEventListener('click', () => ctx.guard(() => ctx.restoreEdit(true)));
  ctx.el('copy-controls').addEventListener('click', () => ctx.copySelection());
  ctx.el('paste-controls').addEventListener('click', () => ctx.guard(() => ctx.pasteSelection()));
  document.addEventListener('keydown', event => {
    if (document.getElementById('page-mapping')?.hidden !== false || document.querySelector('dialog[open]') || event.isComposing) return;
    const target = event.target as HTMLElement;
    const action = mappingShortcut(event, Boolean(target.closest('input, select, textarea, [contenteditable]:not([contenteditable="false"])')));
    if (!action) return;
    event.preventDefault();
    if (action === 'copy') ctx.copySelection();
    else if (action === 'paste') void ctx.guard(() => ctx.pasteSelection());
    else void ctx.guard(() => ctx.restoreEdit(action === 'redo'));
  });
  ctx.el('action').addEventListener('change', () => {
    if (ctx.session.selection.size <= 1 || ctx.session.pendingPaste) return;
    ctx.session.batchChanges = { ...Object.fromEntries(Object.entries(ctx.session.batchChanges).filter(([key]) => !key.startsWith('hit.'))), action: ctx.el<HTMLSelectElement>('action').value };
    ctx.markBindingDirty(); ctx.renderBatch();
  });
  ctx.el('binding-form').addEventListener('input', event => {
    const input = event.target as HTMLInputElement;
    if (!input.dataset.batchKey) return;
    if (input.value === '') delete ctx.session.batchChanges[input.dataset.batchKey];
    else ctx.session.batchChanges[input.dataset.batchKey] = input.type === 'number' ? Number(input.value) : input.value;
    ctx.markBindingDirty(); ctx.previewBatch();
  });
  ctx.el('binding-form').addEventListener('change', event => {
    const input = event.target as HTMLInputElement;
    const key = input.dataset.batchKey; if (!key) return;
    if (input.value === '') delete ctx.session.batchChanges[key];
    else ctx.session.batchChanges[key] = input.type === 'number' ? Number(input.value) : input.value;
    ctx.markBindingDirty();
    if (key === 'pressAction' || key.endsWith('.mode') || key.endsWith('.style') || key === 'pad.dual') ctx.renderBatch();
    ctx.previewBatch();
  });
}

export async function selectGroup(ctx: HardwareWorkspaceContext, ids: ControlId[]): Promise<void> {
  const target = ctx.session.inspector === 'mode' && ids.length === 1 ? ctx.session.profile.modes.find(mode => (mode.selectorButton ?? mode.selectorPad) === ids[0]) : undefined;
  const changingMode = target && target.id !== ctx.session.editorModeId;
  if (!changingMode && ids.length === ctx.session.selection.size && ids.every(id => ctx.session.selection.has(id))) return;
  if (changingMode && ctx.session.editingMode) return ctx.options.toast(t('finish_name_edit_first'));
  if (!await ctx.discardBindingDraft()) return;
  if (target) ctx.session.editorModeId = target.id;
  ctx.session.select(ids, true);
  ctx.renderModes(); ctx.renderBinding(); renderMap(ctx); renderPressed(ctx); ctx.queueModeLights();
}

export async function selectControl(ctx: HardwareWorkspaceContext, id: ControlId, extend = false): Promise<void> {
  await selectGroup(ctx, selectControls([...ctx.session.selection], [id], extend));
}

export function selectHardwareControl(ctx: HardwareWorkspaceContext, id: ControlId): void {
  if (!ctx.session.followHardwareSelection || ctx.session.selection.size > 1 || id === ctx.session.selected || ctx.session.hardwareSelectionPending || document.getElementById('page-mapping')?.hidden !== false) return;
  ctx.session.hardwareSelectionPending = true;
  void ctx.guard(async () => {
    try { await ctx.selectControl(id); }
    finally { ctx.session.hardwareSelectionPending = false; }
  });
}

export function handleEvent(ctx: HardwareWorkspaceContext, event: InputEvent): void {
  if (event.kind === 'button' && event.pressed)
    selectHardwareControl(ctx, event.controlId === 'SMART_STRIP_TOUCH' ? 'SMART_STRIP' : event.controlId);
  else if (event.kind === 'pad' && event.raw > 0 && (event.event === 'note-on' || event.event === 'press-on'))
    selectHardwareControl(ctx, event.controlId);
  else if (event.kind === 'encoder' && event.delta !== 0) selectHardwareControl(ctx, 'ENCODER_ROTATE');
  else if (event.kind === 'strip' && event.raw > 0) selectHardwareControl(ctx, 'SMART_STRIP');
}

export function renderModeMap(ctx: HardwareWorkspaceContext): void {
  ctx.el('hardware').classList.add('mode-preview');
  ctx.el('hardware').querySelectorAll<HTMLButtonElement>('[data-control]').forEach(button => {
    const id = button.dataset.control as ControlId;
    const target = ctx.session.profile.modes.find(mode => (mode.selectorButton ?? mode.selectorPad) === id);
    button.classList.toggle('selected', ctx.session.selection.has(id));
    button.classList.toggle('is-mapped', !!target); button.classList.toggle('is-mode-current', target?.id === ctx.session.editorModeId);
    button.classList.remove('is-pressed'); button.setAttribute('aria-pressed', String(ctx.session.selection.has(id)));
    button.dataset.modeId = target?.id ?? '';
    button.title = `${controlName(id)} · ${target?.name ?? t('unassigned_mode_pad')}`;
    button.setAttribute('aria-label', t('select', { p0: button.title }));
    if (isPad(id)) {
      ctx.paintPad(button, { color: target?.color ?? 0, brightness: target?.id === ctx.session.editorModeId ? 'bright' : 'dim' });
      button.querySelector('.pad-assignment')!.textContent = target?.name ?? t('unassigned_mode_pad');
    }
  });
  ctx.el('mapped-count').textContent = t('assigned_mode_count', { p0: ctx.session.profile.modes.filter(mode => mode.selectorButton || mode.selectorPad).length });
  ctx.renderEditActions();
}

export function renderMap(ctx: HardwareWorkspaceContext): void {
  const modeView = ctx.session.inspector === 'mode';
  ctx.el('legend-mapped').textContent = t(modeView ? 'assigned_mode_pad' : 'mapped');
  ctx.el('legend-unmapped').textContent = t(modeView ? 'unassigned_mode_pad' : 'unmapped');
  if (modeView) return renderModeMap(ctx);
  ctx.el('hardware').classList.remove('mode-preview');
  const count = new Set([
    ctx.session.profile.modeSelector,
    ...Object.entries(ctx.currentMode().bindings).filter(([, b]) => b && b.type !== 'none').map(([id]) => id === 'SMART_STRIP_TOUCH' ? 'SMART_STRIP' : id),
    ...Object.entries(ctx.currentMode().pressureBindings ?? {}).filter(([, b]) => b && b.type !== 'off').map(([id]) => id)
  ]).size;
  ctx.el('hardware').querySelectorAll<HTMLButtonElement>('[data-control]').forEach(button => {
    const id = button.dataset.control as ControlId, binding = ctx.currentMode().bindings[id];
    const press = isPad(id) ? ctx.currentMode().pressureBindings?.[id] : undefined;
    const touch = id === 'SMART_STRIP' ? ctx.currentMode().bindings.SMART_STRIP_TOUCH : undefined;
    const mapped = id === ctx.session.profile.modeSelector || Boolean(binding && binding.type !== 'none' || press && press.type !== 'off' || touch && touch.type !== 'none');
    button.classList.remove('is-mode-current'); delete button.dataset.modeId;
    button.classList.toggle('is-mapped', mapped); button.classList.toggle('selected', ctx.session.selection.has(id));
    button.setAttribute('aria-pressed', String(ctx.session.selection.has(id)));
    button.title = `${controlName(id)} · ${ctx.controlSummary(id)}`;
    button.setAttribute('aria-label', t('select', { p0: button.title }));
    button.removeAttribute('data-i18n-aria-label'); button.removeAttribute('data-i18n-aria-label-params');
    if (PAD_IDS.includes(id as `PAD_${number}`)) {
      const light = ctx.currentMode().pads[Number(id.slice(4)) - 1];
      ctx.paintPad(button, { ...light, brightness: ctx.currentMode().padOffBrightness });
      button.querySelector('.pad-assignment')!.textContent = binding?.type === 'note' ? `CH ${binding.channel}\n${ctx.noteLabel(binding.note)}` : ctx.bindingLabel(binding);
    }
  });
  ctx.el('mapped-count').textContent = t('controls_mapped', { p0: count });
  ctx.renderEditActions();
}

export function renderPressed(ctx: HardwareWorkspaceContext): void {
  const state = ctx.runtime.snapshot;
  const pressed = new Set(state.pressedButtons), activePads = new Set(state.activePads);
  document.querySelectorAll<HTMLElement>('[data-control]').forEach(button => {
    if (button.dataset.control?.startsWith('PAD_')) return;
    const mapping = ctx.el('hardware').contains(button);
    button.classList.toggle('is-pressed', (!mapping || ctx.session.inspector === 'control' && ctx.session.editorModeId === state.activeModeId) && pressed.has(button.dataset.control!));
  });
  document.querySelectorAll<HTMLButtonElement>('[data-control^="PAD_"]').forEach(button => {
    const id = button.dataset.control as `PAD_${number}`;
    if (!PAD_IDS.includes(id)) return;
    const mapping = ctx.el('hardware').contains(button);
    if (mapping && ctx.session.inspector === 'mode') return;
    const mode = mapping ? ctx.currentMode() : ctx.session.profile.modes.find(mode => mode.id === state.activeModeId) ?? ctx.currentMode();
    const pressed = (!mapping || ctx.session.editorModeId === state.activeModeId) && activePads.has(id);
    button.classList.toggle('is-pressed', pressed);
    if (state.selectingMode) {
      const target = ctx.session.profile.modes.find(mode => mode.selectorPad === id);
      ctx.paintPad(button, { color: target?.color ?? 0, brightness: target?.id === state.activeModeId ? 'bright' : 'dim' });
      button.querySelector('.pad-assignment')!.textContent = target?.name ?? '';
      return;
    }
    const binding = mode.bindings[id];
    button.querySelector('.pad-assignment')!.textContent = binding?.type === 'note' ? `CH ${binding.channel}\n${ctx.noteLabel(binding.note)}` : ctx.bindingLabel(binding);
    const light = mode.pads[Number(id.slice(4)) - 1];
    ctx.paintPad(button, pressed ? { color: light.onColor ?? light.color, brightness: mode.padOnBrightness } : { ...light, brightness: mode.padOffBrightness });
  });
}

