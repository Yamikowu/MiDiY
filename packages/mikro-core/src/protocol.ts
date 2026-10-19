// Adapted from r00tman/maschine-mikro-mk3-driver, MIT, copyright 2025 r00tman.
// Source revision 30f9b6013f3559dc1774d3ddb82affabd376692a. See ../LICENSE.
export const VENDOR_ID = 0x17cc;
export const PRODUCT_ID = 0x1700;
export const BUTTON_IDS = [
  'PROJECT', 'FAVORITES', 'BROWSER', 'VOLUME', 'SWING', 'TEMPO', 'PLUG_IN', 'SAMPLING',
  'ARROW_LEFT', 'ARROW_RIGHT', 'PITCH', 'MOD', 'PERFORM', 'NOTES', 'GROUP', 'AUTO',
  'LOCK', 'NOTE_REPEAT', 'RESTART', 'ERASE', 'TAP', 'FOLLOW', 'PLAY', 'REC',
  'STOP', 'SHIFT', 'FIXED_VEL', 'PAD_MODE', 'KEYBOARD', 'CHORDS', 'STEP', 'SCENE',
  'PATTERN', 'EVENTS', 'VARIATION', 'DUPLICATE', 'SELECT', 'SOLO', 'MUTE',
  'ENCODER_PUSH', 'ENCODER_TOUCH'
] as const;
export type ButtonId = typeof BUTTON_IDS[number];
export type PadId = `PAD_${number}`;
export type ControlId = ButtonId | PadId | 'ENCODER_ROTATE' | 'SMART_STRIP';
export const PAD_IDS = Array.from({ length: 16 }, (_, i) => `PAD_${i + 1}` as PadId);
export const CONTROL_IDS: readonly ControlId[] = [...BUTTON_IDS, 'ENCODER_ROTATE', 'SMART_STRIP', ...PAD_IDS];
export function padIndexToNumber(index: number): number {
  return (3 - Math.floor(index / 4)) * 4 + index % 4 + 1;
}
export function padNumberToIndex(number: number): number {
  return (3 - Math.floor((number - 1) / 4)) * 4 + (number - 1) % 4;
}
export type PadEventName = 'press-on' | 'note-on' | 'press-off' | 'note-off' | 'aftertouch';
const PAD_EVENTS: Record<number, PadEventName> = {
  0x00: 'press-on', 0x10: 'note-on', 0x20: 'press-off', 0x30: 'note-off', 0x40: 'aftertouch'
};
export type InputEvent =
  | { kind: 'button'; controlId: ButtonId; pressed: boolean }
  | { kind: 'encoder'; controlId: 'ENCODER_ROTATE'; raw: number; delta: number }
  | { kind: 'strip'; controlId: 'SMART_STRIP'; raw: number }
  | { kind: 'pad'; controlId: PadId; padIndex: number; event: PadEventName; raw: number; velocity: number };
export interface DecodedReport {
  reportId: number; raw: number[]; events: InputEvent[]; diagnostics: string[];
}
/** Payload excludes the report ID, as in WebHID. Unknown fields remain in raw. */
export class InputDecoder {
  private buttons = BUTTON_IDS.map(() => false);
  private encoder: number | undefined;
  private strip: number | undefined;
  reset(): void { this.buttons.fill(false); this.encoder = undefined; this.strip = undefined; }
  decode(reportId: number, payload: ArrayLike<number>): DecodedReport {
    const raw = Array.from(payload);
    const result: DecodedReport = { reportId, raw, events: [], diagnostics: [] };
    if (reportId === 1) {
      if (raw.length < 10) { result.diagnostics.push('Short 0x01 payload: need at least 10 bytes'); return result; }
      if (raw.length !== 13) result.diagnostics.push(`Unexpected 0x01 payload length: ${raw.length} (captured length 13)`);
      BUTTON_IDS.forEach((controlId, index) => {
        const pressed = Boolean(raw[index >> 3] & (1 << (index % 8)));
        if (pressed !== this.buttons[index]) result.events.push({ kind: 'button', controlId, pressed });
        this.buttons[index] = pressed;
      });
      const next = raw[6];
      // Rust only exposes the raw byte. Preserve subtraction without assuming a counter modulus.
      if (this.encoder !== undefined && next !== this.encoder) result.events.push({ kind: 'encoder', controlId: 'ENCODER_ROTATE', raw: next, delta: next - this.encoder });
      this.encoder = next;
      if (raw[9] !== this.strip) result.events.push({ kind: 'strip', controlId: 'SMART_STRIP', raw: raw[9] });
      this.strip = raw[9];
    } else if (reportId === 2) {
      if (!raw.length || raw.length % 3) result.diagnostics.push('Incomplete 0x02 pad triplet');
      for (let offset = 0; offset + 2 < raw.length; offset += 3) {
        const index = raw[offset], code = raw[offset + 1] & 0xf0;
        const value = ((raw[offset + 1] & 0x0f) << 8) | raw[offset + 2];
        // The first all-zero triplet is a legal pad-0 PressOn in the Rust decoder.
        if (offset > 0 && index === 0 && code === 0 && value === 0) break;
        if (index > 15 || !(code in PAD_EVENTS)) {
          result.diagnostics.push(`Unknown pad triplet at ${offset}: ${index}/${code}/${value}`); continue;
        }
        result.events.push({ kind: 'pad', controlId: `PAD_${padIndexToNumber(index)}`, padIndex: index,
          event: PAD_EVENTS[code], raw: value, velocity: value === 0 ? 0 : Math.max(1, value >> 5) });
      }
    } else result.diagnostics.push(`Unknown input report ID: ${reportId}`);
    return result;
  }
}

export const PAD_COLORS = ['Off', 'Red', 'Orange', 'LightOrange', 'WarmYellow', 'Yellow', 'Lime', 'Green', 'Mint', 'Cyan', 'Turquoise', 'Blue', 'Plum', 'Violet', 'Purple', 'Magenta', 'Fuchsia', 'White'] as const;
export type Brightness = 'off' | 'dim' | 'normal' | 'bright';
export interface PadLight { color: number; brightness: Brightness }
export const BRIGHTNESS = { off: 0, dim: 0x7c, normal: 0x7e, bright: 0x7f } as const;
export interface OutputReport { reportId: number; data: Uint8Array }
/** All 80 LED slots are sent together; unspecified button/strip slots are off. */
export function encodePadLights(pads: readonly PadLight[]): OutputReport {
  if (pads.length !== 16) throw new Error('Expected 16 pad lights in physical Pad 1–16 order');
  const data = new Uint8Array(80);
  pads.forEach((pad, i) => {
    if (!Number.isInteger(pad.color) || pad.color < 0 || pad.color > 17 || !Object.hasOwn(BRIGHTNESS, pad.brightness)) throw new Error('Invalid pad light');
    data[39 + padNumberToIndex(i + 1)] = pad.brightness === 'off' || pad.color === 0 ? 0 : (pad.color << 2) + (BRIGHTNESS[pad.brightness] & 3);
  });
  return { reportId: 0x80, data };
}
