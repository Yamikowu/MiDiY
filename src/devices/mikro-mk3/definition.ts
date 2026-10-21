import { VENDOR_ID, PRODUCT_ID, CONTROL_IDS } from '@midiy/mikro-core';
import { controls, mappingControls } from './controls.js';

export const mikroDefinition = {
  id: 'maschine-mikro-mk3', name: 'Maschine Mikro MK3',
  input: { vendorId: VENDOR_ID, productId: PRODUCT_ID, preferredOutputReportId: 0x80 },
  controls: mappingControls, captureControls: controls, controlIds: CONTROL_IDS,
  capabilities: { buttons: true, pads: true, pressure: true, encoder: true, strip: true,
    lights: true, screen: false },
} as const;
