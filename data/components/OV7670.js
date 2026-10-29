// Stylized breakout in mm; dimensions, mass, power and lens FOV are estimates.
// Local +Z points out of the lens; +Y is image up.
function drawOV7670({ box, label }) {
  box([0, 0, 0], [35, 34, 1.6], "#285e99", false);
  box([0, 0, 4], [14, 14, 7], "#20262c", false);
  box([0, 0, 9], [10, 10, 4], "#111820", false);
  box([0, 0, 11.2], [7, 7, 0.4], "#476b81", false);
  for (let pin = 0; pin < 9; pin++) for (const y of [-12, -14.54]) {
    box([(pin - 4) * 2.54, y, -3], [0.7, 0.7, 5], "#d3bb75", false);
  }
  label([0, 24, 0]);
}

componentRegistry.register({
  group: "Cameras", objectType: "OV7670 VGA Camera Module", order: 62,
  getPhysics() { return { massGrams: 6, real: true }; },
  getPower() { return { min: 0.02, max: 0.2 }; },
  getCamera() { return { origin: [0, 0, 12], verticalFov: 50, near: 1 }; },
  createPanel({ createCameraPanel, location, node, openSettings }) {
    return createCameraPanel({ kind: "camera", model: "OV7670", location, node, openSettings });
  },
  draw: drawOV7670
});
