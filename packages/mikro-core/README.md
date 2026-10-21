# @midiy/mikro-core

Portable Mikro MK3 HID decoder, MIDI mapping engine, profile validation and Pad
LED encoder. ESM + TypeScript declarations; no DOM, navigator, clock or storage
dependency. Build with `npm run build:core` from the MiDiY root. Reuse the package
directory as a local npm dependency; `npm pack --workspace @midiy/mikro-core` produces
a distributable package after building. This package and its adapted protocol
code are MIT licensed; include LICENSE when redistributing or porting.

```ts
import { InputDecoder, MappingEngine, createDefaultProfile, encodePadLights }
  from '@midiy/mikro-core';

const decoder = new InputDecoder();
const engine = new MappingEngine(createDefaultProfile());
// Transport supplies ID separately from payload, in arrival order.
for (const event of decoder.decode(2, [12, 0x18, 0x00]).events) {
  const result = engine.process(event);
  // Send result.messages through your own MIDI sink.
}
// Before changing the MIDI sink, send engine.flush() to the OLD sink.
// For HID disconnection, send engine.reset() and decoder.reset().
const led = encodePadLights(engine.mode.pads);
// Transport sends led.reportId plus led.data; do not prepend the ID to data.
```

`InputDecoder.decode()` returns semantic events, the entire original payload and
diagnostics. Encoder's first sample establishes a baseline; later events expose
raw subtraction. The profile can supply a counter modulus, default 0 (no assumed
wrap). Strip exposes its raw byte (0 release, 1 left edge, 200 right edge).
Its Position CC mapper ignores zero like the Rust driver and uses configurable
raw endpoints. Absolute mode scales into a configurable 0–127 range. Relative
and Relative (Offset) modes convert movement into 1/127 and 65/63 steps,
respectively, with configurable step and full-swipe resolution; first touch
establishes a baseline. Transitions between zero and nonzero generate independent Touch
button events for MIDI mapping.

`Profile` has schema `midiy-profile-v1`, name, initialModeId, and modes containing
stable ControlId bindings and 16 physical Pad 1–16 light settings. Channels are
1–16, Note/CC/Program values are 0–127. Bindings are discriminated unions exported
in the declarations: none, note (Gate/Toggle), cc (Gate/Toggle/Trigger/Inc/encoder/strip),
button-value (Poly/Channel Pressure, Program, Pitchbend), strip-position, value,
system, program, mode. `parseProfile(unknown)` validates
before use and returns a detached copy. Legacy `mpa-profile-v1` files remain
importable and are normalized to the MiDiY schema.
Port identifiers, browser objects and application callbacks do not belong here.

`MappingEngine.process()` returns MIDI byte arrays and a modeChanged flag. Pad
PressOn/NoteOn pairs are deduplicated. Optional per-pad `pressureBindings` keep
Press independent from the Hit binding and can map aftertouch to Note thresholds,
CC, Poly Pressure, Channel Pressure or Pitchbend. A missing field stays off for
older profiles. Pressure is scaled from the decoded 12-bit raw value; output
resets on release, reconfiguration, mode switches and Panic. Notes shared by
multiple held controls remain on until the
last owner releases. `switchMode()` and `reconfigure()` release sounding notes
without re-triggering a physically held control. `reset()` also clears held state.
If an endpoint has physically vanished, final Note Off delivery cannot be
guaranteed; expose a Panic option at the receiver too.

`encodeLights()` emits one 80-byte 0x80 report for Pads, the 39 lighted buttons,
and the 25 Strip segments. Profiles may set Pad on/off colors, per-Pad idle
brightness, shared Pad pressed brightness, shared button idle/pressed brightness,
and Strip Dot/Bar/Pan behavior and palette color independently for
each mode. Existing Strip settings without a color default to White (palette index 17).

See the repository's `docs/devices/mikro-mk3/protocol.md` and `test/fixtures/mikro-vectors.json` for
language-independent byte conventions and firmware porting vectors. TypeScript
itself is not a guarantee of MCU compatibility; firmware needs USB Host HID,
power management and its own USB/BLE/network MIDI adapter.
