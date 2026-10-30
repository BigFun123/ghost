const vl53l0xScans = new WeakMap();
function vl53l0xDistance(node, sensor, telemetryAgeMs) {
  if (!sensor?.ready || !sensor.valid || !(telemetryAgeMs <= 3000) ||
      !Number.isFinite(sensor.distanceMm) || sensor.distanceMm < 0) return null;
  return sensor.distanceMm * (node.distanceMultiplier ?? 1);
}

function renderVL53L0XSettings({ node, host, editing, change }) {
  const group = document.createElement("div");
  group.className = "setup-transform-group";
  const label = document.createElement("label");
  label.textContent = "Distance multiplier";
  const input = document.createElement("input");
  input.type = "number"; input.min = "0.001"; input.max = "1000"; input.step = "any";
  input.value = node.distanceMultiplier ?? 1; input.disabled = !editing;
  input.addEventListener("input", () => input.setCustomValidity(""));
  input.addEventListener("change", () => {
    const multiplier = Number(input.value);
    if (!input.value.trim() || !Number.isFinite(multiplier) || multiplier < 0.001 || multiplier > 1000) {
      input.setCustomValidity("Enter a multiplier from 0.001 to 1000.");
      input.reportValidity(); return;
    }
    node.distanceMultiplier = multiplier;
    // Existing captured points used the previous calibration.
    const scan = vl53l0xScan(node);
    scan.points.length = 0;
    change();
  });
  const hint = document.createElement("small");
  hint.textContent = "Live distance = sensor reading × multiplier. Use known distance ÷ sensor reading to calibrate. Default: 1. Clears captured points; Save robot to keep.";
  label.append(input); group.append(label, hint); host.append(group);
}

function vl53l0xScan(node) {
  if (!vl53l0xScans.has(node)) vl53l0xScans.set(node, { drawing: false, points: [], lastAt: -Infinity, lastSensor: null });
  return vl53l0xScans.get(node);
}

// Stylized breakout; illustrative dimensions, not a mounting template.
// Local +Z faces outward through the optical package.
function drawVL53L0X({ box, label }) {
  box([0, 0, 0], [13, 18, 1.6], "#356fa3", false);
  box([0, 2, 1.8], [5, 3, 2], "#262b31", false);
  box([-1.2, 2, 2.9], [1.2, 1.5, 0.2], "#ae5b91", false);
  box([1.2, 2, 2.9], [1.2, 1.5, 0.2], "#556477", false);
  for (let pin = 0; pin < 6; pin++) {
    box([-5 + pin * 2, -6, 1.2], [1, 2, 1], "#d4b66d", false);
  }
  label([0, 14, 0]);
}

function drawVL53L0XOverlay({ ctx, nodes, surfaces, project, line, worldPoint, measureSensor, index, offline, sensors, telemetryAgeMs }) {
  const scan = vl53l0xScans.get(nodes[index]);
  if (scan) {
    ctx.save(); ctx.fillStyle = "#5ce0b0";
    for (const point of scan.points) {
      const screen = project(point);
      if (!screen.every(Number.isFinite)) continue;
      ctx.beginPath(); ctx.arc(screen[0], screen[1], 2, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }
  const sensor = sensors?.vl53l0x;
  const measured = vl53l0xDistance(nodes[index], sensor, telemetryAgeMs);
  const liveValid = measured !== null;
  const reading = offline ? measureSensor(index) : {
    ...GhostSensor.sensorRay(nodes, index, worldPoint),
    distanceMm: measured
  };
  if (!reading.origin || !reading.direction) return;
  const { origin, direction, distanceMm: distance } = reading;
  const end = origin.map((value, axis) => value + direction[axis] * (distance ?? 2000));
  ctx.save();
  ctx.setLineDash([2, 5]); ctx.lineCap = "round";
  if (offline || liveValid) line(origin, end, "#ffdc83", 1.5);
  ctx.setLineDash([]);
  const hit = project(end);
  if (distance !== null && hit.every(Number.isFinite)) {
    ctx.beginPath(); ctx.arc(hit[0], hit[1], 3, 0, Math.PI * 2);
    ctx.fillStyle = "#ffdc83"; ctx.fill();
  }
  const anchor = project(origin);
  if (anchor.every(Number.isFinite)) {
    const text = offline ? (distance === null ? "\u221e" : distance.toFixed(1) + " mm (sim)") :
      liveValid ? distance.toFixed(1) + " mm (VL53L0X)" :
      !sensor ? "Waiting for sensor" : !sensor.ready ? "Sensor unavailable" :
      telemetryAgeMs > 3000 ? "Stale reading" : "Invalid reading";
    ctx.font = "12px system-ui"; ctx.textAlign = "left"; ctx.textBaseline = "bottom";
    ctx.lineWidth = 4; ctx.strokeStyle = "#0d1822"; ctx.fillStyle = "#ffdc83";
    ctx.strokeText(text, anchor[0] + 10, anchor[1] - 10);
    ctx.fillText(text, anchor[0] + 10, anchor[1] - 10);
  }
  ctx.restore();
}

componentRegistry.register({
  defaults: { distanceMultiplier: 1 },
  numericSettings: { distanceMultiplier: { min: 0.001, max: 1000, default: 1 } },
  renderSettings: renderVL53L0XSettings,
  // A sensor parented directly to a servo rides its moving side.
  parentSide({ parent, nodes, registry }) {
    return registry.attachment(nodes, nodes.indexOf(parent)).fixedSide === "shaft" ? "body" : "shaft";
  },
  // Estimated model mass in grams; individual components can override it.
  getPhysics() { return { massGrams: 2, real: true }; },
  // Provisional watts; replace with measured or datasheet values.
  getPower() { return { min: 0.1, max: 1 }; },
  createPanel: createVL53L0XPanel, panelLocations: ["mixer"],
  group: "Sensors", objectType: "VL53L0X V2 Time of Flight Sensor", order: 60, draw: drawVL53L0X, drawOverlay: drawVL53L0XOverlay });


function createVL53L0XPanel({ openSettings } = {}) {
  const element = document.createElement("section");
  const category = document.createElement("span");
  category.className = "channel-number"; category.textContent = "Distance";
  const heading = document.createElement("h2");
  const value = document.createElement("output");
  value.className = "distance-reading";
  const caption = document.createElement("small");
  const draw = document.createElement("button"), clear = document.createElement("button");
  draw.type = clear.type = "button";
  draw.className = "mix-button distance-draw";
  clear.className = "servo-settings-button distance-clear";
  draw.title = "Start or pause capturing distance points";
  clear.title = "Clear captured distance points";
  clear.setAttribute("aria-label", clear.title);
  draw.textContent = "Draw"; clear.textContent = "C";
  draw.setAttribute("aria-pressed", "false");
  const count = document.createElement("small");
  const config = document.createElement("button");
  config.type = "button";
  config.className = "servo-settings-button";
  config.textContent = "\u2699";
  config.title = "Configure VL53L0X";
  config.setAttribute("aria-label", config.title);
  config.addEventListener("click", () => openSettings?.());
  const power = document.createElement("button");
  power.type = "button";
  power.className = "mix-button servo-power camera-power";
  power.textContent = "\u23fb";
  let expanded = true;
  let current;
  function sync() {
    element.classList.toggle("camera-collapsed", !expanded);
    value.hidden = caption.hidden = actions.hidden = count.hidden = !expanded;
    power.setAttribute("aria-expanded", String(expanded));
    power.setAttribute("aria-pressed", String(expanded));
    power.title = expanded ? "Collapse distance panel" : "Expand distance panel";
    power.setAttribute("aria-label", power.title);
    const scan = current && vl53l0xScan(current.node);
    draw.setAttribute("aria-pressed", String(!!scan?.drawing));
    draw.textContent = scan?.drawing ? "Draw: On" : "Draw: Off";
    count.textContent = (scan?.points.length ?? 0) + " / 2000 points";
  }
  draw.addEventListener("click", () => {
    if (!current) return;
    const scan = vl53l0xScan(current.node);
    scan.drawing = !scan.drawing;
    sync(); current.redraw?.();
  });
  clear.addEventListener("click", () => {
    if (!current) return;
    const scan = vl53l0xScan(current.node);
    scan.points.length = 0; scan.lastAt = Date.now(); scan.lastSensor = current.sensors?.vl53l0x;
    sync(); current.redraw?.();
  });
  const actions = document.createElement("div");
  actions.className = "distance-actions";
  actions.append(draw);
  power.addEventListener("click", () => {
    expanded = !expanded;
    sync(); current?.redraw?.();
  });
  element.append(category, heading, value, caption, actions, count, power, config, clear);
  sync();
  return { element, update(context) {
    current = context;
    const { node, nodes, index, surfaces, worldPoint, measureSensor, offline, sensors, telemetryAgeMs } = context;
    const scan = vl53l0xScan(node);
    sync();
    let measured = null;
    heading.textContent = "VL53L0X";
    heading.title = node.name;
    if (offline) {
      caption.textContent = "Simulated 3D distance";
      const reading = measureSensor(index);
      if (!reading.origin) { value.textContent = "Unavailable"; return; }
      const distance = reading.distanceMm;
      measured = distance;
      value.textContent = distance === null ? "No hit" : distance.toFixed(1) + " mm";
      if (reading.valid) caption.textContent = "Simulated: " + (reading.hit.name ?? (reading.hit.kind === "floor" ? "Floor" : "Scene prop"));
      else caption.textContent = "No simulated surface within 2000 mm";
    } else {
      caption.textContent = "Physical VL53L0X · I²C 0x29";
      const sensor = sensors?.vl53l0x;
      measured = vl53l0xDistance(node, sensor, telemetryAgeMs);
      value.textContent = !sensor ? "Waiting for sensor" : !sensor.ready ? "Unavailable" :
        telemetryAgeMs > 3000 ? "Stale reading" :
        measured === null ? "Invalid reading" : Number(measured.toFixed(3)) + " mm";
    }
    const now = Date.now(), sensor = sensors?.vl53l0x;
    if (scan.drawing && Number.isFinite(measured) && measured >= 0 &&
        (offline ? now - scan.lastAt >= 100 : sensor !== scan.lastSensor)) {
      const ray = GhostSensor.sensorRay(nodes, index, worldPoint);
      if (!ray) return;
      const point = ray.origin.map((value, axis) => value + ray.direction[axis] * measured);
      if (point.every(Number.isFinite)) {
        scan.points.push(point);
        if (scan.points.length > 2000) scan.points.splice(0, scan.points.length - 2000);
        scan.lastAt = now; scan.lastSensor = sensor;
        sync();
      }
    }
  } };
}
