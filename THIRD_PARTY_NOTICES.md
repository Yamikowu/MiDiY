# Third-party notices

MiDiY's Mikro MK3 report decoding and LED encoding are adapted from
[r00tman/maschine-mikro-mk3-driver](https://github.com/r00tman/maschine-mikro-mk3-driver),
revision `30f9b6013f3559dc1774d3ddb82affabd376692a` (version 0.2.0).

Adapted sources: `crates/driver/src/main.rs`,
`crates/maschine_library/src/controls.rs`, and `lights.rs`.
`screen.rs` is documented as a future implementation reference only.
MiDiY does not include the original Rust MIDI backends or dependencies.

The full MIT license is distributed in `packages/mikro-core/LICENSE` and must
accompany copies or substantial portions of the adapted code, including future
firmware ports. This notice does not assign a license to the rest of MiDiY.

MIT License

Copyright (c) 2025 r00tman

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
