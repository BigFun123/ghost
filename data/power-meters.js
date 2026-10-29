// Motion-based estimates: configured watt ranges are calibration, not telemetry.
function componentPowerRange(component) {
  if (component && typeof componentRegistry !== 'undefined') return componentRegistry.getPower(component);
  if (!component || !Number.isFinite(component.minPowerWatts) || !Number.isFinite(component.maxPowerWatts) ||
      component.minPowerWatts < 0 || component.maxPowerWatts < component.minPowerWatts) return null;
  return { min: component.minPowerWatts, max: component.maxPowerWatts, source: 'config' };
}

function estimateServoPowerDemand(state, now, previous) {
  if (!state.ready || !state.powered) return { at: now, angle: state.angle, activity: 0, percent: 0 };
  let speed = 0;
  if (state.continuous) {
    speed = Math.abs(state.angle - 90) / 90 * 180;
  } else if (state.motion && state.motion.duration > 0) {
    const motion = state.motion;
    const t = (now - motion.at) / motion.duration;
    if (t >= 0 && t < 1) {
      speed = Math.abs(motion.target - motion.start) * 1000 / motion.duration;
      if (motion.smooth) speed *= 6 * t * (1 - t);
    }
  } else if (previous && now > previous.at && now - previous.at <= 500) {
    speed = Math.abs(state.angle - previous.angle) * 1000 / (now - previous.at);
  }
  const elapsed = previous ? Math.max(0, now - previous.at) : 0;
  const decay = previous ? previous.activity * Math.exp(-elapsed / 150) : 0;
  const activity = Math.max(decay, Math.min(1, speed / 180));
  return { at: now, angle: state.angle, activity, percent: 10 + 90 * activity };
}

function createServoPowerMeters({ master, read, readComponents = () => [] }) {
  const initialized = new WeakSet();
  const estimates = new WeakMap();
  let series = [];
  function metric(component, power, range) {
    return { owner: component, id: 'power', category: 'power', unit: 'W',
      name: component.name + ' power (' + (range?.source === 'model' ? 'model estimate' : 'estimated') + ')',
      value: power, range: range ? [0, range.max] : undefined };
  }
  function draw(meter, percent, label, available = true, watts = null, modelDefaults = 0, peakWatts = null) {
    if (!meter) return;
    if (!initialized.has(meter)) {
      meter.replaceChildren();
      meter.removeAttribute('aria-hidden');
      meter.setAttribute('role', 'meter');
      meter.setAttribute('aria-valuemin', '0');
      meter.setAttribute('aria-valuemax', '100');
      for (let i = 0; i < 10; i++) {
        const segment = document.createElement('span');
        segment.className = 'meter-segment ' + (i >= 8 ? 'meter-high' : i >= 6 ? 'meter-medium' : 'meter-low');
        segment.setAttribute('aria-hidden', 'true');
        meter.append(segment);
      }
      initialized.add(meter);
    }
    const value = Math.round(Math.max(0, Math.min(100, percent)));
    const lit = value > 0 ? Math.ceil(value / 10) : 0;
    Array.from(meter.children).forEach((segment, index) => segment.classList.toggle('lit', index < lit));
    meter.setAttribute('aria-label', label);
    meter.setAttribute('aria-valuenow', String(value));
    const reading = watts === null ? value + '% relative demand (not calibrated)' : watts.toFixed(2) + ' W estimated';
    const defaults = modelDefaults ? ' Using provisional model defaults for ' + modelDefaults + ' component(s).' : '';
    meter.setAttribute('aria-valuetext', available ? reading + defaults : 'Unavailable');
    meter.title = label + ': ' + (available ? reading : 'unavailable') + '.' + defaults +
      ' Segments use the normal-running power scale.' + (peakWatts === null ? '' : ' Configured peak: ' + peakWatts.toFixed(2) + ' W.') +
      ' Based on configured ranges and motion, not measured power; load and stalls are not measured. Controller/sensors use their configured minimum.';
  }
  function update(now = performance.now()) {
    let total = 0, available = false, watts = 0, maximum = 0, peakMaximum = 0, calibrated = 0, modelDefaults = 0;
    const channels = read();
    const nextSeries = [];
    for (const state of channels) {
      const estimate = estimateServoPowerDemand(state, now, estimates.get(state.control));
      estimates.set(state.control, estimate);
      total += estimate.percent;
      available ||= state.ready;
      const range = componentPowerRange(state.component ?? state);
      const power = range ? (state.ready && state.powered ? range.min + ((range.running ?? range.max) - range.min) * estimate.activity : 0) : null;
      nextSeries.push(metric(state.component ?? state.control, state.ready ? power : null, range));
      const runningMaximum = range ? (range.running ?? range.max) : 0;
      if (range) { watts += power; maximum += runningMaximum; peakMaximum += range.max; calibrated++; }
      if (range?.source === 'model') modelDefaults++;
      const percent = range ? (runningMaximum > 0 ? power / runningMaximum * 100 : 0) : estimate.percent;
      draw(state.control.meter, percent, state.control.name + ' estimated power demand', state.ready, power, range?.source === 'model' ? 1 : 0, range?.max ?? null);
    }
    for (const component of readComponents()) {
      if ((component.objectType ?? 'Servo') === 'Servo') continue;
      const range = componentPowerRange(component);
      nextSeries.push(metric(component, range && available ? (component.enabled !== false ? range.min : 0) : null, range));
      if (!range) continue;
      if (range.source === 'model' && range.max > 0) modelDefaults++;
      calibrated++;
      maximum += range.max;
      peakMaximum += range.max;
      if (available && component.enabled !== false) watts += range.min;
    }
    const percent = calibrated ? (maximum > 0 ? watts / maximum * 100 : 0) : (channels.length ? total / channels.length : 0);
    draw(master, percent, 'System estimated power demand', available, calibrated ? watts : null, modelDefaults, calibrated ? peakMaximum : null);
    series = nextSeries;
  }
  const timer = setInterval(() => { if (!document.hidden) update(); }, 100);
  update();
  return { update, readMetrics() { return series; }, destroy() { clearInterval(timer); } };
}
