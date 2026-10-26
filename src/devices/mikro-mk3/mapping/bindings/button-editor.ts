import type { Binding } from '@midiy/mikro-core';
import { t } from '../../../../i18n/index';
import { readSwitchCc, type BindingFields } from './binding-fields';

/** Discrete Button actions; Pad Hit reuses these with velocity/action-on rules. */
export function readButtonBinding(f: BindingFields, action: string, pad = false): Binding {
  const { val, num } = f;
  let b: Binding = { type: 'none' };
  if (action === 'note') {
    const noteMode = val('note-mode') as 'gate' | 'toggle';

    if (pad && num('velocity-min') > num('velocity-max')) throw new Error(t('output_minimum_cannot_exceed_output_maximum'));
    b = {
      type: 'note', channel: num('channel'), note: num('note'), velocity: pad ? 'pad' : 127,
      ...(pad ? { velocityMin: num('velocity-min'), velocityMax: num('velocity-max') } : {}),
      mode: noteMode, ...(noteMode === 'toggle' && !pad ? { actionOn: val('note-action-on') as 'down' | 'up' } : {})
    };
  }
  else if (action === 'fixed-velocity') b = { type: 'fixed-velocity', velocity: num('fixed-velocity') };
  else if (action === 'mode') b = { type: 'mode', modeId: val('mode') };
  else if (action === 'cc') {
    const shared = { type: 'cc' as const, channel: num('channel'), controller: num('controller') };
    b = readSwitchCc(f, '', pad, shared);
  } else if (['poly-pressure', 'channel-pressure', 'program', 'pitchbend'].includes(action)) {
    const shared = {
      type: 'button-value' as const, channel: num('channel'), output: action as 'poly-pressure' | 'channel-pressure' | 'program' | 'pitchbend',
      ...(action === 'poly-pressure' ? { note: num('note') } : {})
    };
    const style = val('style');
    const actionOn = !pad ? { actionOn: val('action-on') as 'down' | 'up' } : {};
    if (style === 'momentary') b = { ...shared, mode: 'gate', on: num('on'), off: num('off') };
    else if (style === 'toggle') b = { ...shared, mode: 'toggle', on: num('on'), off: num('off'), ...actionOn };
    else if (style === 'trigger') b = { ...shared, mode: 'trigger', value: num('value'), ...actionOn };
    else b = { ...shared, mode: 'inc', from: num('from'), to: num('to'), step: num('step'), wrap: f.checked('wrap'), ...actionOn };
  }
  return b;
}
