# PersonaPlex decoder assets

These two assets are copied byte-for-byte from the official PersonaPlex browser
client from NVIDIA's `personaplex` repository
([github.com/NVIDIA/personaplex](https://github.com/NVIDIA/personaplex)) at source revision
`3428dfd95309a7f3c84fd93259ded0f810d1ff91`, paths
`client/public/assets/decoderWorker.min.js` and
`client/public/assets/decoderWorker.min.wasm`. The upstream browser client
license is MIT; see `LICENSE.personaplex`. A local source clone was used only
to verify the copy before this pack was built.

The relay's fixed upstream is `wss://inference.finite.computer/v1/realtime`;
the browser never receives its credential.

The encoder is the pinned npm package `opus-recorder@8.0.5` (integrity
`sha512-tBRXc9Btds7i3bVfA7d5rekAlyOcfsivt5vSIXHxRV1Oa+s6iXFW8omZ0Lm3ABWotVcEyKt96iIIUcgbV07YOw==`). Its full MIT, Opus BSD, and Speex BSD notices ship in
`LICENSE.opus-recorder.md`.

| file | SHA-256 | size |
| --- | --- | ---: |
| `decoderWorker.min.js` | `55b513929dc52be93042974cd0a20e71a010b7e394afed9dd3ad38fc2db2153c` | 28,541 |
| `decoderWorker.min.wasm` | `cd1d29c43b3fa05719c3d024ed9b9f1528be92415bd6d39d413b262a61d1891f` | 149,534 |
