import { InputDecoder, encodeLights, BUTTON_IDS, PAD_IDS, type Profile, type Mode, type OutputReport, type InputEvent } from '@midiy/mikro-core';
import type { RawReport } from '../../runtime/contracts';
import { mikroDefinition } from './definition';

export interface PerformanceState { activePads: Set<string>; pressedButtons: Set<string>; litButtons?: Set<string>; stripRaw: number; stripLastRaw?: number }
/** Mikro-specific protocol stays here; the existing public core API remains unchanged. */
export class MikroDriver {
  readonly definition = mikroDefinition;
  private decoder = new InputDecoder();
  decode(report: RawReport) { return this.decoder.decode(report.reportId, report.data); }
  reset() { this.decoder.reset(); }
  shortcut(event: InputEvent, pressedButtons: ReadonlySet<string>): 'toggle-led' | 'disconnect' | undefined {
    if (event.kind !== 'button' || !event.pressed || !pressedButtons.has('SHIFT')) return;
    if (event.controlId === 'FAVORITES') return 'toggle-led';
    if (event.controlId === 'BROWSER') return 'disconnect';
  }
  lights(mode: Mode, state: PerformanceState, profile?: Profile, selectingMode = false): OutputReport {
    const buttons = Object.fromEntries(BUTTON_IDS.slice(0, 39)
      .filter(id => { const b = mode.bindings[id]; return id === profile?.modeSelector || b && b.type !== 'none'; })
      .map(id => {
        if (id === profile?.modeSelector) return [id, { off: 'dim', on: 'bright' }];
        const binding = mode.bindings[id]!;
        const toggle = binding.type === 'fixed-velocity' || (binding.type === 'cc' ? binding.style === 'toggle'
          : (binding.type === 'note' || binding.type === 'button-value') && binding.mode === 'toggle');
        return [id, toggle ? mode.toggleButtonLight : mode.buttonLight];
      }));
    const pads = selectingMode && profile ? PAD_IDS.map(id => {
      const target = profile.modes.find(candidate => candidate.selectorPad === id);
      return { color: target?.color ?? 0, brightness: target?.id === mode.id ? 'bright' as const : 'dim' as const };
    }) : mode.pads.map(pad => ({ ...pad, brightness: mode.padOffBrightness }));
    return encodeLights({
      pads, pressedPads: selectingMode ? new Set() : state.activePads,
      padOnBrightness: mode.padOnBrightness, buttons, pressedButtons: state.litButtons ?? state.pressedButtons,
      strip: {
        raw: state.stripRaw || (mode.stripLight?.hold ? state.stripLastRaw ?? 0 : 0), mode: mode.stripLight?.mode ?? 'dot',
        brightness: mode.stripLight?.brightness ?? 'normal', color: mode.stripLight?.color
      }
    });
  }
  allOff(): OutputReport { return { reportId: 0x80, data: new Uint8Array(80) }; }
}
