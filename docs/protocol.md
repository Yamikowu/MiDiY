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
subtraction and lets profiles specify a modulus (0 means none). For the Strip,
the user-confirmed physical values are 0 on release, 1 at the left edge, and
200 at the right edge. A stationary touch produced a nonzero position followed
by zero on release in the 2026-10-20 capture. The decoder emits Touch down/up
transitions alongside the raw Position event. Position MIDI output ignores zero;
Touch MIDI output is configured independently. Profile CC endpoints remain
configurable.

Bytes 7–8 and 10–12, plus unused button bits, are preserved without semantic claims.

## LED output

`sendReport(0x80, Uint8Array(80))`: ID is separate from data. Button slots 0–38,
Pad device indices 0–15 at slots 39–54, Strip slots 55–79. Encoder Press/Touch
are input bits 39/40, not light slots. The profile supplies Pad settings in
physical Pad 1–16 order. Shared button off/on brightness, shared Pad pressed
brightness and Strip mode/brightness are scoped to each mode. Older profiles
without these fields use off/normal buttons, bright Pad presses and a
normal-brightness Dot strip. Legacy per-button brightness entries remain
importable but do not override the shared button setting.

Pad value is zero for Off; otherwise `(color << 2) + (brightness & 3)`.
Colors 1–17 follow Rust's `PadColors` enum (Red through White).
Rust brightness constants: Off 0x00, Dim 0x7c, Normal 0x7e, Bright 0x7f.
These are palette entries, not arbitrary 24-bit RGB.
Pad Single uses one color at idle and pressed brightness; Dual can use a
separate on color. Pad idle brightness is per Pad, while pressed brightness is
shared across all 16 Pads. Button slots use the brightness byte directly. Strip
slots can also encode a palette color using `(color << 2) + level`, with level
1–3 for dim/normal/bright, as in pymikro. Profiles without a Strip color
default to White (palette index 17). Strip raw 1–200 maps left to right across 25 LEDs; raw 0 means release
and all Strip LEDs off. Dot illuminates one LED, Bar fills from the left, and
Pan fills from the center toward the position. The browser currently follows
local HID actions (Controller Editor's For MIDI Out behavior); external MIDI In
feedback is not implemented.

The browser adapter validates the selected interface's output descriptor and
serializes writes. MPA coalesces pending light updates, only sends on state
changes, and does not send on initial connection. Enabling LED takeover writes
the entire state, so another application's light state cannot be preserved.
Manual disconnect and `pagehide` (reload/navigation/close) share an idempotent
shutdown. With LED takeover active, shutdown disables light producers, discards
pending UI updates, cancels queued adapter writes, waits for any in-flight write,
then attempts one 0x80 report with all 80 payload bytes zero (Pads, buttons and
Smart Strip) before closing. New writes are rejected while closing; repeated
shutdown requests share the same operation. Without takeover, no reset is sent.
Manual disconnect awaits completion; a failed reset still attempts to close.
`pagehide` starts this sequence but the browser does not await it. Suspension,
termination, a stalled write, HID errors, or physical unplug can prevent reset;
reload/close therefore cannot guarantee dark LEDs. A resolved send is not a
hardware acknowledgement of the visible state.

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
