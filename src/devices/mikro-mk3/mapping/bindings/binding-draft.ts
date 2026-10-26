import { parseProfile, type ControlId, type Profile } from '@midiy/mikro-core';
import type { BindingFields } from './binding-fields';
import { readButtonBinding } from './button-editor';
import { readEncoderBinding } from './encoder-editor';
import { readPadHit, readPadLight, readPadPress } from './pad-editor';
import { readStripLight, readStripPosition, readStripTouch } from './strip-editor';
import { isPad } from '../view-helpers';

/** Form values become a detached, validated draft; the caller owns apply and save. */
export function readBindingDraft(profile: Profile, modeId: string, id: ControlId, action: string, fields: BindingFields): Profile {
  const next = parseProfile(profile), mode = next.modes.find(mode => mode.id === modeId)!;
  if (id === next.modeSelector) return next;
  const binding = isPad(id) ? readPadHit(fields, action) : id === 'SMART_STRIP' ? readStripPosition(fields, action)
    : id === 'ENCODER_ROTATE' ? readEncoderBinding(fields, action) : readButtonBinding(fields, action);
  if (binding.type === 'fixed-velocity') for (const [key, value] of Object.entries(mode.bindings)) {
    if (value?.type === 'fixed-velocity') delete mode.bindings[key as ControlId];
  }
  mode.bindings[id] = binding;
  if (isPad(id)) {
    const index = Number(id.slice(4)) - 1;
    mode.pads[index] = readPadLight(fields, mode.pads[index].brightness);
    const press = readPadPress(fields);
    if (press.type === 'off') {
      delete mode.pressureBindings?.[id];
      if (mode.pressureBindings && !Object.keys(mode.pressureBindings).length) delete mode.pressureBindings;
    } else (mode.pressureBindings ??= {})[id] = press;
  }
  if (id === 'SMART_STRIP') {
    const touch = readStripTouch(fields);
    if (touch.type === 'none') delete mode.bindings.SMART_STRIP_TOUCH;
    else mode.bindings.SMART_STRIP_TOUCH = touch;
    mode.stripLight = readStripLight(fields);
  }
  return parseProfile(next);
}
