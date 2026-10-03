const setText = (id, value) => {
  const element = document.getElementById(id);
  if (element) element.textContent = value;
};
const tabs = [
  { button: document.getElementById("overviewTab"), panel: document.getElementById("overviewPanel") },
  { button: document.getElementById("mixerTab"), panel: document.getElementById("mixerPanel") }
];
const mixer = document.querySelector(".mixer");
const masterStrip = mixer.querySelector(".master-strip");
const sweepButton = document.getElementById("sweepButton");
const sweepAllButton = document.getElementById("sweepAllButton");
const centerButton = document.getElementById("centerButton");
const stopSweepButton = document.getElementById("stopSweepButton");
let servoControls = [];
let sweepRunId = 0;
let sweepRunning = false;

function selectTab(selected) {
  tabs.forEach(({ button, panel }, index) => {
    const active = index === selected;
    button.setAttribute("aria-selected", String(active));
    button.tabIndex = active ? 0 : -1;
    panel.hidden = !active;
  });
}

tabs.forEach(({ button }, index) => {
  button.addEventListener("click", () => selectTab(index));
  button.addEventListener("keydown", event => {
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      const next = (index + (event.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length;
      selectTab(next);
      tabs[next].button.focus();
    }
  });
});

function makeElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function createServoStrip(configuration, channel) {
  const strip = makeElement("section", "channel-strip");
  strip.append(makeElement("span", "channel-number", "OUTPUT " + String(channel).padStart(2, "0")));
  strip.append(makeElement("h2", "", configuration.name));
  strip.append(makeElement("div", "meter"));
  const angle = makeElement("div", "channel-readout", "0°");
  angle.id = "angle" + channel;
  strip.append(angle);

  const faderWithScale = makeElement("div", "fader-with-scale");
  const verticalControl = makeElement("div", "vertical-control");
  const slider = makeElement("input");
  slider.type = "range";
  slider.min = "0";
  slider.max = "180";
  slider.step = "1";
  slider.value = "0";
  slider.id = "servoSlider" + channel;
  slider.setAttribute("aria-label", configuration.name + " position");
  slider.setAttribute("aria-orientation", "vertical");
  verticalControl.append(slider);
  const scale = makeElement("div", "scale");
  scale.setAttribute("aria-hidden", "true");
  scale.append(makeElement("span", "", "180°"));
  scale.append(makeElement("span", "", "90°"));
  scale.append(makeElement("span", "", "0°"));
  faderWithScale.append(verticalControl, scale);
  strip.append(faderWithScale);

  const pulseReadout = makeElement("div", "pulse-readout");
  const pulse = makeElement("span", "", "—");
  pulse.id = "pulse" + channel;
  const status = makeElement("span", "", "Unavailable");
  status.id = "servoStatus" + channel;
  pulseReadout.append(pulse, document.createTextNode(" · "), status);
  strip.append(pulseReadout);

  const buttons = makeElement("div", "channel-buttons");
  const muteButton = makeElement("button", "mix-button", "M");
  muteButton.type = "button";
  muteButton.id = "mute" + channel;
  muteButton.setAttribute("aria-pressed", "false");
  const soloButton = makeElement("button", "mix-button solo", "S");
  soloButton.type = "button";
  soloButton.id = "solo" + channel;
  soloButton.setAttribute("aria-pressed", "false");
  buttons.append(muteButton, soloButton);
  strip.append(buttons);
  const error = makeElement("div", "servo-error");
  error.id = "servoMessage" + channel;
  error.setAttribute("role", "alert");
  strip.append(error);
  return { strip, slider, muteButton, soloButton, angle };
}

function isEligible(control) {
  const hasSolo = servoControls.some(candidate => candidate.solo);
  return control.ready && !control.muted && (!hasSolo || control.solo);
}

function stopSweep() {
  if (!sweepRunning) return;
  sweepRunId += 1;
  sweepRunning = false;
  sweepButton.disabled = false;
  sweepAllButton.disabled = false;
  centerButton.disabled = false;
  stopSweepButton.disabled = true;
  setText("macroStatus", "Stopped");
}

async function requestServo(control, command) {
  const response = await fetch("/api/servo", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ channel: String(control.channel), ...command })
  });
  const result = await response.text();
  if (!response.ok) throw new Error(result || "HTTP " + response.status);
}

async function sendAngle(control, angle) {
  await requestServo(control, { angle: String(angle) });
  control.slider.value = angle;
  setText("angle" + control.channel, angle + "°");
}

function scheduleCommand(control, command) {
  control.pendingCommand = command;
  if (control.timer !== null || control.inFlight) return;
  control.timer = setTimeout(sendQueuedCommand, command.angle === undefined ? 0 : 60, control);
}

async function sendQueuedCommand(control) {
  control.timer = null;
  if (control.inFlight || control.pendingCommand === null) return;
  const command = control.pendingCommand;
  control.pendingCommand = null;
  control.inFlight = true;
  try {
    await requestServo(control, command);
    setText("servoMessage" + control.channel, "");
  } catch (error) {
    setText("servoMessage" + control.channel, "failed: " + error.message);
  } finally {
    control.inFlight = false;
    if (control.pendingCommand !== null) scheduleCommand(control, control.pendingCommand);
  }
}

function syncMuteSolo() {
  servoControls.forEach(control => {
    const enabled = !control.muted &&
      (!servoControls.some(candidate => candidate.solo) || control.solo);
    scheduleCommand(control, { enabled: enabled ? "1" : "0" });
    control.muteButton.setAttribute("aria-pressed", String(control.muted));
    control.soloButton.setAttribute("aria-pressed", String(control.solo));
    control.muteButton.textContent = control.muted ? "MUTED" : "MUTE";
    control.soloButton.textContent = control.solo ? "SOLO ON" : "SOLO";
  });
}

function initializeServoControls(configurations) {
  configurations.forEach((configuration, index) => {
    const channel = index + 1;
    const ui = createServoStrip(configuration, channel);
    mixer.append(ui.strip);
    const control = {
      ...ui,
      channel,
      name: configuration.name,
      ready: false,
      pendingCommand: null,
      timer: null,
      inFlight: false,
      muted: false,
      solo: false
    };
    ui.slider.addEventListener("input", () => {
      stopSweep();
      setText("angle" + channel, ui.slider.value + "°");
      scheduleCommand(control, { angle: ui.slider.value });
    });
    ui.slider.addEventListener("change", () => {
      control.pendingCommand = { angle: ui.slider.value };
      if (control.timer !== null) {
        clearTimeout(control.timer);
        control.timer = null;
      }
      scheduleCommand(control, control.pendingCommand);
    });
    ui.muteButton.addEventListener("click", () => {
      control.muted = !control.muted;
      syncMuteSolo();
    });
    ui.soloButton.addEventListener("click", () => {
      control.solo = !control.solo;
      syncMuteSolo();
    });
    servoControls.push(control);
  });
}

async function runMacro(action) {
  if (sweepRunning) return;
  if (!servoControls.some(isEligible)) {
    setText("macroError", "No active servo is available for this macro.");
    return;
  }
  setText("macroError", "");
  sweepRunning = true;
  const runId = ++sweepRunId;
  sweepButton.disabled = true;
  sweepAllButton.disabled = true;
  centerButton.disabled = true;
  stopSweepButton.disabled = false;
  try {
    await action(runId);
    if (runId === sweepRunId) setText("macroStatus", "Complete");
  } catch (error) {
    if (runId === sweepRunId) {
      setText("macroError", "Servo macro failed: " + error.message);
      setText("macroStatus", "Error");
    }
  } finally {
    if (runId === sweepRunId) {
      sweepRunning = false;
      sweepButton.disabled = false;
      sweepAllButton.disabled = false;
      centerButton.disabled = false;
      stopSweepButton.disabled = true;
    }
  }
}

function sweepAngles() {
  const angles = [];
  for (let angle = 0; angle <= 180; angle += 10) angles.push(angle);
  for (let angle = 170; angle >= 0; angle -= 10) angles.push(angle);
  return angles;
}

sweepButton.addEventListener("click", () => runMacro(async runId => {
  for (const control of servoControls) {
    if (runId !== sweepRunId) return;
    if (!isEligible(control)) continue;
    setText("macroStatus", "Sweeping " + control.name);
    for (const angle of sweepAngles()) {
      if (runId !== sweepRunId || !isEligible(control)) break;
      await sendAngle(control, angle);
      await new Promise(resolve => setTimeout(resolve, 60));
    }
  }
}));
sweepAllButton.addEventListener("click", () => runMacro(async runId => {
  for (const angle of sweepAngles()) {
    if (runId !== sweepRunId) return;
    const eligible = servoControls.filter(isEligible);
    if (eligible.length === 0) return;
    setText("macroStatus", "Sweeping all active servos");
    await Promise.all(eligible.map(control => sendAngle(control, angle)));
    await new Promise(resolve => setTimeout(resolve, 60));
  }
}));
centerButton.addEventListener("click", () => runMacro(async runId => {
  const eligible = servoControls.filter(isEligible);
  await Promise.all(eligible.map(control => {
    if (runId !== sweepRunId) return Promise.resolve();
    return sendAngle(control, 90);
  }));
}));
stopSweepButton.addEventListener("click", stopSweep);

async function refresh() {
  try {
    const response = await fetch("/api/status", { cache: "no-store" });
    if (!response.ok) throw new Error("HTTP " + response.status);
    const status = await response.json();
    setText("connection", status.wifi.connected ? "Online" : "Wi-Fi disconnected");
    setText("chipId", status.device.chipId);
    setText("cpu", status.device.cpuMHz + " MHz");
    setText("sdk", status.device.sdk);
    setText("core", status.device.core);
    setText("resetReason", status.device.resetReason);
    setText("uptime", status.device.uptimeSeconds + " s");
    setText("heap", status.device.freeHeap + " bytes");
    setText("largestBlock", status.device.largestFreeBlock + " bytes");
    setText("fragmentation", status.device.heapFragmentation + "%");
    setText("flashSize", status.device.flashSize + " bytes");
    setText("sketchSize", status.device.sketchSize + " bytes");
    setText("otaSpace", status.device.freeOtaSpace + " bytes");
    setText("ssid", status.wifi.ssid || "—");
    setText("ip", status.wifi.ip);
    setText("rssi", status.wifi.connected ? status.wifi.rssi + " dBm" : "—");
    setText("mac", status.wifi.mac);

    for (const control of servoControls) {
      const servo = status.servos[control.channel - 1];
      if (!servo || servo.id !== control.channel) {
        control.ready = false;
        setText("servoStatus" + control.channel, "Unavailable");
        control.slider.disabled = true;
        control.muteButton.disabled = true;
        control.soloButton.disabled = true;
        continue;
      }
      control.ready = servo.ready;
      control.name = servo.name;
      setText("servoStatus" + control.channel,
        !servo.ready ? "Unavailable" : servo.enabled ? "Active" : "Muted");
      setText("angle" + control.channel, servo.ready ? servo.angleDegrees + "°" : "—");
      setText("pulse" + control.channel, servo.ready ? servo.pulseMicroseconds + " µs" : "—");
      control.slider.disabled = !servo.ready;
      control.muteButton.disabled = !servo.ready;
      control.soloButton.disabled = !servo.ready;
      if (document.activeElement !== control.slider && servo.ready) {
        control.slider.value = servo.angleDegrees;
      }
    }
    setText("updated", "Last updated: " + new Date().toLocaleTimeString());
  } catch (error) {
    setText("connection", "Status unavailable: " + error.message);
  }
}

async function refreshLog() {
  const box = document.getElementById("serialLog");
  const wasAtBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 24;
  try {
    const response = await fetch("/api/log", { cache: "no-store" });
    if (!response.ok) throw new Error("HTTP " + response.status);
    box.value = await response.text();
    if (wasAtBottom) box.scrollTop = box.scrollHeight;
  } catch (error) {
    box.value = "Unable to load serial output: " + error.message;
  }
}

async function start() {
  try {
    let response = await fetch("/config.json", { cache: "no-store" });
    if (!response.ok) {
      response = await fetch("./config.json", { cache: "no-store" });
    }
    if (!response.ok) {
      throw new Error("HTTP " + response.status);
    }
    const configuration = await response.json();
    if (!Array.isArray(configuration.servos) ||
      configuration.servos.length < 1 || configuration.servos.length > 20 ||
      configuration.servos.some(servo => typeof servo.name !== "string")) {
      throw new Error("config.json must define between 1 and 20 named servos.");
    }
    initializeServoControls(configuration.servos);
    await refresh();
    await refreshLog();
    setInterval(refresh, 1000);
    setInterval(refreshLog, 1000);
  } catch (error) {
    setText("connection", "Servo configuration unavailable: " + error.message);
    setText("macroError", error.message);
  }
}

start();
