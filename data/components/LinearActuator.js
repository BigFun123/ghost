// Illustrative rail with attached stepper. Local +X is carriage travel in mm.
function linearActuatorState(node) {
  const lengthMm = node.lengthMm ?? 300, positionMm = node.positionMm ?? 0;
  if (!Number.isFinite(lengthMm) || lengthMm < 1 || lengthMm > 2000 ||
      !Number.isFinite(positionMm) || positionMm < 0 || positionMm > lengthMm) {
    throw new Error("Linear actuator requires 1-2000 mm travel and a position within that travel.");
  }
  return { lengthMm, positionMm };
}

function createLinearActuatorPanel({ node, change, openSettings = () => {}, mixer = { hasSolo: () => false, changed() {} } }) {
  const make = (tag, className = "", text = "") => {
    const element = document.createElement(tag);
    element.className = className; element.textContent = text; return element;
  };
  const element = make("section"), heading = make("h2");
  const description = make("span", "channel-number", "rail");
  const fader = make("label", "fader-with-scale linear-position-fader", "Position (mm)");
  const vertical = make("div", "vertical-control"), slider = make("input"), output = make("output");
  slider.type = "range"; slider.min = "0"; slider.step = "0.1";
  slider.setAttribute("aria-label", "Linear actuator position in millimetres");
  slider.setAttribute("aria-orientation", "vertical");
  vertical.append(slider); fader.append(vertical, output);
  element.append(description, heading, fader);
  const control = { outputEnabled: true, muted: false, solo: false, reversed: false, mode: "smooth", speed: "M" };
  let frame = 0, motion = null;
  const allowed = () => control.outputEnabled && !control.muted && (!mixer.hasSolo() || control.solo);
  const stop = () => { if (frame) cancelAnimationFrame(frame); frame = 0; motion = null; };
  const refresh = () => { mixer.changed(); change(); };
  const buttons = make("div", "channel-buttons");
  const button = (text, className, title, action) => {
    const button = make("button", "mix-button " + className, text);
    button.type = "button"; button.title = title; button.setAttribute("aria-label", title);
    button.addEventListener("click", action); buttons.append(button); return button;
  };
  const mute = button("MUTE", "", "Mute linear actuator", () => { control.muted = !control.muted; stop(); refresh(); });
  const solo = button("SOLO", "solo", "Solo linear actuator", () => { control.solo = !control.solo; stop(); refresh(); });
  const mode = button("-", "motion-mode", "Motion mode", () => {
    stop(); control.mode = control.mode === "immediate" ? "smooth" : control.mode === "smooth" ? "linear" : "immediate"; refresh();
  });
  const speed = button("M", "motion-speed", "Motion speed", () => {
    stop(); control.speed = control.speed === "L" ? "M" : control.speed === "M" ? "H" : "L"; refresh();
  });
  const reverse = button("REV", "reverse-button", "Reverse slider direction", () => { control.reversed = !control.reversed; refresh(); });
  const power = button("\u23fb", "servo-power", "Switch actuator power", () => { control.outputEnabled = !control.outputEnabled; stop(); refresh(); });
  const move = (target, options = {}) => {
    stop();
    if (!allowed()) { change(); return; }
    target = Math.max(0, Math.min(node.lengthMm ?? 300, target));
    if (control.mode === "immediate" && !options.startup) { node.positionMm = target; change(); return; }
    motion = { from: node.positionMm ?? 0, target, start: performance.now(),
      duration: Math.max(1, (control.mode === "linear" && options.durationMs ? options.durationMs :
        Math.abs(target - (node.positionMm ?? 0)) / ({ L: 25, M: 75, H: 150 }[control.speed]) * 1000) / (options.playbackRate ?? 1)) };
    const tick = now => {
      frame = 0;
      if (!motion || !allowed()) { stop(); return; }
      const progress = Math.min(1, Math.max(0, (now - motion.start) / motion.duration));
      const eased = control.mode === "smooth" ? progress * progress * (3 - 2 * progress) : progress;
      node.positionMm = motion.from + (motion.target - motion.from) * eased;
      if (progress === 1) motion = null;
      change();
      if (motion) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
  };
  const clear = make("button", "mix-button servo-center", "C");
  clear.type = "button"; clear.title = "Clear position to 0 mm"; clear.setAttribute("aria-label", clear.title);
  clear.addEventListener("click", () => move(0));
  element.append(clear, buttons);
  const settings = make("button", "servo-settings-button", "\u2699");
  settings.type = "button"; settings.title = "Component setup";
  settings.setAttribute("aria-label", "Linear actuator settings");
  settings.addEventListener("click", openSettings); element.append(settings);
  slider.addEventListener("input", () => { const value = Number(slider.value); if (Number.isFinite(value)) move(value); });
  return { element, control, dispose: stop, stopSequence: stop,
    resetMotionMode() { stop(); control.mode = "smooth"; },
    motionEnd: () => motion ? motion.start + motion.duration : 0,
    playSequenceState(state, options) { linearActuatorState({ ...node, ...state }); move(state.positionMm, options); },
    setPower(enabled) { control.outputEnabled = enabled; stop(); }, update({ node }) {
    const state = linearActuatorState(node);
    if (motion && (motion.target > state.lengthMm || !allowed())) stop();
    heading.textContent = "Linear";
    heading.title = node.name;
    element.classList?.toggle("reversed", control.reversed);
    slider.max = state.lengthMm; slider.value = motion?.target ?? state.positionMm;
    slider.disabled = !allowed(); clear.disabled = !allowed();
    output.textContent = state.positionMm.toFixed(1) + " mm";
    for (const [button, pressed] of [[mute, control.muted], [solo, control.solo], [reverse, control.reversed], [power, control.outputEnabled]]) button.setAttribute("aria-pressed", String(pressed));
    mode.textContent = { immediate: "-", smooth: "S", linear: "/" }[control.mode];
    mode.setAttribute("aria-pressed", String(control.mode !== "immediate"));
    mode.title = "Motion mode: " + control.mode;
    speed.textContent = control.speed;
    speed.title = "Linear speed: " + { L: 25, M: 75, H: 150 }[control.speed] + " mm/s";
  } };
}

function renderLinearActuatorSettings({ node, host, editing, change }) {
  const group = document.createElement("fieldset"), legend = document.createElement("legend");
  legend.textContent = "Linear actuator";
  const label = document.createElement("label"), length = document.createElement("input");
  label.textContent = "Travel length (mm)";
  length.type = "number"; length.min = "1"; length.max = "2000"; length.step = "any";
  length.value = node.lengthMm ?? 300; length.disabled = !editing;
  length.addEventListener("change", () => {
    if (!editing) return;
    const value = String(length.value).trim() === "" ? NaN : Number(length.value);
    if (!Number.isFinite(value) || value < 1 || value > 2000) { length.value = node.lengthMm ?? 300; return; }
    node.lengthMm = value; node.positionMm = Math.min(node.positionMm ?? 0, value); change();
  });
  label.append(length); group.append(legend, label); host.append(group);
}

componentRegistry.register({
  group: "Linear motion", objectType: "Stepper Linear Actuator", order: 25,
  defaults: { lengthMm: 300, positionMm: 0 }, panelLocations: ["mixer"],
  numericSettings: { lengthMm: { min: 1, max: 2000, default: 300 }, positionMm: { min: 0, max: 2000, default: 0, maxField: "lengthMm" } },
  validate: linearActuatorState,
  captureSequenceState(node) { return { positionMm: linearActuatorState(node).positionMm }; },
  childMountOffset(node) { return [linearActuatorState(node).positionMm, 27.5, 0]; },
  getPhysics(node) { return { massGrams: 300 + linearActuatorState(node).lengthMm * 1.2, real: true }; },
  getPower() { return { min: 0, max: 24 }; }, // Provisional motor/driver estimate.
  createPanel: createLinearActuatorPanel, renderSettings: renderLinearActuatorSettings,
  draw({ node, box, label }) {
    const { lengthMm, positionMm } = linearActuatorState(node);
    box([lengthMm / 2, 0, 0], [lengthMm + 50, 10, 15], "#a5afb8", false);
    for (let x = 0; x <= lengthMm; x += 50) box([x, 5.2, 0], [5, 0.5, 5], "#303840", false);
    box([lengthMm / 2, 15, 0], [lengthMm + 50, 4, 4], "#b9b5a0", false);
    box([positionMm, 15, 0], [40, 20, 32], "#3c4249", false);
    box([positionMm, 26, 0], [36, 3, 30], "#bdc5cb", false);
    for (const x of [-21, 21]) box([positionMm + x, 15, 0], [3, 20, 32], "#32846b", false);
    box([-49, 0, 0], [42, 42, 42], "#30363e", false);
    box([-26, 0, 0], [4, 42, 42], "#a5afb8", false);
    label([lengthMm / 2, 44, 0]);
  }
});
