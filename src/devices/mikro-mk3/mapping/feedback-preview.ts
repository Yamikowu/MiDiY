import {
  BUTTON_IDS,
  type ControlId,
  type OutputReport,
  type PadLight
} from '@midiy/mikro-core';
import { t } from '../../../i18n/index';
import { MikroDriver } from '../driver';
import { TranslatorRuntime } from '../runtime';
import { isPadControl, patchControls } from './editor-model';
import { EditorSession } from './editor-session';

import type { Mode } from '@midiy/mikro-core';
import { PAD_PREVIEW, controlName } from './view-helpers';
export interface FeedbackPreviewContext {
  controlSummary: (id: ControlId) => string;
  currentMode: () => Mode;
  el: <T extends HTMLElement = HTMLElement>(id: string) => T;
  previewDriver: Pick<MikroDriver, 'lights'>;
  readPadLightDraft: () => PadLight | null;
  runtime: Pick<TranslatorRuntime, 'snapshot'>;
  readonly session: Readonly<Pick<EditorSession, 'batchChanges' | 'editorModeId' | 'inspector' | 'pendingPaste' | 'profile' | 'selected' | 'selection'>>;
}

export function previewBatch(ctx: FeedbackPreviewContext): void {
  if (ctx.session.inspector === 'mode' || ctx.runtime.snapshot.selectingMode) return;
  let draft = ctx.session.pendingPaste;
  if (!draft && ctx.session.selection.size > 1) {
    try { draft = patchControls(ctx.session.profile, ctx.session.editorModeId, [...ctx.session.selection], ctx.session.batchChanges); } catch { return; }
  }
  if (!draft) return;
  const mode = draft.modes.find(m => m.id === ctx.session.editorModeId)!;
  for (const id of ctx.session.selection) if (isPadControl(id)) {
    const button = ctx.el('hardware').querySelector<HTMLButtonElement>(`[data-control="${id}"]`);
    const light = mode.pads[Number(id.slice(4)) - 1];
    if (button) paintPad(ctx, button, { ...light, brightness: mode.padOffBrightness }, true);
  }
}

export function paintPad(ctx: FeedbackPreviewContext, button: HTMLButtonElement, light: PadLight, preview = false): void {
  button.style.setProperty('--pad-color', PAD_PREVIEW[light.color]);
  button.classList.toggle('has-light', light.color !== 0 && light.brightness !== 'off');
  button.classList.toggle('preview-light', preview);
  button.dataset.brightness = light.brightness;
}

export function previewPadLight(ctx: FeedbackPreviewContext): void {
  if (ctx.session.inspector === 'mode' || ctx.runtime.snapshot.selectingMode) return;
  const draft = ctx.readPadLightDraft();
  if (!draft) return;
  const saved = ctx.currentMode().pads[Number(ctx.session.selected.slice(4)) - 1];
  const preview = draft.color !== saved.color || (draft.onColor ?? draft.color) !== (saved.onColor ?? saved.color) || draft.brightness !== saved.brightness;
  const button = ctx.el('hardware').querySelector<HTMLButtonElement>(`[data-control="${ctx.session.selected}"]`);
  if (!button) return;
  paintPad(ctx, button, { ...draft, brightness: ctx.currentMode().padOffBrightness }, preview);
  button.title = `${controlName(ctx.session.selected)} · ${ctx.controlSummary(ctx.session.selected)}${preview ? t('light_preview_not_applied') : ''}`;
  button.setAttribute('aria-label', t('select', { p0: button.title }));
  button.removeAttribute('data-i18n-aria-label'); button.removeAttribute('data-i18n-aria-label-params');
}

export function queueModeLights(ctx: FeedbackPreviewContext): void {
  const state = ctx.runtime.snapshot;
  const preview = ctx.session.inspector === 'mode' || ctx.session.editorModeId !== state.activeModeId && !state.selectingMode;
  const report = preview ? ctx.previewDriver.lights(ctx.currentMode(), { activePads: new Set(), pressedButtons: new Set(), stripRaw: 0 }, ctx.session.profile, ctx.session.inspector === 'mode') : state.lightReport;
  renderLightPreview(ctx, report);
}

export function renderLightPreview(ctx: FeedbackPreviewContext, report: OutputReport): void {
  const stripLight = ctx.currentMode().stripLight;
  ctx.el('hardware').querySelectorAll<HTMLElement>('.strip-light').forEach((dot, index) => {
    dot.classList.toggle('is-lit', report.data[55 + index] !== 0);
    dot.dataset.brightness = stripLight?.brightness ?? 'normal';
    dot.style.setProperty('--strip-led-color', PAD_PREVIEW[stripLight?.color ?? 17]);
  });
  for (let index = 0; index < 39; index++) {
    const button = ctx.el('hardware').querySelector<HTMLElement>(`[data-control="${BUTTON_IDS[index]}"]`);
    if (!button) continue;
    button.classList.toggle('has-button-light', report.data[index] !== 0);
    button.dataset.lightBrightness = report.data[index] === 0x7f ? 'bright' : report.data[index] === 0x7c ? 'dim' : 'normal';
  }
}

