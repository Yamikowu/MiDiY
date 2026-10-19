# @mpa/mikro-core

Portable Mikro MK3 HID decoder, MIDI mapping engine, profile validation and Pad
LED encoder. ESM + TypeScript declarations; no DOM, navigator, clock or storage
dependency. Build with `npm run build:core` from the MPA root. Reuse the package
directory as a local npm dependency; `npm pack --workspace @mpa/mikro-core` produces
a distributable package after building. This package and its adapted protocol
code are MIT licensed; include LICENSE when redistributing or porting.

```ts
import { InputDecoder, MappingEngine, createDefaultProfile, encodePadLights }
  from '@mpa/mikro-core';

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
wrap). Strip exposes its raw byte; its CC mapper ignores zero like the Rust driver
and uses configurable raw endpoints. These are not inferred touch gestures.

`Profile` has schema `mpa-profile-v1`, name, initialModeId, and modes containing
stable ControlId bindings and 16 physical Pad 1–16 light settings. Channels are
1–16, Note/CC/Program values are 0–127. Bindings are discriminated unions exported
in the declarations: none, note, cc (momentary/toggle/encoder/strip), program,
mode. `parseProfile(unknown)` validates before use and returns a detached copy.
Port identifiers, browser objects and application callbacks do not belong here.

`MappingEngine.process()` returns MIDI byte arrays and a modeChanged flag. Pad
PressOn/NoteOn pairs are deduplicated; aftertouch remains decoded but does not
generate MIDI in v1. Notes shared by multiple held controls remain on until the
last owner releases. `switchMode()` and `reconfigure()` release sounding notes
without re-triggering a physically held control. `reset()` also clears held state.
If an endpoint has physically vanished, final Note Off delivery cannot be
guaranteed; expose a Panic option at the receiver too.

See the repository's `docs/protocol.md` and `test/fixtures/mikro-vectors.json` for
language-independent byte conventions and firmware porting vectors. TypeScript
itself is not a guarantee of MCU compatibility; firmware needs USB Host HID,
power management and its own USB/BLE/network MIDI adapter.
