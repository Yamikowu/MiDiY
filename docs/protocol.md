# Mikro MK3 protocol and portability notes

Source of protocol logic: r00tman/maschine-mikro-mk3-driver revision
`30f9b6013f3559dc1774d3ddb82affabd376692a`. Source of physical Pad numbering:
MPA's existing 2026-10-19 captures, checked against all sixteen Pad captures.
Retain `THIRD_PARTY_NOTICES.md` and the core LICENSE when porting.

## Input

All offsets below address payload only. Rust `hidapi` buffers include the report
ID at byte 0, so subtract one from Rust's payload byte indices.

| Report | Payload | Meaning |
|---|---|---|
| 0x01 | observed 13 bytes | bytes 0–5: button bits 0–40, LSB first; byte 6: Encoder raw; byte 9: Strip raw |
| 0x02 | observed 63 bytes | up to 21 three-byte Pad events |

For a Pad triplet `[index, packed, low]`, event is `packed & 0xf0`, raw is
`((packed & 0x0f) << 8) | low` (0–4095). Event values: PressOn 0x00, NoteOn 0x10,
PressOff 0x20, NoteOff 0x30, Aftertouch 0x40. Rust's velocity conversion is raw >> 5,
with nonzero raw clamped to at least 1. Keep raw pressure separate from MIDI velocity.

After the first triplet, `[0,0,0]` terminates padding. The first `[0,0,0]` is decoded
as Pad index 0 PressOn per Rust, but the MIDI engine ignores zero-valued on events
to avoid phantom notes. Unknown triplets remain in the raw report with a diagnostic.

Device Pad indices run from the top-left across rows: 0–3 correspond to physical
Pad 13–16, then 4–7 to Pad 9–12, 8–11 to Pad 5–8, 12–15 to Pad 1–4.
All button bit names and stable IDs are exported as `BUTTON_IDS`.

Rust only prints Encoder raw values; no modulus is established. MPA emits raw
subtraction and lets profiles specify a modulus (0 means none). Rust ignores Strip
zero and scales its other values with a formula using 200; MPA's CC default range
1–200 is configurable and must be calibrated against the physical endpoints.
Bytes 7–8 and 10–12, plus unused button bits, are preserved without semantic claims.

## LED output

`sendReport(0x80, Uint8Array(80))`: ID is separate from data. Button slots 0–38,
Pad device indices 0–15 at slots 39–54, Strip slots 55–79. v1 fills button/Strip
slots with zero and supplies Pad settings in physical Pad 1–16 order.

Pad value is zero for Off; otherwise `(color << 2) + (brightness & 3)`.
Colors 1–17 follow Rust's `PadColors` enum (Red through White).
Rust brightness constants: Off 0x00, Dim 0x7c, Normal 0x7e, Bright 0x7f.
These are palette entries, not arbitrary 24-bit RGB.

The browser adapter validates the selected interface's output descriptor and
serializes writes. MPA coalesces pending light updates, only sends on state
changes, and does not send on initial connection. Enabling LED takeover writes
the entire state, so another application's light state cannot be preserved.
Manual disconnect after takeover sends all-off; physical unplug cannot send a reset.
Reloading/closing a page may leave the last LED state on the hardware.

## Screen reference (not implemented in v1)

Rust `screen.rs`: 512-byte framebuffer, 128 columns × 32 rows. Pixel (row, column)
uses index `floor(row / 8) * 128 + column` and bit `row % 8`; a cleared bit is lit.
Blank framebuffer is 0xff. Rust sends two writes with report ID 0xe0:

- payload header `[00,00,00,00,80,00,02,00]` + framebuffer bytes 0–255;
- payload header `[00,00,02,00,80,00,02,00]` + framebuffer bytes 256–511.

Each WebHID payload would be 264 bytes. The fixture records these headers and
pixel examples for a future screen serializer. v1 never emits 0xe0.

## Hardware migration

Use the same control IDs, profile schema, decoded event semantics, MIDI bytes and
golden vectors in a firmware port. Keep HID input/output, MIDI transport, storage
and UI outside the mapping engine. A hardware bridge must host the Mikro's USB
HID connection and supply sufficient power; wireless MIDI packetization, pairing
and reconnect policy belong to the chosen BLE-MIDI or network transport adapter.
No hardware platform or wireless transport has been selected or validated.
