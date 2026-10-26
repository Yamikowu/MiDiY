import { controls, getControl } from './controls.js';
import { refreshHardwareLabels, renderHardware } from './ui/hardware-view.js';

/** Only the Mikro entry point supplies these device-specific research views. */
export const mikroResearch = { controls, getControl, renderHardware, refreshHardwareLabels, initialControlId: 'PAD_1' };
