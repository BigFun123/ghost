// Bounded live history and canvas plotting, independent of controller commands.
function createServoMetrics({ canvas, legend, read, toggle, panel, categoryButtons = [] }) {
  const windowMs = 30000, intervalMs = 100;
  const traces = new Map();
  let robot, previousAt = null;
  let sensorIds = new WeakMap();
  const selectedCategories = new Set(['rotation']);
  const categoryFor = series => series.category ??
    (/^gyro/.test(series.id) ? 'velocity' : /^rotation/.test(series.id) ? 'gyro' : /^accel/.test(series.id) ? 'motion' :
      /^(mag|heading)/.test(series.id) ? 'compass' :
      /^(pressure|altitude)/.test(series.id) ? 'barometer' :
      series.unit === '°C' ? 'temperature' : series.unit === '°' ? 'rotation' : 'motion');
  const categoryNames = { rotation: 'Rotation', gyro: 'Gyro', velocity: 'Velocity', motion: 'Motion',
    compass: 'Compass', barometer: 'Barometer', temperature: 'Temperature', power: 'Power' };
  const color = index => `hsl(${(index * 137.508 + 155) % 360} 85% 68%)`;

  function sample(now = performance.now()) {
    const state = read();
    if (state.robot !== robot) {
      traces.clear();
      sensorIds = new WeakMap();
      legend.replaceChildren();
      robot = state.robot;
      previousAt = null;
    }
    const metrics = (state.servos ?? []).map(servo => ({ ...servo, value: servo.angle, unit: '°', category: 'rotation',
      range: [0, servo.continuous ? 360 : 180], wrap: servo.continuous ? 360 : null }));
    for (const series of state.series ?? []) {
      let id = series.id;
      if (series.owner) {
        let ids = sensorIds.get(series.owner);
        if (!ids) { ids = new Map(); sensorIds.set(series.owner, ids); }
        if (!ids.has(series.id)) ids.set(series.id, {});
        id = ids.get(series.id);
      }
      const category = categoryFor(series);
      metrics.push({ ...series, id, category });
    }
    const active = new Set(metrics.map(servo => servo.id));
    for (const [id, trace] of traces) {
      if (!active.has(id)) { trace.button.remove(); traces.delete(id); }
    }
    for (const servo of metrics) {
      let trace = traces.get(servo.id);
      if (!trace) {
        const button = document.createElement('button');
        button.type = 'button';
        trace = { samples: [], visible: true, color: color(traces.size), button };
        button.style.setProperty('--trace-color', trace.color);
        button.title = 'Show or hide this component trace';
        button.addEventListener('click', () => {
          trace.visible = !trace.visible;
          button.setAttribute('aria-pressed', String(trace.visible));
          draw(performance.now());
        });
        button.setAttribute('aria-pressed', String(trace.visible));
        legend.append(button);
        traces.set(servo.id, trace);
      }
      trace.unit = servo.unit;
      trace.category = servo.category;
      trace.range = servo.range;
      trace.wrap = servo.wrap;
      trace.button.hidden = !selectedCategories.has(trace.category);
      const angle = Number.isFinite(servo.value) ? servo.value : null;
      // A suspended tab or lost status must leave a gap, not an invented move.
      if (previousAt !== null && now - previousAt > intervalMs * 5) trace.samples.push([now - 1, null]);
      trace.samples.push([now, angle]);
      while (trace.samples.length && (trace.samples[0][0] < now - windowMs || trace.samples.length > 302)) trace.samples.shift();
      const text = servo.name + ': ' + (angle === null ? '—' : angle.toFixed(servo.unit === 'hPa' || servo.unit === 'm' ? 2 : 1) + servo.unit);
      if (trace.button.textContent !== text) trace.button.textContent = text;
    }
    previousAt = now;
    draw(now);
  }

  function draw(now = performance.now()) {
    const width = canvas.clientWidth, height = canvas.clientHeight;
    if (!width || !height) return;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const pixelWidth = Math.round(width * ratio), pixelHeight = Math.round(height * ratio);
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) { canvas.width = pixelWidth; canvas.height = pixelHeight; }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, width, height);
    const groups = [];
    for (const category of selectedCategories) {
      const units = [...new Set([...traces.values()].filter(trace => trace.category === category).map(trace => trace.unit))];
      for (const unit of units) groups.push({ category, unit });
    }
    if (!groups.length) {
      ctx.fillStyle = '#97a6b4'; ctx.textAlign = 'center'; ctx.font = '12px system-ui';
      ctx.fillText(selectedCategories.size ? 'Waiting for components…' : 'Select a metric above', width / 2, height / 2);
      return;
    }
    const columns = Math.min(groups.length, Math.max(1, Math.floor(width / 280)));
    const rows = Math.ceil(groups.length / columns);
    groups.forEach(({ category, unit: selectedUnit }, index) => {
      const cellWidth = width / columns, cellHeight = height / rows;
      ctx.save();
      ctx.beginPath(); ctx.rect(index % columns * cellWidth, Math.floor(index / columns) * cellHeight, cellWidth, cellHeight); ctx.clip();
      ctx.translate(index % columns * cellWidth, Math.floor(index / columns) * cellHeight);
      const left = selectedUnit === "°" ? 42 : 76, top = 12, plotWidth = cellWidth - left - 4, plotHeight = cellHeight - top - 16;
      ctx.fillStyle = '#97a6b4'; ctx.textAlign = 'center'; ctx.font = '10px system-ui';
      ctx.fillText(categoryNames[category] + ' · ' + selectedUnit, left + plotWidth / 2, 10);
      if (plotWidth <= 0 || plotHeight <= 0) { ctx.restore(); return; }
      const visible = [...traces.values()].filter(trace => trace.visible && trace.category === category && trace.unit === selectedUnit);
      const values = visible.flatMap(trace => trace.range ?? trace.samples.filter(sample => sample[1] !== null).map(sample => sample[1]));
      const span = selectedUnit === '°' ? 180 : selectedUnit === '°/s' ? 10 : selectedUnit === 'm/s²' ? 1 : .1;
      let minimum = values.length ? Math.min(...values) : 0;
      let maximum = values.length ? Math.max(...values) : span;
      if (maximum - minimum < span) { const center = (minimum + maximum) / 2; minimum = center - span / 2; maximum = center + span / 2; }
      if (selectedUnit !== '°') { const margin = (maximum - minimum) * .1; minimum -= margin; maximum += margin; }
      if (selectedUnit === 'W') { minimum = 0; maximum = Math.max(0.1, maximum); }
      const x = time => left + (time - now + windowMs) / windowMs * plotWidth;
      const y = angle => top + (1 - (angle - minimum) / (maximum - minimum)) * plotHeight;
      ctx.font = '10px system-ui';
      ctx.lineWidth = 1;
      for (let tick = 0; tick <= 4; tick++) {
        const angle = minimum + (maximum - minimum) * tick / 4;
        ctx.strokeStyle = '#2b3945';
        ctx.beginPath(); ctx.moveTo(left, y(angle)); ctx.lineTo(left + plotWidth, y(angle)); ctx.stroke();
        ctx.fillStyle = '#97a6b4'; ctx.textAlign = 'right'; ctx.fillText(Number(angle.toFixed(2)) + selectedUnit, left - 6, y(angle) + 3);
      }
      for (let seconds = 0; seconds <= 30; seconds += 5) {
        const px = x(now - seconds * 1000);
        ctx.strokeStyle = '#22313d';
        ctx.beginPath(); ctx.moveTo(px, top); ctx.lineTo(px, top + plotHeight); ctx.stroke();
        ctx.fillStyle = '#97a6b4'; ctx.textAlign = seconds === 0 ? 'right' : seconds === 30 ? 'left' : 'center';
        ctx.fillText(seconds === 0 ? 'now' : '-' + seconds + 's', px, cellHeight - 3);
      }
      ctx.save(); ctx.beginPath(); ctx.rect(left, top, plotWidth, plotHeight); ctx.clip();
      for (const trace of traces.values()) {
        if (!trace.visible || trace.category !== category || trace.unit !== selectedUnit) continue;
        ctx.strokeStyle = trace.color; ctx.lineWidth = 1.8; ctx.beginPath();
        let connected = false, previousAngle = null;
        for (const [time, angle] of trace.samples) {
          if (angle === null) { connected = false; previousAngle = null; continue; }
          // Wrapped continuous angles should not draw a full-height diagonal.
          if (trace.wrap && previousAngle !== null && Math.abs(angle - previousAngle) > trace.wrap / 2) connected = false;
          if (connected) ctx.lineTo(x(time), y(angle)); else ctx.moveTo(x(time), y(angle));
          connected = true; previousAngle = angle;
        }
        ctx.stroke();
      }
      ctx.restore();
      ctx.restore();
    });
  }

  const categoryListeners = Array.from(categoryButtons, button => {
    const category = button.dataset.metricCategory;
    button.setAttribute('aria-pressed', String(selectedCategories.has(category)));
    const click = () => {
      if (selectedCategories.has(category)) selectedCategories.delete(category);
      else selectedCategories.add(category);
      button.setAttribute('aria-pressed', String(selectedCategories.has(category)));
      for (const trace of traces.values()) trace.button.hidden = !selectedCategories.has(trace.category);
      draw();
    };
    button.addEventListener('click', click);
    return [button, click];
  });
  const toggleVisibility = () => {
    panel.hidden = !panel.hidden;
    toggle.setAttribute('aria-expanded', String(!panel.hidden));
    document.body.classList.toggle('metrics-hidden', panel.hidden);
    if (!panel.hidden) draw();
  };
  toggle?.addEventListener('click', toggleVisibility);
  const timer = setInterval(() => { if (!document.hidden) sample(); }, intervalMs);
  const observer = new ResizeObserver(() => draw());
  observer.observe(canvas);
  sample();
  return { sample, destroy() { clearInterval(timer); observer.disconnect(); toggle?.removeEventListener('click', toggleVisibility); categoryListeners.forEach(([button, click]) => button.removeEventListener('click', click)); } };
}
