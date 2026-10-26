import type { RuntimeSnapshot } from '../runtime';

/** Only live hardware visuals. MIDI counters and LED delivery status have separate views. */
export function performanceViewKey(state: RuntimeSnapshot): string {
  return JSON.stringify([state.activeModeId, state.selectingMode, state.activePads, state.pressedButtons,
    state.lightReport.reportId, Array.from(state.lightReport.data)]);
}
