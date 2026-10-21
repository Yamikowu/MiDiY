import { InputDecoder, encodeLights, BUTTON_IDS, type Mode, type OutputReport } from '@midiy/mikro-core';
import type { RawReport } from '../../runtime/contracts';
import { mikroDefinition } from './definition';

export interface PerformanceState { activePads: Set<string>; pressedButtons: Set<string>; stripRaw: number }
/** Mikro-specific protocol stays here; the existing public core API remains unchanged. */
export class MikroDriver {
  readonly definition = mikroDefinition;
  private decoder = new InputDecoder();
  decode(report: RawReport) { return this.decoder.decode(report.reportId, report.data); }
  reset() { this.decoder.reset(); }
  lights(mode: Mode, state: PerformanceState): OutputReport {
    const buttons = Object.fromEntries(BUTTON_IDS.slice(0, 39)
      .filter(id => { const b = mode.bindings[id]; return b && b.type !== 'none'; })
      .map(id => [id, mode.buttonLight ?? { off: 'off', on: 'normal' }]));
    return encodeLights({ pads: mode.pads, pressedPads: state.activePads,
      padOnBrightness: mode.padOnBrightness, buttons, pressedButtons: state.pressedButtons,
      strip: { raw: state.stripRaw, mode: mode.stripLight?.mode ?? 'dot',
        brightness: mode.stripLight?.brightness ?? 'normal', color: mode.stripLight?.color } });
  }
  allOff(): OutputReport { return { reportId: 0x80, data: new Uint8Array(80) }; }
}
