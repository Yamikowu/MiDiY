import type { Binding } from '@midiy/mikro-core';
export interface BindingFields { val(id: string): string; num(id: string): number; checked(id: string): boolean }
export function readSwitchCc(f: BindingFields, prefix: string, pad: boolean, shared: { type: 'cc'; channel: number; controller: number }): Binding {
  const { val, num } = f;
  const style = val(`${prefix}style`);
  if (style === 'momentary') return { ...shared, style, on: num(`${prefix}on`), off: num(`${prefix}off`) };
  const actionOn = prefix || !pad ? { actionOn: val(`${prefix}action-on`) as 'down' | 'up' } : {};
  if (style === 'toggle') return { ...shared, style, on: num(`${prefix}on`), off: num(`${prefix}off`), ...actionOn };
  if (style === 'trigger') return { ...shared, style, value: num(`${prefix}value`), ...actionOn };
  return { ...shared, style: 'inc', from: num(`${prefix}from`), to: num(`${prefix}to`), step: num(`${prefix}step`), wrap: f.checked(`${prefix}wrap`), ...actionOn };
}
