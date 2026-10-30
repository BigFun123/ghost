# TensorFlow.js 4.22.0

Pinned browser bundle for AI Learning, loaded only on initialization.

- Bundle source: https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0/dist/tf.min.js
- Upstream release: https://github.com/tensorflow/tfjs/releases/tag/tfjs-v4.22.0
- License: Apache-2.0; upstream LICENSE is included alongside the bundle.
- License source: https://raw.githubusercontent.com/tensorflow/tfjs/tfjs-v4.22.0/LICENSE
- Bundle SHA-256: 300dfae273d20b4046f46a06d735688f03675a807561e9bcb5f664eb2f3d2831

The local server exposes this file at /vendor/tensorflow-4.22.0/tf.min.js.
Keeping it outside data/ excludes it from PlatformIO filesystem images.
No network request is needed at runtime. The upstream minified bundle refers
to an optional source map, which is not included.
