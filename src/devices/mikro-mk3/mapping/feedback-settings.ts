import {
  parseProfile,
  type Brightness,
  type PadVelocityCurve
} from '@midiy/mikro-core';
import { formatError, t } from '../../../i18n/index';
import { TranslatorRuntime } from '../runtime';
import { EditorSession } from './editor-session';
import { ProfileLibrary } from './profile-library';

import type { Mode } from '@midiy/mikro-core';
import type { TranslatorOptions } from './view-contracts';
import { brightnessOptions } from './view-helpers';
export interface FeedbackSettingsContext {
  currentMode: () => Mode;
  el: <T extends HTMLElement = HTMLElement>(id: string) => T;
  library: ProfileLibrary;
  options: TranslatorOptions;
  queueModeLights: () => void;
  renderPressed: () => void;
  renderSaveState: () => void;
  runtime: TranslatorRuntime;
  session: EditorSession;
}

export function mountFeedback(ctx: FeedbackSettingsContext): void {
  for (const id of ['button-idle-brightness', 'button-on-brightness', 'toggle-button-off-brightness', 'toggle-button-on-brightness', 'pad-off-brightness', 'pad-on-brightness']) {
    ctx.el<HTMLSelectElement>(id).addEventListener('change', () => saveLedSettings(ctx));
  }
  ctx.el<HTMLSelectElement>('pad-velocity-curve').addEventListener('change', () => saveVelocityCurve(ctx));
}

export function renderLedSettings(ctx: FeedbackSettingsContext): void {
  ctx.el<HTMLSelectElement>('pad-velocity-curve').value = ctx.session.profile.padVelocityCurve;
  const mode = ctx.currentMode();
  ctx.el<HTMLSelectElement>('button-idle-brightness').innerHTML = brightnessOptions(mode.buttonLight.off);
  ctx.el<HTMLSelectElement>('button-on-brightness').innerHTML = brightnessOptions(mode.buttonLight.on);
  ctx.el<HTMLSelectElement>('toggle-button-off-brightness').innerHTML = brightnessOptions(mode.toggleButtonLight.off);
  ctx.el<HTMLSelectElement>('toggle-button-on-brightness').innerHTML = brightnessOptions(mode.toggleButtonLight.on);
  ctx.el<HTMLSelectElement>('pad-off-brightness').innerHTML = brightnessOptions(mode.padOffBrightness);
  ctx.el<HTMLSelectElement>('pad-on-brightness').innerHTML = brightnessOptions(mode.padOnBrightness);
}

export function saveVelocityCurve(ctx: FeedbackSettingsContext): void {
  const next = parseProfile({ ...ctx.session.profile, padVelocityCurve: ctx.el<HTMLSelectElement>('pad-velocity-curve').value as PadVelocityCurve });
  try {
    ctx.library.save(next);
    ctx.session.history.record(next); ctx.session.profile = next;
    // Only future hits change; preserve held notes and their release targets.
    ctx.runtime.setVelocityCurve(next.padVelocityCurve);
    ctx.renderSaveState();
  } catch (error) {
    ctx.el<HTMLSelectElement>('pad-velocity-curve').value = ctx.session.profile.padVelocityCurve;
    ctx.options.toast(t('could_not_save_velocity_curve', { p0: formatError(error) }));
  }
}

export function saveLedSettings(ctx: FeedbackSettingsContext): void {
  const off = ctx.el<HTMLSelectElement>('button-idle-brightness').value as Brightness;
  const on = ctx.el<HTMLSelectElement>('button-on-brightness').value as Brightness;
  const padOn = ctx.el<HTMLSelectElement>('pad-on-brightness').value as Brightness;
  const next = parseProfile(ctx.session.profile);
  const mode = next.modes.find(m => m.id === ctx.session.editorModeId)!;
  mode.buttonLight = { off, on };
  mode.toggleButtonLight = {
    off: ctx.el<HTMLSelectElement>('toggle-button-off-brightness').value as Brightness,
    on: ctx.el<HTMLSelectElement>('toggle-button-on-brightness').value as Brightness,
  };
  mode.padOnBrightness = padOn;
  mode.padOffBrightness = ctx.el<HTMLSelectElement>('pad-off-brightness').value as Brightness;
  try {
    ctx.library.save(next);
    ctx.session.history.record(next); ctx.session.profile = next;
    ctx.runtime.updateFeedback(next); ctx.renderPressed(); ctx.queueModeLights(); ctx.renderSaveState();
  } catch (error) {
    renderLedSettings(ctx);
    ctx.options.toast(t('could_not_save_light_settings', { p0: formatError(error) }));
  }
}

