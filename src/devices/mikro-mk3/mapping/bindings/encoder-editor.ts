import type { Binding } from '@midiy/mikro-core';
import { t } from '../../../../i18n/index';
import type { BindingFields } from './binding-fields';
import { field } from '../view-helpers';

export function readEncoderBinding(f: BindingFields, action: string): Binding {
  return action === 'cc' ? {
    type: 'cc', channel: f.num('channel'), controller: f.num('controller'), style: 'encoder',
    step: f.num('step'), initial: f.num('initial'), modulus: f.num('modulus')
  } : { type: 'none' };
}
export function encoderFields(binding?: Binding): string {
  const enc = binding?.type === 'cc' && binding.style === 'encoder' ? binding : undefined;
  return field('step', t('cc_increment_per_detent'), enc?.step ?? 1, 1)
    + field('initial', t('initial_cc_value'), enc?.initial ?? 64)
    + field('modulus', t('counter_modulus_0_no_wrap'), enc?.modulus ?? 0, 0, 256);
}
