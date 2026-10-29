// Stylized GY-801 10-DOF breakout, dimensions in millimetres.
// Board outline: https://okystar.com/wp-content/uploads/2017/07/OKY3062-5.pdf
// Chip placement is illustrative; telemetry is simulated from scene transforms, not hardware readings.
// Local +Y is the component side; X/Z lie along the PCB.
function drawGY801({ box, cylinder, label }) {
  box([0, 0, 0], [25.8, 1.6, 16.8], "#266da6", false);
  // Gyroscope, accelerometer and magnetometer packages.
  box([-6.5, 1.7, 1.5], [4, 1.8, 4], "#252b32", false);
  box([0, 1.5, 2.5], [3, 1.4, 5], "#252b32", false);
  box([6, 1.5, 2], [3, 1.4, 3], "#252b32", false);
  // Metal barometer lid and pressure port.
  box([6, 1.9, -3.5], [3.6, 2.2, 3.6], "#bec6ce", false);
  cylinder([6, 3.04, -3.5], 0.45, 0.08, "#26313b", false);
  // Eight plated header pads, with short gold pins below the board.
  for (let pin = 0; pin < 8; pin++) {
    const x = (pin - 3.5) * 2.54;
    cylinder([x, 0.9, -6.4], 0.85, 0.2, "#d8b86c", false);
    box([x, -1.8, -6.4], [0.6, 3.4, 0.6], "#d8b86c", false);
  }
  for (const x of [-10.8, 10.8]) {
    cylinder([x, 0.9, 5.8], 1.8, 0.2, "#d8b86c", false);
    cylinder([x, 1.04, 5.8], 1.5, 0.08, "#172735", false);
  }
  for (const x of [-4, 2]) {
    box([x, 1.25, -2], [1.6, 0.9, 0.8], "#c9ba96", false);
    box([x, 1.15, 6], [1.6, 0.7, 0.8], "#b4bec7", false);
  }
  label([0, 9, 0]);
}

componentRegistry.register({
  // Estimated model mass in grams; individual components can override it.
  getPhysics() { return { massGrams: 5, real: true }; },
  // Provisional watts; replace with measured or datasheet values.
  getPower() { return { min: 0.1, max: 1 }; },
 
  group: "Sensors", objectType: "GY-801", label: "GY-801 · Gyro / Accelerometer / Compass / Barometer",
  order: 65, draw: drawGY801, readMetrics: readGY801Metrics
});

// Scene-derived telemetry only; no fabricated hardware measurements.
const gy801MetricHistory = new WeakMap();
function readGY801Metrics({ nodes, node, index, worldPoint, now }) {
  const origin = worldPoint(nodes, index, [0, 0, 0]);
  const axes = [0, 1, 2].map(axis => {
    const end = worldPoint(nodes, index, [0, 1, 2].map(i => i === axis ? 1 : 0));
    const vector = end.map((value, i) => value - origin[i]);
    const length = Math.hypot(...vector);
    return vector.map(value => value / length);
  });
  if (![...origin, ...axes.flat()].every(Number.isFinite)) return [];
  const dot = (a, b) => a.reduce((sum, value, i) => sum + value * b[i], 0);
  const cross = (a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
  let previous = gy801MetricHistory.get(node);
  if (previous?.source !== nodes) previous = null;
  const dt = previous ? (now - previous.at) / 1000 : 0;
  const valid = dt > 0 && dt <= 0.5;
  const velocity = valid ? origin.map((value, i) => (value - previous.origin[i]) / (1000 * dt)) : null;
  let gyro = [null, null, null], acceleration = [null, null, null];
  if (valid) {
    // Relative rotation gives angular velocity without Euler wrap spikes.
    const skew = axes.reduce((sum, axis, i) => {
      const vector = cross(previous.axes[i], axis);
      return sum.map((value, j) => value + vector[j]);
    }, [0, 0, 0]);
    const sine = Math.hypot(...skew) / 2;
    const cosine = Math.max(-1, Math.min(1, (axes.reduce((sum, axis, i) => sum + dot(previous.axes[i], axis), 0) - 1) / 2));
    if (sine > 1e-8) {
      const scale = Math.atan2(sine, cosine) / (2 * sine * dt) * 180 / Math.PI;
      const worldRate = skew.map(value => value * scale);
      gyro = axes.map(axis => dot(axis, worldRate));
    } else if (cosine > 0) gyro = [0, 0, 0];
    if (previous.velocity) {
      // Specific force: at rest an upright board reports +g on local Y.
      const worldForce = velocity.map((value, i) => (value - previous.velocity[i]) / dt + (i === 1 ? 9.80665 : 0));
      acceleration = axes.map(axis => dot(axis, worldForce));
    }
  }
  gy801MetricHistory.set(node, { source: nodes, at: now, origin, axes, velocity });
  const degrees = 180 / Math.PI;
  const orientation = [Math.atan2(axes[1][2], axes[2][2]), Math.asin(Math.max(-1, Math.min(1, -axes[0][2]))), Math.atan2(axes[0][1], axes[0][0])].map(value => value * degrees);
  const altitude = origin[1] / 1000;
  // Approximate standard atmosphere at the scene's height above Y=0.
  const pressure = altitude < 44330 ? 1013.25 * Math.pow(1 - altitude / 44330, 5.255) : null;
  // Explicit synthetic field in microtesla: north is world +Z, up is +Y.
  // This is a scene reference, not a location-dependent geomagnetic model.
  const magneticField = axes.map(axis => dot(axis, [0, -20, 40]));
  const forward = axes[2];
  const heading = Math.hypot(forward[0], forward[2]) > 1e-6
    ? (Math.atan2(forward[0], forward[2]) * degrees + 360) % 360 : null;
  const temperature = altitude < 44330 ? 15 - 0.0065 * altitude : null;
  const series = [];
  const add = (key, text, value, unit, range, wrap) => series.push({
    id: key, owner: node, name: node.name + ' ' + text + ' (sim)', value, unit, range, wrap
  });
  ['X', 'Y', 'Z'].forEach((axis, i) => {
    add('rotation' + axis, 'rotation ' + axis, orientation[i], '°', [-180, 180], 360);
    add('gyro' + axis, 'gyro ' + axis, gyro[i], '°/s');
    add('accel' + axis, 'acceleration ' + axis, acceleration[i], 'm/s²');
    add('mag' + axis, 'magnetometer ' + axis, magneticField[i], 'µT');
  });
  add('heading', 'compass heading', heading, '°', [0, 360], 360);
  add('altitude', 'altitude', altitude, 'm');
  add('pressure', 'pressure', pressure, 'hPa');
  add('temperature', 'temperature', temperature, '°C');
  return series;
}
