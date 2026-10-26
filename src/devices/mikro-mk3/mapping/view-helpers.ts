import {
  PAD_IDS,
  type Binding, type Brightness, type ControlId
} from '@midiy/mikro-core';
import { labelAttributes, labelMarkup, t, translateLabel } from '../../../i18n/index';
import { getControl } from '../controls.js';

export const PAD_PREVIEW = ['#666666', '#ef6262', '#ef914b', '#efac70', '#eab760', '#e4cd5c', '#a9d866', '#60be82', '#6bd0ad', '#71cdd9', '#52b1c8', '#749ee9', '#9d87c9', '#a087e4', '#b377d4', '#cf77bc', '#e979ae', '#e7e7df'];
export const isPad = (id: ControlId): id is `PAD_${number}` => PAD_IDS.includes(id as `PAD_${number}`);
export const brightnessOptions = (selected: Brightness) => ([['off', t('off')], ['dim', t('low')], ['normal', t('medium')], ['bright', t('high')]] as const)
  .map(([value, label]) => `<option value="${value}" ${labelAttributes(label)} ${selected === value ? 'selected' : ''}>${label}</option>`).join('');
export const controlName = (id: ControlId) => translateLabel(getControl(id)?.label ?? id);
export const html = (text: unknown) => String(text).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
export const field = (id: string, label: string, value: number, min = 0, max = 127) => `<label>${labelMarkup(label)}<input id="bind-${id}" type="number" min="${min}" max="${max}" value="${value}" required></label>`;
export const ccFields = (prefix: string, binding?: Binding, max = 127, includeActionOn = true) => {
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
