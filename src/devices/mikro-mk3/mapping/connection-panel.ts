import { formatError, t } from '../../../i18n/index';
import { TranslatorRuntime } from '../runtime';

import type { TranslatorOptions } from './view-contracts';
import { html } from './view-helpers';
export interface ConnectionPanelContext {
  el: <T extends HTMLElement = HTMLElement>(id: string) => T;
  guard: (action: () => void | Promise<void>) => Promise<void>;
  options: TranslatorOptions;
  runtime: TranslatorRuntime;
}

export function mountConnection(ctx: ConnectionPanelContext): void {
  ctx.el('enable').addEventListener('click', () => ctx.guard(() => ctx.runtime.enableMidi()));
  ctx.el('output').addEventListener('change', () => ctx.guard(async () => {
    const id = ctx.el<HTMLSelectElement>('output').value;
    await ctx.runtime.selectOutput(id); renderPorts(ctx);
  }));
  ctx.el('panic').addEventListener('click', () => {
    ctx.runtime.panic(); ctx.options.toast(t('active_notes_and_held_cc_values_have_been_released'));
  });
  ctx.el('led-enable').addEventListener('change', () => {
    ctx.runtime.setLedEnabled(ctx.el<HTMLInputElement>('led-enable').checked);
    renderDevice(ctx);
  });
}

export function renderPorts(ctx: ConnectionPanelContext): void {
  const select = ctx.el<HTMLSelectElement>('output');
  if (!select) return;
  const midi = ctx.runtime.snapshot.midi;
  select.innerHTML = `<option value="" data-i18n="disable_midi_output">${t('disable_midi_output')}</option>` + midi.ports.map(p => `<option value="${html(p.id)}">${html(p.name)}</option>`).join('');
  select.disabled = !midi.enabled; select.value = midi.output?.id ?? '';
  ctx.el('status').textContent = midi.output ? t('output', { p0: midi.output.name }) : t('no_midi_output_selected');
}

export function renderDevice(ctx: ConnectionPanelContext): void {
  const state = ctx.runtime.snapshot;
  const connected = Boolean(state.device);
  const supported = state.device?.outputReportIds.includes(0x80);
  ctx.el<HTMLInputElement>('led-enable').disabled = !connected || !supported;
  ctx.el<HTMLInputElement>('led-enable').checked = state.ledEnabled;
  ctx.el('led-summary').textContent = state.ledEnabled ? t('controlled') : t('not_controlled');
  ctx.el('led-status').textContent = (state.ledIssue ? formatError(state.ledIssue) : state.ledStatus) || (!connected
    ? t('connecting_does_not_automatically_send_led_or_screen_reports')
    : !supported ? t('this_hid_interface_does_not_declare_output_0x80_led_takeover_is_unavaila')
      : !state.ledEnabled ? t('device_ready_enable_takeover_to_control_pad_button_and_strip_lights') : '');
  ctx.el('led-status').hidden = !state.ledIssue || state.ledIssue.code === 'led_sent';
  ctx.el('led-enable').closest('label')!.title = `${t('led_toggle_hint')}\n${t(state.ledEnabled ? 'controlled' : 'not_controlled')}\n${ctx.el('led-status').textContent}`;
}

