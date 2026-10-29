// Stylized ESP32 development board. Dimensions are illustrative, in millimetres.
function drawESP32({ box, label, state = {}, ledColor = "#" + (state.ledRgb ?? [23, 27, 32]).map(value => value.toString(16).padStart(2, "0")).join("") }) {
  box([0, 0, 0], [28, 1.6, 55], "#194b39", false);
  box([0, 2.4, 8], [18, 3.2, 22], "#b7bec4", false);
  box([0, 1.4, 23], [18, 1.2, 7], "#202a30", false);
  for (let trace = 0; trace < 5; trace++) {
    box([-6 + trace * 3, 2.1, 23], [1, 0.2, 5], "#d0b464", false);
  }
  box([0, 2.8, -24], [9, 4, 7], "#b5bec7", false);
  box([0, 2.7, -27.6], [6, 2, 0.3], "#25313b", false);
  box([0, 1.8, -7], [7, 2, 7], "#20262c", false);
  for (const x of [-11.5, 11.5]) {
    box([x, 2, 0], [3, 2.4, 43], "#242b30", false);
    for (let pin = 0; pin < 16; pin++) box([x, 3.4, -19 + pin * 2.54], [1, 0.6, 1], "#d3bb75", false);
    box([x * 0.65, 2, -17], [4, 2, 3], "#999fa5", false);
  }
  box([7, 1.2, -9], [2.4, 0.8, 2.4], "#d7d1bc", false);
  box([7, 3.6, -9], [1.6, 4, 1.6], ledColor, false);
  label([0, 8, 0]);
}

function drawESP32Overlay({ ctx, nodes, project, ratio, worldPoint, depthBuffers, state, index }) {
  const rgb = state.ledRgb;
  if (!rgb.some(value => value > 0)) return;
  const color = rgb.join(",");
  const point = project(worldPoint(nodes, index, [7, 5.65, -9]));
  if (!point.every(Number.isFinite)) return;
  const depth = depthBuffers?.get(ctx);
  const x = Math.round(point[0] * ratio), y = Math.round(point[1] * ratio);
  if (depth && (x < 0 || y < 0 || x >= ctx.canvas.width || y >= ctx.canvas.height || depth[y * ctx.canvas.width + x] > point[2] + 1)) return;
  ctx.save();
  const glow = ctx.createRadialGradient(point[0], point[1], 0, point[0], point[1], 24);
  glow.addColorStop(0, "rgba(" + color + ",1)");
  glow.addColorStop(0.25, "rgba(" + color + ",0.9)");
  glow.addColorStop(0.6, "rgba(" + color + ",0.4)");
  glow.addColorStop(1, "rgba(" + color + ",0)");
  ctx.globalCompositeOperation = "lighter";
  ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(point[0], point[1], 24, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "rgb(" + color + ")"; ctx.beginPath(); ctx.arc(point[0], point[1], 4, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#ffffff"; ctx.beginPath(); ctx.arc(point[0], point[1], 1.8, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

componentRegistry.register({
  // Estimated model mass in grams; individual components can override it.
  getPhysics() { return { massGrams: 12, real: true }; },
  capabilities: ["root"],
  // Provisional watts; replace with measured or datasheet values.
  getPower() { return { min: 0.1, max: 1 }; },
  objectType: "Robot", defaults: { shopProductId: "esp32-board" }, selectable: false, draw: drawESP32, drawOverlay: drawESP32Overlay });
