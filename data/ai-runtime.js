// TensorFlow.js runtime for simulation learning; no controller commands.
(function (scope) {
  const version = "4.22.0";
  let loading;
  function load() {
    if (!loading) loading = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "./vendor/tensorflow-4.22.0/tf.min.js";
      const timer = setTimeout(() => fail("TensorFlow.js load timed out. Check the local development server."), 30000);
      function fail(message) {
        clearTimeout(timer); script.remove(); loading = null; reject(new Error(message));
      }
      script.onerror = () => fail("Could not load local TensorFlow.js. Run the local development server; training assets are not installed on the controller.");
      script.onload = () => {
        clearTimeout(timer);
        if (scope.tf?.version?.tfjs !== version) return fail("Unexpected TensorFlow.js version; expected " + version + ".");
        resolve(scope.tf);
      };
      document.head.append(script);
    });
    return loading;
  }
  async function smokeTest(tf) {
    const tensorsBefore = tf.memory().numTensors;
    const model = tf.sequential();
    let optimizer, xs, ys;
    try {
      model.add(tf.layers.dense({ units: 1, inputShape: [1], kernelInitializer: "zeros", biasInitializer: "zeros" }));
      optimizer = tf.train.sgd(0.1);
      xs = tf.tensor2d([[1], [2]]); ys = tf.tensor2d([[2], [4]]);
      const loss = () => model.predict(xs).sub(ys).square().mean();
      const measure = () => tf.tidy(() => loss().dataSync()[0]);
      const before = measure();
      for (let i = 0; i < 20; i++) {
        tf.tidy(() => optimizer.minimize(loss, false, model.trainableWeights.map(weight => weight.val)));
        if (i % 5 === 4) await tf.nextFrame();
      }
      const after = measure();
      if (!Number.isFinite(after) || !(after < before)) throw new Error("Training smoke check did not reduce the loss.");
      return { before, after, tensorsBefore };
    } finally {
      xs?.dispose(); ys?.dispose(); optimizer?.dispose(); model.dispose();
      if (tf.memory().numTensors !== tensorsBefore) throw new Error("Training smoke check leaked tensors.");
    }
  }
  async function initialize(log = () => {}, preference = "auto") {
    const tf = await load();
    const candidates = preference === "auto" ? ["webgl", "cpu"] : [preference];
    if (!candidates.every(backend => ["webgl", "cpu"].includes(backend))) throw new Error("Unsupported training backend.");
    for (const backend of candidates) {
      try {
        if (!await tf.setBackend(backend)) throw new Error("Backend could not initialize.");
        await tf.ready();
        const started = performance.now();
        // Repeat the check to detect persistent tensor growth, not just one successful update.
        let result;
        for (let i = 0; i < 3; i++) result = await smokeTest(tf);
        log("TensorFlow.js " + version + " / " + tf.getBackend() + ": prediction and 60 gradient updates passed (" + Math.round(performance.now() - started) + " ms).");
        log("Smoke loss: " + result.before.toFixed(4) + " -> " + result.after.toFixed(4) + "; tensor count returned to " + result.tensorsBefore + " after every check.");
        if (backend === "cpu") log("CPU backend selected. Robot training may be slow; compare with WebGL on this machine.");
        return { version, backend: tf.getBackend() };
      } catch (error) {
        log(backend + " check failed: " + error.message);
        if (backend === candidates[candidates.length - 1]) throw error;
        log("Trying CPU fallback.");
      }
    }
  }
  scope.GhostTensorFlow = { load, initialize, smokeTest };
  if (typeof module !== "undefined" && module.exports) module.exports = scope.GhostTensorFlow;
})(globalThis);
