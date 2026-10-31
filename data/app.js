const setText = (id, value) => {
  const element = document.getElementById(id);
  if (element) element.textContent = value;
};
const formatMegabytes = bytes => (bytes / 1000000).toFixed(3) + " MB";
const webcamToggle = document.getElementById("webcamToggle");
const webcamVideo = document.getElementById("webcamVideo");
let webcamStream = null;
let webcamRequestId = 0;
let selectedWebcamDevice = "";
let savedWebcamControls = {};

function stopWebcam() {
  webcamRequestId++;
  const stream = webcamStream;
  webcamStream = null;
  if (stream) stream.getTracks().forEach(track => track.stop());
  webcamVideo.srcObject = null;
  webcamVideo.hidden = true;
  webcamToggle.setAttribute("aria-pressed", "false");
  webcamToggle.textContent = "Activate webcam";
  setText("webcamStatus", "Webcam off");
  if (previewReady) drawServoPreview();
  refreshSetupWebcamControls();
}

async function startWebcam(deviceId = selectedWebcamDevice) {
  if (webcamStream) stopWebcam();
  if (deviceId !== selectedWebcamDevice) savedWebcamControls = {};
  selectedWebcamDevice = deviceId;
  const requestId = ++webcamRequestId;
  webcamToggle.disabled = true;
  refreshSetupWebcamControls();
  setText("webcamStatus", "Requesting webcam access…");
  try {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error(window.isSecureContext
        ? "This browser does not support webcam access."
        : "Webcam access requires HTTPS or localhost. Open the local devserver on localhost to use it.");
    }
    if (!previewReady) throw new Error("The 3D view must finish loading before activating the webcam.");
    const stream = await navigator.mediaDevices.getUserMedia({ video: deviceId ? { deviceId: { exact: deviceId } } : true, audio: false });
    if (requestId !== webcamRequestId) { stream.getTracks().forEach(track => track.stop()); return; }
    webcamStream = stream;
    let controlsWarning = "";
    try {
      const { width, height, frameRate, ...advanced } = savedWebcamControls;
      const constraints = {};
      for (const [key, value] of Object.entries({ width, height, frameRate })) {
        if (value !== undefined) constraints[key] = { ideal: value };
      }
      if (Object.keys(advanced).length) constraints.advanced = [advanced];
      if (Object.keys(constraints).length) await stream.getVideoTracks()[0].applyConstraints(constraints);
    } catch (error) { controlsWarning = "; saved controls unavailable: " + error.message; }
    if (requestId !== webcamRequestId) return;
    stream.getVideoTracks().forEach(track => track.addEventListener("ended", () => {
      if (webcamStream === stream) stopWebcam();
    }));
    webcamVideo.srcObject = stream;
    await webcamVideo.play();
    if (requestId !== webcamRequestId) return;
    webcamVideo.hidden = false;
    if (!servoPreview.active) document.getElementById("previewToggle").click();
    webcamToggle.setAttribute("aria-pressed", "true");
    webcamToggle.textContent = "Deactivate webcam";
    setText("webcamStatus", "Webcam active" + controlsWarning);
    drawServoPreview();
  } catch (error) {
    if (requestId !== webcamRequestId) return;
    stopWebcam();
    setText("webcamStatus", "Webcam: " + error.message);
  } finally {
    webcamToggle.disabled = false;
    refreshSetupWebcamControls();
  }
}
webcamToggle.addEventListener("click", () => webcamStream ? stopWebcam() : startWebcam());
window.addEventListener("pagehide", stopWebcam);
navigator.mediaDevices?.addEventListener?.("devicechange", () => refreshSetupWebcamControls());

const tabs = [
  { button: document.getElementById("overviewTab"), panel: document.getElementById("overviewPanel") },
  { button: document.getElementById("mixerTab"), panel: document.getElementById("mixerPanel") },
  { button: document.getElementById("servoSettingsTab"), panel: document.getElementById("servoSettingsPanel") },
  { button: document.getElementById("setupTab"), panel: document.getElementById("setupPanel") },
  { button: document.getElementById("title"), panel: document.getElementById("aboutPanel") },
  { button: document.getElementById("shopTab"), panel: document.getElementById("shopPanel") },
  { button: document.getElementById("apiTab"), panel: document.getElementById("apiPanel") },
  { button: document.getElementById("aiLearningTab"), panel: document.getElementById("aiLearningPanel") },
  { button: document.getElementById("helpTab"), panel: document.getElementById("helpPanel") }
];
var previewReady = false;
const mixer = document.querySelector(".mixer");
const masterStrip = mixer.querySelector(".master-strip");
const sequencerToggle = document.getElementById("sequencerToggle");
const sequencerPanel = document.getElementById("sequencerPanel");
sequencerToggle.addEventListener("click", () => {
  sequencerPanel.hidden = !sequencerPanel.hidden;
  sequencerToggle.setAttribute("aria-expanded", String(!sequencerPanel.hidden));
});
const sweepButton = document.getElementById("sweepButton");
const sweepAllButton = document.getElementById("sweepAllButton");
const centerButton = document.getElementById("centerButton");
const allServosOffButton = document.getElementById("allServosOffButton");
const stopSweepButton = document.getElementById("stopSweepButton");
const stepDurationInput = document.getElementById("stepDuration");
const sequenceFinishButton = document.getElementById("sequenceFinish");
const playbackRateInput = document.getElementById("playbackRate");
const writeStepButton = document.getElementById("writeStepButton");
const playSequenceButton = document.getElementById("playSequenceButton");
const stopSequenceButton = document.getElementById("stopSequenceButton");
const clearSequenceButton = document.getElementById("clearSequenceButton");
const sequencerSteps = document.getElementById("sequencerSteps");
const sequencerSettingsToggle = document.getElementById("sequencerSettingsToggle");
const sequencerSettings = document.getElementById("sequencerSettings");
sequencerSettingsToggle.addEventListener("click", () => {
  sequencerSettings.hidden = !sequencerSettings.hidden;
  sequencerSettingsToggle.setAttribute("aria-expanded", String(!sequencerSettings.hidden));
});
let servoControls = [];
let controllerConfiguration = null;
let servoSettingsDirty = false;
let controllerRebooting = false;
let lastDeviceUptime = null;
let offlineSimulation = false;
let sensorTelemetry = null;
let sensorTelemetryAt = 0;
let localConfigServer = false;
let robotStorageAvailable = false;
let robotRequiresRestart = false;
let currentRobotName = "";
let robotPersisted = true;
let robotFolders = [];
const robotQuery = () => currentRobotName ? "?robot=" + encodeURIComponent(currentRobotName) : "";
const robotSequenceEndpoint = slot => "/api/sequence/" + slot + robotQuery();
let commandModeRevision = 0;
let masterOutputsOff = false;
let sweepRunId = 0;
let sweepRunning = false;
let sequence = { loop: false, finish: true, steps: [] };
let sequenceRunId = 0;
let sequenceStepIndex = -1;
let playbackSequenceView = null;
let selectedSequenceStepIndex = -1;
let previewLedColor = [0, 0, 0];
let ledColorRevision = 0;
let sequencePlaying = false;
const sequenceLiveOverrides = new Map();
let sequenceSaving = false;
let sequenceApplying = false;
let sequenceLoaded = false;
let sequenceLoading = false;
let sequenceSavePromise = null;
let selectedSequenceSlot = "a";
const simulationSequences = new Map();
const sequenceSlotButtons = Array.from(document.querySelectorAll("#sequenceSlots button"));
const sequenceSlotContents = new Map();
let sequenceSlotRobot = null;
let sequenceSlotRobotName = null;
let sequenceSlotRefreshRevision = 0;

function updateSequenceSlotIndicators() {
  if (sequenceSlotRobot !== controllerConfiguration || sequenceSlotRobotName !== currentRobotName) {
    sequenceSlotContents.clear();
    sequenceSlotRobot = controllerConfiguration;
    sequenceSlotRobotName = currentRobotName;
    sequenceSlotRefreshRevision += 1;
  }
  if (sequenceLoaded) sequenceSlotContents.set(selectedSequenceSlot, sequence.steps.length > 0);
  for (const button of sequenceSlotButtons) {
    const populated = sequenceSlotContents.get(button.dataset.slot) === true;
    button.classList.toggle("has-steps", populated);
    button.title = "Sequence " + button.dataset.slot.toUpperCase() + (populated ? " - contains steps" : "");
  }
}

async function refreshSequenceSlotIndicators() {
  updateSequenceSlotIndicators();
  const revision = ++sequenceSlotRefreshRevision;
  // Read sequentially to avoid flooding the embedded controller with requests.
  for (const button of sequenceSlotButtons) {
    const slot = button.dataset.slot;
    if (slot === selectedSequenceSlot) continue;
    const previous = sequenceSlotContents.get(slot);
    try {
      const saved = await readSequence(slot);
      if (revision !== sequenceSlotRefreshRevision) return;
      if (slot !== selectedSequenceSlot && sequenceSlotContents.get(slot) === previous) {
        sequenceSlotContents.set(slot, saved.steps.length > 0);
      }
      updateSequenceSlotIndicators();
    } catch (_) { /* Leave unreadable slots unchanged; opening them reports errors. */ }
    if (revision !== sequenceSlotRefreshRevision) return;
  }
}

const sequenceFilename = () => "sequence_" + selectedSequenceSlot + ".json";
const sequenceEndpoint = () => robotSequenceEndpoint(selectedSequenceSlot);
sequenceSlotButtons.forEach(button => button.addEventListener("click", async () => {
  if (sequenceLoading || sequencePlaying || sequenceApplying || controllerRebooting || sweepRunning) return;
  while (sequenceSaving) {
    if (!sequenceSavePromise || !await sequenceSavePromise) return;
  }
  if (sequenceLoading || sequencePlaying || sequenceApplying || controllerRebooting || sweepRunning) return;
  if (button.dataset.slot === selectedSequenceSlot && sequenceLoaded) return;
  const previousSlot = selectedSequenceSlot;
  const previousSequence = sequence;
  const previousSelection = selectedSequenceStepIndex;
  const previousLoaded = sequenceLoaded;
  simulationSequences.set(previousSlot, sequence);
  sequenceLoading = true;
  selectedSequenceSlot = button.dataset.slot;
  selectedSequenceStepIndex = -1;
  sequence = simulationSequences.get(selectedSequenceSlot) || { loop: false, finish: true, steps: [] };
  updateSequencerControls();
  setText("sequencerError", "");
  setText("sequencerStatus", "Loading " + sequenceFilename() + "…");
  try {
    await loadSequence();
  } catch (error) {
    selectedSequenceSlot = previousSlot;
    sequence = previousSequence;
    selectedSequenceStepIndex = previousSelection;
    sequenceLoaded = previousLoaded;
    setText("sequencerStatus", "Sequence was not switched");
    setText("sequencerError", error.message);
  } finally {
    sequenceLoading = false;
    renderSequence();
    updateSequencerControls();
  }
}));
let overdueSequenceSteps = new WeakSet();

function selectTab(selected) {
  if (selected === 2) selected = 3;
  if (selected !== 3 && servoSettingsDirty) {
    try { stageServoSettings(); }
    catch (error) { setText("servoSettingsStatus", "Settings not applied: " + error.message); return; }
  }
  document.body.classList.toggle("setup-active", selected === 3);
  document.body.classList.toggle("about-active", selected === 4);
  document.body.classList.toggle("overview-active", selected === 0);
  document.body.classList.toggle("shop-active", selected === 5);
  document.body.classList.toggle("api-active", selected === 6);
  document.body.classList.toggle("ai-learning-active", selected === 7);
  document.body.classList.toggle("help-active", selected === 8);
  if (selected === 7) globalThis.GhostLearning?.refresh();
  // Reuse the same canvas and controls so camera/edit state survives tab changes.
  if (selected === 1 || selected === 2 || selected === 3) {
    tabs[selected].panel.append(document.getElementById("previewPanel"));
  }
  if (typeof previewReady !== "undefined" && previewReady) {
    servoPreview.editing = selected === 3;
    document.getElementById("previewTransform").hidden = selected !== 3;
    document.getElementById("previewPanel").hidden = selected === 3 ? false : !servoPreview.active;
  }
  tabs.forEach(({ button, panel }, index) => {
    const active = index === selected;
    button.setAttribute("aria-selected", String(active));
    button.tabIndex = active ? 0 : -1;
    panel.hidden = !active;
  });
  if (selected === 5) prepareShopRobot();
}

tabs.forEach(({ button }, index) => {
  button.addEventListener("click", () => selectTab(index));
  button.addEventListener("keydown", event => {
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      const orderedTabs = Array.from(button.parentElement.querySelectorAll('[role="tab"]')).filter(tab => !tab.hidden);
      const position = orderedTabs.indexOf(button);
      const nextButton = orderedTabs[(position + (event.key === "ArrowRight" ? 1 : orderedTabs.length - 1)) % orderedTabs.length];
      const next = tabs.findIndex(tab => tab.button === nextButton);
      selectTab(next);
      tabs[next].button.focus();
    }
  });
});
selectTab(1);

document.getElementById("helpOpenLearning").addEventListener("click", () => document.getElementById("aiLearningTab").click());
document.getElementById("helpOpenSetup").addEventListener("click", () => document.getElementById("setupTab").click());

function makeElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function servoCommandText(control, value) {
  if (!control.continuous) return Math.round(value) + "\u00b0";
  const speed = Math.round((Number(value) - 90) / 90 * 100);
  return speed === 0 ? "STOP" : (speed > 0 ? "FWD " : "REV ") + Math.abs(speed) + "%";
}

function stopContinuousServos() {
  servoControls.filter(control => control.continuous && control.outputEnabled).forEach(control => {
    control.slider.value = 90;
    scheduleCommand(control, { angle: "90", smooth: "0" });
  });
}

function createServoStrip(configuration, channel) {
  const strip = makeElement("section", "channel-strip" + (configuration.continuous ? " continuous-channel" : ""));
  strip.append(makeElement("span", "channel-number", "OUTPUT " + String(channel).padStart(2, "0")));
  strip.append(makeElement("h2", "", configuration.name));
  const settingsButton = makeElement("button", "servo-settings-button", "\u2699");
  settingsButton.type = "button";
  settingsButton.setAttribute("aria-label", "Settings for " + configuration.name);
  settingsButton.title = "Servo settings";
  settingsButton.addEventListener("click", () => openServoSettings(channel));
  strip.append(settingsButton);
  const meter = makeElement("div", "meter");
  strip.append(meter);
  const angle = makeElement("div", "channel-readout", "0°");
  angle.id = "angle" + channel;
  angle.textContent = servoCommandText(configuration, configuration.continuous ? 90 : 0);
  strip.append(angle);

  const faderWithScale = makeElement("div", "fader-with-scale");
  const verticalControl = makeElement("div", "vertical-control");
  const slider = makeElement("input");
  slider.type = "range";
  const [minimum, maximum] = servoCommandLimits(configuration);
  slider.min = String(minimum);
  slider.max = String(maximum);
  slider.step = "1";
  slider.value = String(clampServoCommand(configuration, configuration.continuous ? 90 : configuration.startupAngle ?? 0));
  slider.id = "servoSlider" + channel;
  slider.setAttribute("aria-label", configuration.name + (configuration.continuous ? " direction and speed (90 stops)" : " position"));
  slider.setAttribute("aria-orientation", "vertical");
  verticalControl.append(slider);
  const positionRail = makeElement("div", "servo-position-rail");
  positionRail.setAttribute("aria-hidden", "true");
  positionRail.hidden = true;
  const positionTrail = makeElement("span", "servo-position-trail");
  const positionTip = makeElement("span", "servo-position-tip");
  positionRail.append(positionTrail, positionTip);
  verticalControl.append(positionRail);
  const hoverAngle = makeElement("span", "servo-hover-angle");
  hoverAngle.hidden = true;
  hoverAngle.setAttribute("aria-hidden", "true");
  verticalControl.append(hoverAngle);
  const hideHoverAngle = () => { hoverAngle.hidden = true; };
  const showHoverAngle = event => {
    if (event.pointerType === "touch" || slider.disabled) {
      hideHoverAngle();
      return;
    }
    const bounds = slider.getBoundingClientRect();
    // Chromium reports the input's height when querying its thumb pseudo-element.
    // Use the thumb dimensions defined in style.css (Firefox includes 1px borders).
    const thumbHeight = navigator.userAgent.includes("Firefox") ? 18 : 26;
    // Native ranges reserve half a thumb at each end of their travel.
    const travel = Math.max(1, bounds.height - thumbHeight);
    let fraction = Math.max(0, Math.min(1, (event.clientY - bounds.top - thumbHeight / 2) / travel));
    if (getComputedStyle(slider).direction === "rtl") fraction = 1 - fraction;
    const minimum = Number(slider.min);
    const maximum = Number(slider.max);
    const step = Number(slider.step) || 1;
    const degrees = Math.max(minimum, Math.min(maximum,
      minimum + Math.round(fraction * (maximum - minimum) / step) * step));
    hoverAngle.textContent = degrees + "\u00b0";
    hoverAngle.hidden = false;
    hoverAngle.style.left = Math.max(0, Math.min(event.clientX + 12,
      window.innerWidth - hoverAngle.offsetWidth - 4)) + "px";
    hoverAngle.style.top = Math.max(0, Math.min(event.clientY + 12,
      window.innerHeight - hoverAngle.offsetHeight - 4)) + "px";
  };
  slider.addEventListener("pointerenter", showHoverAngle);
  slider.addEventListener("pointermove", showHoverAngle);
  slider.addEventListener("pointerleave", hideHoverAngle);
  slider.addEventListener("pointercancel", hideHoverAngle);
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


  const buttons = makeElement("div", "channel-buttons");
  const muteButton = makeElement("button", "mix-button", "MUTE");
  muteButton.type = "button";
  muteButton.id = "mute" + channel;
  muteButton.setAttribute("aria-pressed", "false");
  const soloButton = makeElement("button", "mix-button solo", "SOLO");
  soloButton.type = "button";
  soloButton.id = "solo" + channel;
  soloButton.setAttribute("aria-pressed", "false");
  const motionButton = makeElement("button", "mix-button motion-mode", "-");
  motionButton.type = "button";
  motionButton.id = "motionMode" + channel;
  motionButton.setAttribute("aria-pressed", "false");
  const speedButton = makeElement("button", "mix-button motion-speed", "H");
  speedButton.type = "button";
  speedButton.id = "motionSpeed" + channel;
  const reverseButton = makeElement("button", "mix-button reverse-button", "REV");
  reverseButton.type = "button";
  const powerButton = makeElement("button", "mix-button servo-power", "\u23fb");
  powerButton.type = "button";
  buttons.append(muteButton, soloButton, motionButton, speedButton, reverseButton, powerButton);
  const centerButton = makeElement("button", "mix-button servo-center", "C");
  centerButton.type = "button";
  centerButton.setAttribute("aria-label", (configuration.continuous ? "Stop " : "Center ") + configuration.name);
  centerButton.title = configuration.continuous ? "Stop / neutral" : "Center at 90 degrees";
  centerButton.addEventListener("click", () => {
    stopSweep(); stopSequence();
    const control = servoControls[channel - 1];
    if (!control.ready || !control.outputEnabled || controllerRebooting) return;
    control.slider.value = 90;
    setText("angle" + channel, servoCommandText(control, 90));
    scheduleCommand(control, configuration.continuous ? { angle: "90", smooth: "0" } : { angle: "90" });
  });
  strip.append(centerButton);
  strip.append(buttons);
  const error = makeElement("div", "servo-error");
  error.id = "servoMessage" + channel;
  error.setAttribute("role", "alert");
  error.setAttribute("aria-label", "Servo " + channel + " error");
  document.querySelector(".status-messages").append(error);
  return { strip, meter, slider, scale, positionRail, positionTrail, positionTip, muteButton, soloButton, motionButton, speedButton, reverseButton, powerButton, angle };
}

function isEligible(control) {
  const hasSolo = (servoControls.some(candidate => candidate.solo) || (typeof componentPanels !== "undefined" && componentPanels.hasSolo()));
  return control.ready && control.outputEnabled && !control.muted && (!hasSolo || control.solo);
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
  updateSequencerControls();
}

function updateSequencerControls() {
  const allServosReady = servoControls.length > 0 &&
    servoControls.every(control => control.ready);
  const locked = controllerRebooting || sequencePlaying || sequenceSaving || sequenceLoading || sequenceApplying ||
    !sequenceLoaded;
  writeStepButton.textContent = selectedSequenceStepIndex < 0
    ? "ADD STEP"
    : "UPDATE STEP";
  const colorSelected = sequence.steps[selectedSequenceStepIndex]?.type === "color";
  writeStepButton.disabled = locked || (!colorSelected && !allServosReady) ||
    (selectedSequenceStepIndex < 0 && sequence.steps.length >= 32);
  playSequenceButton.disabled = locked || sweepRunning || sequence.steps.length === 0;
  stopSequenceButton.disabled = !sequencePlaying;
  clearSequenceButton.disabled = locked || sequence.steps.length === 0;
  updateSequenceSlotIndicators();
  sequenceSlotButtons.forEach(button => {
    // A slot click waits for the current save, including a duration input blur.
    button.disabled = controllerRebooting || sequencePlaying || sequenceLoading || sequenceApplying || !sequenceLoaded || sweepRunning;
    button.setAttribute("aria-pressed", String(button.dataset.slot === (playbackSequenceView?.slot || selectedSequenceSlot)));
  });
  document.getElementById("appendSequenceStep").disabled = locked || !allServosReady || sequence.steps.length >= 32;
  document.getElementById("appendSequenceCall").disabled = locked || sequence.steps.length >= 32;
  document.getElementById("appendSequenceColor").disabled = locked || sequence.steps.length >= 32;
  document.getElementById("appendSequenceDelay").disabled = locked || sequence.steps.length >= 32;
  stepDurationInput.disabled = locked;
  sequenceFinishButton.disabled = locked;
  playbackRateInput.disabled = locked;
  sequencerSteps.querySelectorAll("input, select, button").forEach(element => {
    if (element.id === "appendSequenceStep" || element.id === "appendSequenceCall" || element.id === "appendSequenceColor" || element.id === "appendSequenceDelay") return;
    element.disabled = locked || element.dataset.sequenceCall === "true" || (element.classList.contains("move-step-up-button") && element.dataset.stepIndex === "0");
  });
}

function setServoPlaybackLock(locked) {
  servoControls.forEach(control => {
    const disabled = controllerRebooting || !control.ready || locked;
    control.slider.disabled = disabled;
    const mixDisabled = controllerRebooting || !control.ready || (locked && !sequencePlaying);
    control.muteButton.disabled = mixDisabled;
    control.soloButton.disabled = mixDisabled;
    control.motionButton.disabled = disabled;
    control.speedButton.disabled = disabled;
    control.reverseButton.disabled = disabled;
  });
}

function renderSequence() {
  const addActions = document.getElementById("sequenceAddActions");
  sequencerSteps.replaceChildren();
  const displayedSequence = playbackSequenceView?.sequence || sequence;
  const displayedSlot = playbackSequenceView?.slot || selectedSequenceSlot;
  sequenceFinishButton.setAttribute("aria-pressed", String(displayedSequence.finish === true));
  sequenceFinishButton.textContent = displayedSequence.finish ? "Finish Mode" : "Timed Mode";
  displayedSequence.steps.forEach((step, index) => {
    const item = makeElement("li");
    if (index === sequenceStepIndex) item.setAttribute("aria-current", "step");
    const row = makeElement("div", "sequencer-step-row");
    const select = makeElement(
      "button",
      "mix-button sequence-step-select",
      "" + (index + 1)
    );
    select.type = "button";
    select.setAttribute(
      "aria-pressed",
      String(displayedSlot === selectedSequenceSlot && index === selectedSequenceStepIndex)
    );
    select.addEventListener("click", () => selectSequenceStep(index));
    row.append(select);

    const duration = makeElement("input", "sequence-step-duration");
    if (overdueSequenceSteps.has(step)) {
      duration.classList.add("step-time-overrun");
      duration.title = "Servo motion could not complete within this step duration.";
      duration.setAttribute("aria-label", "" + (index + 1) + " duration in milliseconds; motion exceeded this duration");
    }
    duration.type = "number";
    duration.min = step.type === "delay" ? "1" : "100";
    duration.max = "60000";
    duration.step = step.type === "delay" ? "1" : "100";
    duration.value = String(step.durationMs);
    if (!overdueSequenceSteps.has(step)) duration.setAttribute("aria-label", "" + (index + 1) + " duration in milliseconds");
    duration.addEventListener("change", () => {
      const durationMs = Number(duration.value);
      if (!Number.isInteger(durationMs) || durationMs < Number(duration.min) || durationMs > 60000) {
        setText("sequencerError", "Step duration must be between " + duration.min + " and 60000 milliseconds.");
        renderSequence();
        return;
      }
      const updated = {
        ...sequence,
        steps: sequence.steps.map((savedStep, stepIndex) =>
          stepIndex === index ? { ...savedStep, durationMs } : savedStep)
      };
      saveSequenceChange(updated);
    });
    if (step.type === "delay") {
      select.textContent = (index + 1) + " \u23f1";
      select.disabled = true;
      select.dataset.sequenceCall = "true";
      select.title = "Delay step";
      duration.setAttribute("aria-label", "Step " + (index + 1) + " delay in milliseconds");
      row.append(duration, makeElement("span", "subtle", "ms"));
    } else if (step.type === "sequence") {
      const target = makeElement("select", "sequence-step-target");
      target.setAttribute("aria-label", "Step " + (index + 1) + " called sequence");
      for (const slot of "abcdefghij") {
        const option = makeElement("option", "", "> " + slot.toUpperCase());
        option.value = slot;
        target.append(option);
      }
      target.value = step.slot;
      target.addEventListener("change", () => saveSequenceChange({ ...sequence,
        steps: sequence.steps.map((saved, i) => i === index ? { type: "sequence", slot: target.value } : saved)
      }));
      row.append(target);
      select.disabled = true;
      select.dataset.sequenceCall = "true";
      select.title = "Sequence call — choose its target from the dropdown";
    } else if (step.type === "color") {
      const colors = makeElement("div", "sequence-color-controls");
      ["R", "G", "B"].forEach((label, channel) => {
        const button = makeElement("button", "mix-button sequence-color-channel", label);
        button.type = "button";
        button.dataset.channel = label.toLowerCase();
        button.setAttribute("aria-pressed", String(step.rgb[channel] > 0));
        button.setAttribute("aria-label", "Step " + (index + 1) + " " + ["red", "green", "blue"][channel]);
        button.addEventListener("click", () => {
          const rgb = [...step.rgb];
          rgb[channel] = rgb[channel] > 0 ? 0 : 255;
          saveSequenceChange({ ...sequence, steps: sequence.steps.map((saved, i) => i === index ? { ...saved, rgb } : saved) });
        });
        colors.append(button);
      });
      row.append(colors);
      select.title = "Run LED color step";
    } else if (!displayedSequence.finish) {
      row.append(duration);
    }

    const remove = makeElement("button", "mix-button remove-step-button", "×");
    remove.type = "button";
    remove.title = "Remove step " + (index + 1);
    remove.setAttribute("aria-label", "Remove step " + (index + 1));
    remove.addEventListener("click", () => {
      const previousSelection = selectedSequenceStepIndex;
      if (selectedSequenceStepIndex === index) {
        selectedSequenceStepIndex = -1;
      } else if (selectedSequenceStepIndex > index) {
        selectedSequenceStepIndex -= 1;
      }
      const updated = {
        ...sequence,
        steps: sequence.steps.filter((_, stepIndex) => stepIndex !== index)
      };
      saveSequenceChange(updated, previousSelection);
    });
    const moveUp = makeElement("button", "mix-button move-step-up-button", "\u2191");
    moveUp.type = "button";
    moveUp.dataset.stepIndex = String(index);
    moveUp.title = "Move step " + (index + 1) + " up";
    moveUp.setAttribute("aria-label", moveUp.title);
    moveUp.addEventListener("click", () => moveSequenceStepUp(index));
    row.append(moveUp, remove);
    item.append(row);
    sequencerSteps.append(item);
  });
  sequencerSteps.append(addActions);
  updateSequencerControls();
  const playingStep = sequencerSteps.querySelector('[aria-current="step"]');
  if (playingStep && !sequencerPanel.hidden) {
    const row = playingStep.getBoundingClientRect();
    const list = sequencerSteps.getBoundingClientRect();
    if (row.top < list.top) sequencerSteps.scrollTop -= list.top - row.top;
    else if (row.bottom > list.bottom) sequencerSteps.scrollTop += row.bottom - list.bottom;
  }
}

function moveSequenceStepUp(index) {
  if (controllerRebooting || sequencePlaying || sequenceSaving || sequenceApplying || !sequenceLoaded ||
      !Number.isInteger(index) || index <= 0 || index >= sequence.steps.length) return;
  const previousSelection = selectedSequenceStepIndex;
  const steps = [...sequence.steps];
  [steps[index - 1], steps[index]] = [steps[index], steps[index - 1]];
  if (selectedSequenceStepIndex === index) selectedSequenceStepIndex--;
  else if (selectedSequenceStepIndex === index - 1) selectedSequenceStepIndex++;
  return saveSequenceChange({ ...sequence, steps }, previousSelection);
}

function captureSequenceStep(durationMs) {
  return {
    angles: servoControls.map(control => Number(control.slider.value)),
    servoStates: servoControls.map(encodeServoState),
    componentStates: typeof componentPanels !== "undefined" ? componentPanels.captureSequence() : [],
    durationMs
  };
}

async function applySequenceStep(step, useStartupMotion = false, playbackRate = 1) {
  const componentRun = typeof sequenceRunId === "undefined" ? null : sequenceRunId;
  if (step.type === "delay") return;
  if (step.type === "color") {
    if (!offlineSimulation) {
      const response = await fetch("/api/led", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rgb: step.rgb }), signal: AbortSignal.timeout(3000)
      });
      if (!response.ok) throw new Error(await response.text() || "Could not set LED color");
    }
    ledColorRevision += 1;
    setPreviewLedColor(step.rgb);
    return;
  }
  step.servoStates.forEach((state, servoIndex) => {
    if (servoControls[servoIndex]?.ready) applyServoState(servoControls[servoIndex], state);
  });
  const hasSolo = (servoControls.some(control => control.solo) || (typeof componentPanels !== "undefined" && componentPanels.hasSolo()));
  const entries = step.angles.map((angle, servoIndex) => {
    const control = servoControls[servoIndex];
    if (!control?.ready) return;
    const enabled = !control.muted && (!hasSolo || control.solo);
    return { control, command: {
      angle: String(angle),
      enabled: enabled ? "1" : "0",
      smooth: useStartupMotion || control.smoothMode ? "1" : "0",
      motionMode: control.linearMode ? "linear" : useStartupMotion || control.smoothMode ? "smooth" : "immediate",
      ...(control.linearMode ? { durationMs: step.durationMs } : {}),
      speed: useStartupMotion ? "M" : control.motionSpeed,
      playbackRate: String(playbackRate)
    } };
  }).filter(Boolean);
  await requestServoBatch(entries);
  if (componentRun !== null && componentRun !== sequenceRunId) return;
  if (typeof componentPanels !== "undefined") componentPanels.playSequence(step.componentStates, { startup: useStartupMotion, playbackRate, durationMs: step.durationMs });
  entries.forEach(({ control, command }) => {
    control.slider.value = command.angle;
    setText("angle" + control.channel, servoCommandText(control, Number(command.angle)));
  });
}

async function selectSequenceStep(index) {
  if (["sequence", "delay"].includes(sequence.steps[index]?.type)) return;
  if (sequencePlaying || sequenceSaving || sequenceApplying) return;
  if (selectedSequenceStepIndex === index) {
    selectedSequenceStepIndex = -1;
    renderSequence();
    setText("sequencerError", "");
    setText("sequencerStatus", sequence.steps.length + " step(s) saved on device");
    return;
  }

  selectedSequenceStepIndex = index;
  sequenceApplying = true;
  setServoPlaybackLock(true);
  renderSequence();
  setText("sequencerError", "");
  setText("sequencerStatus", "Loading step " + (index + 1));
  stepDurationInput.value = String(sequence.steps[index].durationMs);
  try {
    await applySequenceStep(sequence.steps[index]);
    setText("sequencerStatus", "" + (index + 1) + " selected");
  } catch (error) {
    setText("sequencerStatus", "Could not load step " + (index + 1));
    setText("sequencerError", error.message);
  } finally {
    sequenceApplying = false;
    setServoPlaybackLock(false);
    updateSequencerControls();
  }
}

function encodeServoState(control) {
  // Legacy bits retain mute/solo/smooth and speed; bit 5 adds linear motion.
  const speed = control.motionSpeed === "L" ? 0 :
    control.motionSpeed === "M" ? 1 : 2;
  return (control.muted ? 1 : 0) |
    (control.solo ? 2 : 0) |
    (control.linearMode ? 32 : control.smoothMode ? 4 : 0) |
    (speed << 3);
}

function applyServoState(control, encodedState) {
  control.muted = (encodedState & 1) !== 0;
  control.solo = (encodedState & 2) !== 0;
  const overrides = sequencePlaying ? sequenceLiveOverrides.get(control) : null;
  if (overrides?.muted !== undefined) control.muted = overrides.muted;
  if (overrides?.solo !== undefined) control.solo = overrides.solo;
  control.linearMode = (encodedState & 32) !== 0;
  control.smoothMode = !control.linearMode && (encodedState & 4) !== 0;
  const speed = (encodedState >> 3) & 3;
  control.motionSpeed = speed === 0 ? "L" : speed === 1 ? "M" : "H";
  syncServoStateButtons(control);
  syncMotionMode(control);
  syncMotionSpeed(control);
}

async function saveSequenceChange(updated, previousSelection = selectedSequenceStepIndex) {
  if (sequencePlaying || sequenceLoading) return false;
  const previous = sequence;
  const slot = selectedSequenceSlot;
  const pending = sequenceSavePromise;
  sequence = updated;
  sequenceSaving = true;
  // Snapshot the payload and slot before waiting for any earlier write.
  const body = JSON.stringify(updated);
  const endpoint = robotSequenceEndpoint(slot);
  const saving = Promise.resolve().then(async () => {
    if (pending) await pending;
    try {
      if (robotPersisted && (!offlineSimulation || localConfigServer || robotStorageAvailable)) {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body
        });
        const result = await response.text();
        if (!response.ok) throw new Error(result || "HTTP " + response.status);
      }
      simulationSequences.set(slot, updated);
      if (sequenceSavePromise === saving) {
        setText("sequencerError", "");
        setText("sequencerStatus", updated.steps.length + " step(s) " +
          (!robotPersisted || (offlineSimulation && !localConfigServer && !robotStorageAvailable) ? "kept in this page until Save robot" :
            "saved to robots/" + currentRobotName + "/sequence_" + slot + ".json"));
      }
      return true;
    } catch (error) {
      // An older failed request must not roll back a newer accepted edit.
      if (selectedSequenceSlot === slot && sequence === updated) {
        sequence = previous;
        selectedSequenceStepIndex = previousSelection;
        renderSequence();
      }
      setText("sequencerStatus", "Sequence was not saved");
      setText("sequencerError", error.message);
      return false;
    } finally {
      if (sequenceSavePromise === saving) {
        sequenceSaving = false;
        sequenceSavePromise = null;
        updateSequencerControls();
      }
    }
  });
  sequenceSavePromise = saving;
  renderSequence();
  updateSequencerControls();
  setText("sequencerError", "");
  setText("sequencerStatus", "Saving sequence�");
  return saving;
}

async function readSequence(slot) {
  if (!robotPersisted || (offlineSimulation && !localConfigServer && !robotStorageAvailable)) {
    return simulationSequences.get(slot) || (slot === selectedSequenceSlot ? sequence : { loop: false, finish: true, steps: [] });
  }
  const response = await fetch(robotSequenceEndpoint(slot), { cache: "no-store", signal: AbortSignal.timeout(3000) });
  if (!response.ok) {
    const result = await response.text();
    throw new Error(/<[^>]+>/.test(result) ? "Could not load sequence (HTTP " + response.status + ")" : result || "HTTP " + response.status);
  }
  const saved = await response.json();
  if (typeof componentRegistry !== "undefined" && Array.isArray(saved.steps)) saved.steps.forEach(step => componentRegistry.validateSequenceStates(step?.componentStates));
  if (typeof saved.loop !== "boolean" || (saved.finish !== undefined && typeof saved.finish !== "boolean") || !Array.isArray(saved.steps) ||
    saved.steps.length > 32 ||
    saved.steps.some(step => step?.type === "delay" ?
      !Number.isInteger(step.durationMs) || step.durationMs < 1 || step.durationMs > 60000 : step?.type === "color" ?
      !Array.isArray(step.rgb) || step.rgb.length !== 3 || step.rgb.some(value => !Number.isInteger(value) || value < 0 || value > 255) ||
      !Number.isInteger(step.durationMs) || step.durationMs < 100 || step.durationMs > 60000 : step?.type === "sequence" ? !/^[a-j]$/.test(step.slot) :
      !step || !Array.isArray(step.angles) || step.angles.length !== servoControls.length ||
      (step.servoStates !== undefined &&
        (!Array.isArray(step.servoStates) ||
          step.servoStates.length !== servoControls.length ||
          step.servoStates.some(state =>
            !Number.isInteger(state) || state < 0 || state > 55 || (state & 24) === 24 || (state & 36) === 36))) ||
      !Number.isInteger(step.durationMs) || step.durationMs < 100 ||
      step.durationMs > 60000 ||
      step.angles.some(angle => !Number.isInteger(angle) || angle < 0 || angle > 180))) {
    throw new Error("Stored sequence data has an invalid format.");
  }
  return {
    ...saved,
    finish: saved.finish !== false,
    steps: saved.steps.map(step => ["sequence", "color", "delay"].includes(step.type) ? step : ({
      ...step,
      servoStates: step.servoStates || servoControls.map(encodeServoState)
    }))
  };
}

async function loadSequence() {
  sequence = await readSequence(selectedSequenceSlot);
  sequenceLoaded = true;
  renderSequence();
  void refreshSequenceSlotIndicators();
  setText("sequencerStatus", sequence.steps.length + " step(s) loaded from " + (currentRobotName ? "robots/" + currentRobotName + "/" : "") + sequenceFilename());
}

async function writeSequenceStep() {
  if (controllerRebooting || sequencePlaying || sequenceSaving || sequenceLoading || sequenceApplying || !sequenceLoaded) return;
  const durationMs = Number(stepDurationInput.value);
  if (!Number.isInteger(durationMs) || durationMs < 100 || durationMs > 60000) {
    setText("sequencerError", "New step duration must be between 100 and 60000 milliseconds.");
    return;
  }
  const colorSelected = sequence.steps[selectedSequenceStepIndex]?.type === "color";
  if (!colorSelected && !servoControls.every(control => control.ready)) {
    setText("sequencerError", "All configured servos must be available to write a step.");
    return;
  }
  if (selectedSequenceStepIndex < 0 && sequence.steps.length >= 32) {
    setText("sequencerError", "The sequence is limited to 32 steps.");
    return;
  }
  setText("sequencerError", "");
  const step = colorSelected ? { ...sequence.steps[selectedSequenceStepIndex], rgb: [...sequence.steps[selectedSequenceStepIndex].rgb] } : captureSequenceStep(durationMs);
  const steps = sequence.steps.slice();
  if (selectedSequenceStepIndex < 0) {
    steps.push(step);
  } else {
    step.durationMs = steps[selectedSequenceStepIndex].durationMs;
    steps[selectedSequenceStepIndex] = step;
  }
  const previousSelection = selectedSequenceStepIndex;
  selectedSequenceStepIndex = -1;
  await saveSequenceChange({ ...sequence, steps }, previousSelection);
}

function waitForStep(runId, durationMs) {
  return new Promise(resolve => {
    const startedAt = Date.now();
    function check() {
      const remaining = durationMs - (Date.now() - startedAt);
      if (runId !== sequenceRunId || remaining <= 0) {
        resolve();
      } else {
        setTimeout(check, Math.min(50, remaining));
      }
    }
    check();
  });
}

function sequenceStepWaitMilliseconds(step, playbackRate, motionEnds, finish = sequence.finish) {
  if (step.type === "delay") return step.durationMs;
  if (!finish) return step.durationMs / playbackRate;
  const remaining = Math.max(0, ...motionEnds.map(end => end - performance.now()));
  // Continuous servos have no destination, so their run time still comes from the step.
  const continuousDuration = servoControls.some(control => control.ready && isEligible(control) && control.continuous)
    ? step.durationMs / playbackRate : 0;
  // Finish waits for both the configured step duration and every active move.
  return Math.max(16, step.durationMs / playbackRate, remaining, continuousDuration);
}

async function playSequence() {
  if (controllerRebooting || sequencePlaying || sweepRunning || sequence.steps.length === 0) return;
  const playbackRate = Number(playbackRateInput.value);
  if (!Number.isFinite(playbackRate) || playbackRate < 0.001 || playbackRate > 10) {
    setText("sequencerError", "Playback rate must be between 0.001 and 10.");
    return;
  }

  setText("sequencerError", "");
  sequenceLiveOverrides.clear();
  sequencePlaying = true;
  overdueSequenceSteps = new WeakSet();
  const runId = ++sequenceRunId;
  setServoPlaybackLock(true);
  updateSequencerControls();
  sweepButton.disabled = true;
  sweepAllButton.disabled = true;
  centerButton.disabled = true;
  stopSweepButton.disabled = true;
  let startup = true;
  try {
    // Cache at most the ten sequence slots; never expand calls into a step list.
    const rootSlot = selectedSequenceSlot;
    const cache = new Map([[rootSlot, sequence]]);
    for (const [, saved] of cache) {
      for (const step of saved.steps) {
        if (runId !== sequenceRunId) return;
        if (step.type !== "sequence" || cache.has(step.slot)) continue;
        const called = await readSequence(step.slot);
        if (runId !== sequenceRunId) return;
        cache.set(step.slot, called);
      }
    }
    if (![...cache.values()].some(saved => saved.steps.some(step => step.type !== "sequence"))) {
      throw new Error("Sequence chain has no motion steps.");
    }
    const hasCalls = sequence.steps.some(step => step.type === "sequence");
    const frames = [{ sequence, slot: rootSlot, index: 0 }];
    while (runId === sequenceRunId && frames.length) {
      const frame = frames[frames.length - 1];
      const saved = frame.sequence;
      if (frame.index >= saved.steps.length) {
        frames.pop();
        continue;
      }
      const step = saved.steps[frame.index];
      if (step.type === "sequence") {
        frame.index += 1;
        const active = frames.findIndex(entry => entry.slot === step.slot);
        if (active >= 0) {
          // A circular call restarts that active sequence instead of nesting it.
          // Every slot appears at most once, bounding the stack to ten frames.
          frames.length = active + 1;
          frames[active].index = 0;
        } else {
          frames.push({ sequence: cache.get(step.slot), slot: step.slot, index: 0 });
        }
        // Even a cycle made only of calls must yield so Stop remains responsive.
        await waitForStep(runId, 16);
        continue;
      }
      const finish = saved.finish;
      playbackSequenceView = hasCalls ? { sequence: saved, slot: frame.slot } : null;
      sequenceStepIndex = frame.index;
      renderSequence();
      setText("sequencerStatus", "Playing " + frame.slot.toUpperCase() + " step " +
        (frame.index + 1) + " of " + saved.steps.length);
      // The initial smooth move is step 1, not a separate pre-roll and hold.
      await applySequenceStep(step, startup, playbackRate);
      if (step.type !== "color" && step.type !== "delay") startup = false;
      if (runId !== sequenceRunId) break;
      const deadline = performance.now() + step.durationMs / playbackRate;
      const motionEnds = ["color", "delay"].includes(step.type) ? [] : activeStepMotionEnds();
      await waitForStep(runId, sequenceStepWaitMilliseconds(step, playbackRate, motionEnds, step.type === "color" ? false : finish));
      if (runId !== sequenceRunId) break;
      if (step.type !== "delay" && !finish && motionEnds.some(end => end > deadline + 1)) {
        overdueSequenceSteps.add(step);
      }
      frame.index += 1;
    }
    if (runId === sequenceRunId) {
      setText("sequencerStatus", "Playback complete");
    }
  } catch (error) {
    if (runId === sequenceRunId) {
      setText("sequencerStatus", "Playback failed");
      setText("sequencerError", error.message);
    }
  } finally {
    if (runId === sequenceRunId) {
      sequencePlaying = false;
      sequenceLiveOverrides.clear();
      stopContinuousServos();
      sequenceStepIndex = -1;
      playbackSequenceView = null;
      setServoPlaybackLock(false);
      sweepButton.disabled = false;
      sweepAllButton.disabled = false;
      centerButton.disabled = false;
      stopSweepButton.disabled = true;
      renderSequence();
    }
  }
}

function stopSequence() {
  if (typeof componentPanels !== "undefined") componentPanels.stopSequence();
  if (!sequencePlaying) return;
  sequenceRunId += 1;
  sequencePlaying = false;
  sequenceLiveOverrides.clear();
  stopContinuousServos();
  sequenceStepIndex = -1;
  playbackSequenceView = null;
  setServoPlaybackLock(false);
  renderSequence();
  setText("sequencerStatus", "Playback stopped");
  updateSequencerControls();
  sweepButton.disabled = false;
  sweepAllButton.disabled = false;
  centerButton.disabled = false;
  stopSweepButton.disabled = true;
}

document.getElementById("appendSequenceStep").addEventListener("click", () => {
  if (sequencePlaying || sequenceSaving || sequenceLoading || sequenceApplying || controllerRebooting || !sequenceLoaded) return;
  selectedSequenceStepIndex = -1;
  writeSequenceStep();
});
document.getElementById("appendSequenceCall").addEventListener("click", () => {
  if (sequencePlaying || sequenceSaving || sequenceLoading || sequenceApplying || controllerRebooting || !sequenceLoaded || sequence.steps.length >= 32) return;
  const slots = "abcdefghij";
  const nextSlot = slots[(slots.indexOf(selectedSequenceSlot) + 1) % slots.length];
  saveSequenceChange({ ...sequence, steps: [...sequence.steps, { type: "sequence", slot: nextSlot }] });
});
document.getElementById("appendSequenceDelay").addEventListener("click", () => {
  if (sequencePlaying || sequenceSaving || sequenceLoading || sequenceApplying || controllerRebooting || !sequenceLoaded || sequence.steps.length >= 32) return;
  saveSequenceChange({ ...sequence, steps: [...sequence.steps, { type: "delay", durationMs: 1000 }] });
});

document.getElementById("appendSequenceColor").addEventListener("click", () => {
  if (sequencePlaying || sequenceSaving || sequenceLoading || sequenceApplying || controllerRebooting || !sequenceLoaded || sequence.steps.length >= 32) return;
  saveSequenceChange({ ...sequence, steps: [...sequence.steps, { type: "color", rgb: [0, 0, 255], durationMs: 100 }] });
});
writeStepButton.addEventListener("click", writeSequenceStep);
playSequenceButton.addEventListener("click", playSequence);
stopSequenceButton.addEventListener("click", stopSequence);
let clearSequenceDialogOpen = false;
clearSequenceButton.addEventListener("click", async () => {
  if (clearSequenceDialogOpen || clearSequenceButton.disabled) return;
  const originalSequence = sequence;
  const originalSlot = selectedSequenceSlot;
  clearSequenceDialogOpen = true;
  try {
    const confirmed = await confirmDialog({
      title: "Clear sequence?",
      message: "Delete all saved steps in sequence " + originalSlot.toUpperCase() + "?",
      confirmLabel: "Clear sequence"
    });
    if (!confirmed || clearSequenceButton.disabled ||
        sequence !== originalSequence || selectedSequenceSlot !== originalSlot) return;
    const previousSelection = selectedSequenceStepIndex;
    selectedSequenceStepIndex = -1;
    const cleared = await saveSequenceChange({ ...sequence, steps: [] }, previousSelection);
    if (cleared) {
      if (typeof componentPanels !== "undefined") componentPanels.resetMotionModes();
      servoControls.forEach(control => {
        control.smoothMode = true;
        control.linearMode = false;
        syncMotionMode(control);
      });
      drawServoPreview();
    }
  } finally {
    clearSequenceDialogOpen = false;
  }
});
sequenceFinishButton.addEventListener("click", () => {
  saveSequenceChange({ ...sequence, finish: !sequence.finish });
});

function updateServoPositionTrail(control, angle) {
  if (!control.positionRail) return;
  control.positionRail.hidden = !control.ready || !Number.isFinite(angle);
  if (control.positionRail.hidden) return;
  if (!Number.isFinite(control.positionStart)) control.positionStart = angle;
  control.positionAngle = angle;
  const top = value => {
    const [min, max] = servoCommandLimits(control);
    const fraction = (Math.max(min, Math.min(max, value)) - min) / (max - min || 1);
    return 100 * (control.reversed ? fraction : 1 - fraction);
  };
  const start = top(control.positionStart);
  const current = top(angle);
  control.positionTrail.style.top = Math.min(start, current) + "%";
  control.positionTrail.style.height = Math.abs(current - start) + "%";
  control.positionTip.style.top = current + "%";
}
function estimatedCommandedAngle(control, now) {
  const motion = control.commandedMotion;
  if (!motion) return control.reportedAngle ?? Number(control.slider.value);
  const t = Math.max(0, Math.min(1, (now - motion.at) / motion.duration));
  const progress = motion.smooth ? t * t * (3 - 2 * t) : t;
  return motion.start + (motion.target - motion.start) * progress;
}

function trackCommandedMotion(control, request, at) {
  const start = estimatedCommandedAngle(control, at);
  if (request.outputEnabled === "0") {
    control.reportedAngle = start;
    control.commandedMotion = null;
    return;
  }
  if (request.angle === undefined) return;
  control.positionStart = start;
  updateServoPositionTrail(control, start);
  const target = Number(request.angle);
  const mode = request.motionMode ?? (request.smooth === "1" ? "smooth" : "immediate");
  if (mode === "immediate" || target === start) {
    control.reportedAngle = target;
    control.commandedMotion = null;
    updateServoPositionTrail(control, target);
    return;
  }
  const multiplier = request.speed === "L" ? 4 : request.speed === "M" ? 2 : 1;
  const duration = mode === "linear" && Number(request.durationMs) > 0
    ? Math.max(1, Math.ceil(Number(request.durationMs) / (Number(request.playbackRate) || 1)))
    : Math.max(50, Math.ceil(Math.abs(target - start) * (mode === "smooth" ? 1500 : 1000) * multiplier / (180 * (Number(request.playbackRate) || 1))));
  control.commandedMotion = { start, target, duration, at, smooth: mode === "smooth" };
}

function activeStepMotionEnds() {
  return [...(typeof componentPanels !== "undefined" ? componentPanels.motionEnds() : []), ...servoControls.filter(control => control.ready && isEligible(control) && !control.continuous).map(control => {
    const motion = offlineSimulation
      ? servoPreview?.servoNodes[control.channel - 1].motion : control.commandedMotion;
    return motion ? motion.at + motion.duration : 0;
  })];
}

function requestServo(control, command) {
  if (controllerRebooting) return Promise.reject(new Error("Controller is rebooting"));
  // Serialize UI, macro, sequence, and power commands for each output.
  const revision = commandModeRevision;
  const result = control.requestQueue.then(() => {
    if (revision !== commandModeRevision) return;
    return performServoRequest(control, command);
  });
  control.requestQueue = result.catch(() => {});
  return result;
}

function requestServoBatch(entries) {
  if (!entries.length) return Promise.resolve();
  if (controllerRebooting) return Promise.reject(new Error("Controller is rebooting"));
  const revision = commandModeRevision;
  const run = sequencePlaying ? sequenceRunId : null;
  const result = Promise.all(entries.map(({ control }) => control.requestQueue)).then(async () => {
    if (revision !== commandModeRevision || (run !== null && run !== sequenceRunId)) return;
    const prepared = entries.map(({ control, command }) => ({ control, request: prepareServoRequest(control, command) }));
    if (offlineSimulation) {
      const startedAt = performance.now();
      prepared.forEach(({ control, request }) => simulateServoRequest(control, request, true, startedAt));
      tickServoSimulation();
      return;
    }
    const startedAt = performance.now();
    const commands = prepared.map(({ control, request }) => ({
      channel: control.channel,
      ...(request.angle !== undefined ? { angle: Number(request.angle) } : {}),
      enabled: request.enabled === "1",
      motionMode: request.motionMode ?? (request.smooth === "1" ? "smooth" : "immediate"),
      speed: request.speed ?? control.motionSpeed,
      playbackRate: Number(request.playbackRate) || 1,
      ...(request.durationMs !== undefined ? { durationMs: Number(request.durationMs) } : {})
    }));
    const response = await fetch("/api/servos", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ commands }) });
    if (!response.ok) throw new Error(await response.text() || "Batch command failed; update the controller firmware.");
    await response.text();
    prepared.forEach(({ control, request }) => trackCommandedMotion(control, request, startedAt));
  });
  entries.forEach(({ control }) => { control.requestQueue = result.catch(() => {}); });
  return result;
}

function servoCommandLimits(servo) {
  if (servo.continuous) return [0, 180];
  const min = servo.minAngle ?? 0, max = servo.maxAngle ?? 180;
  if (!Number.isFinite(min) || !Number.isFinite(max) || min < 0 || min > 180 || min > max || Math.ceil(min) > Math.floor(max)) {
    throw new Error("Servo limits must define a valid range within the 0-180 command range.");
  }
  return [Math.ceil(min), Math.min(180, Math.floor(max))];
}
function clampServoCommand(servo, angle) {
  const [min, max] = servoCommandLimits(servo);
  return Math.max(min, Math.min(max, Number(angle)));
}
function prepareServoRequest(control, command) {
  const request = { ...command };
  if (request.angle !== undefined) request.angle = String(clampServoCommand(control, request.angle));
  // A queued step must respect mute/solo changes made since it was queued.
  if (sequencePlaying && request.enabled !== undefined) {
    request.enabled = !control.muted && (!(servoControls.some(candidate => candidate.solo) || (typeof componentPanels !== "undefined" && componentPanels.hasSolo())) || control.solo) ? "1" : "0";
  }
  // Saved steps and macros cannot restart motion while this output is off.
  if (!control.outputEnabled) delete request.angle;
  if (request.angle !== undefined && request.smooth === undefined && request.motionMode === undefined) {
    request.motionMode = control.linearMode ? "linear" : control.smoothMode ? "smooth" : "immediate";
  }
  if (request.angle !== undefined && request.speed === undefined) {
    request.speed = control.motionSpeed;
  }
  return request;
}

async function performServoRequest(control, command) {
  const request = prepareServoRequest(control, command);
  if (Object.keys(request).length === 0) return;
  if (offlineSimulation) {
    simulateServoRequest(control, request);
    return;
  }
  const motionStartedAt = performance.now();
  const response = await fetch("/api/servo", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ channel: String(control.channel), ...request })
  });
  const result = await response.text();
  if (!response.ok) throw new Error(result || "HTTP " + response.status);
  trackCommandedMotion(control, request, motionStartedAt);
}

async function sendAngle(control, angle) {
  angle = clampServoCommand(control, angle);
  await requestServo(control, { angle: String(angle) });
  control.slider.value = angle;
  setText("angle" + control.channel, servoCommandText(control, angle));
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
      (!(servoControls.some(candidate => candidate.solo) || (typeof componentPanels !== "undefined" && componentPanels.hasSolo())) || control.solo);
    scheduleCommand(control, { enabled: enabled ? "1" : "0" });
    syncServoStateButtons(control);
  });
  if (typeof updateComponentPanels === "function" && typeof servoPreview !== "undefined" && servoPreview) updateComponentPanels();
}

function syncServoStateButtons(control) {
  control.muteButton.setAttribute("aria-pressed", String(control.muted));
  control.soloButton.setAttribute("aria-pressed", String(control.solo));
  control.muteButton.textContent = "MUTE";
  control.soloButton.textContent = "SOLO";
}

function syncMotionMode(control) {
  control.motionButton.setAttribute("aria-pressed", String(control.smoothMode || control.linearMode));
  control.motionButton.textContent = control.linearMode ? "/" : control.smoothMode ? "S" : "-";
  const mode = control.linearMode ? "linear" : control.smoothMode ? "smooth" : "immediate";
  control.motionButton.setAttribute("aria-label", control.name + " motion mode: " + mode);
  control.motionButton.title = "Motion mode: " + mode;
}

function syncMotionSpeed(control) {
  control.speedButton.textContent = control.motionSpeed;
  const speedName = control.motionSpeed === "L" ? "low" :
    control.motionSpeed === "M" ? "medium" : "high";
  control.speedButton.setAttribute("aria-label", control.name + " motion speed: " + speedName);
  control.speedButton.title = "Motion speed: " + speedName;
}

function updateConfiguredServoMute(control) {
  if (!servoPreview) return;
  // Match the live node by identity: setup may have reordered or removed components.
  const node = servoPreview.servoNodes[control.channel - 1];
  const index = servoPreview.nodes.indexOf(node);
  if (index < 0) return;
  servoPreview.configuration.components[index].enabled = !control.muted;
  const form = document.getElementById("servoSettingsForm");
  if (editedServoIndex === index && !form.hidden) {
    const enabled = form.elements.namedItem("enabled");
    if (enabled) enabled.checked = !control.muted;
  }
  setText("previewSaveStatus", "Unsaved mute change. Use Save robot to keep it.");
}

function initializeServoControls(configurations, startIndex = servoControls.length) {
  configurations.forEach((configuration, index) => {
    const channel = startIndex + index + 1;
    const ui = createServoStrip(configuration, channel);
    mixer.append(ui.strip);
    const control = {
      ...ui,
      channel,
      name: configuration.name,
      minAngle: configuration.minAngle ?? 0, maxAngle: configuration.maxAngle ?? 180,
      continuous: configuration.continuous === true,
      ready: false,
      pendingCommand: null,
      timer: null,
      inFlight: false,
      requestQueue: Promise.resolve(),
      outputEnabled: false,
      powerPending: false,
      powerRevision: 0,
      reversed: configuration.reversed === true,
      muted: configuration.enabled === false,
      solo: false,
      // Mixer startup matches Clear; stored modes still apply during playback.
      smoothMode: true,
      linearMode: false,
      motionSpeed: "M"
    };
    syncMotionMode(control);
    syncMotionSpeed(control);
    syncServoStateButtons(control);
    syncReverse(control);
    syncServoPower(control);
    control.slider.value = configuration.startupAngle ?? 90;
    control.reportedAngle = Number(control.slider.value);
    setText("angle" + channel, servoCommandText(control, control.reportedAngle));
    ui.reverseButton.addEventListener("click", () => {
      control.reversed = !control.reversed;
      syncReverse(control);
    });
    ui.powerButton.addEventListener("click", () => setServoPower(control, !control.outputEnabled));
    ui.slider.addEventListener("input", () => {
      stopSweep();
      setText("angle" + channel, servoCommandText(control, Number(ui.slider.value)));
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
      updateConfiguredServoMute(control);
      if (sequencePlaying) sequenceLiveOverrides.set(control, { ...sequenceLiveOverrides.get(control), muted: control.muted });
      syncMuteSolo();
    });
    ui.soloButton.addEventListener("click", () => {
      control.solo = !control.solo;
      if (sequencePlaying) sequenceLiveOverrides.set(control, { ...sequenceLiveOverrides.get(control), solo: control.solo });
      syncMuteSolo();
    });
    ui.motionButton.addEventListener("click", () => {
      const next = control.linearMode ? "immediate" : control.smoothMode ? "linear" : "smooth";
      control.smoothMode = next === "smooth";
      control.linearMode = next === "linear";
      syncMotionMode(control);
    });
    ui.speedButton.addEventListener("click", () => {
      control.motionSpeed = control.motionSpeed === "L" ? "M" :
        control.motionSpeed === "M" ? "H" : "L";
      syncMotionSpeed(control);
    });
    servoControls.push(control);
  });
}

async function runMacro(action) {
  if (controllerRebooting || sweepRunning || sequencePlaying) return;
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
  updateSequencerControls();
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
      updateSequencerControls();
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
    if (!isEligible(control) || control.continuous) continue;
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
    const eligible = servoControls.filter(control => control.ready && isEligible(control) && !control.continuous);
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
function syncReverse(control) {
  control.strip.classList.toggle("reversed", control.reversed);
  if (Number.isFinite(control.positionAngle)) updateServoPositionTrail(control, control.positionAngle);
  control.reverseButton.setAttribute("aria-pressed", String(control.reversed));
  control.reverseButton.setAttribute("aria-label", control.name + " reversed slider direction");
  control.reverseButton.title = control.continuous ? "Reverse direction/speed slider" : "Reverse position slider";
  const [min, max] = servoCommandLimits(control);
  const low = control.continuous ? "REV 100%" : min + "\u00b0";
  const high = control.continuous ? "FWD 100%" : max + "\u00b0";
  control.scale.firstElementChild.textContent = control.reversed ? low : high;
  control.scale.children[1].textContent = control.continuous ? "STOP" : (min + max) / 2 + "\u00b0";
  control.scale.lastElementChild.textContent = control.reversed ? high : low;
}

function syncServoPower(control) {
  control.powerButton.setAttribute("aria-pressed", String(control.outputEnabled));
  const action = "Switch " + (control.outputEnabled ? "off " : "on ") + control.name + " PWM output";
  control.powerButton.setAttribute("aria-label", action);
  control.powerButton.title = action;
  control.powerButton.disabled = controllerRebooting || !control.ready || control.powerPending;
}

function syncMasterPower() {
  const outputs = [...servoControls.map(control => control.outputEnabled), ...(typeof componentPanels !== "undefined" ? componentPanels.powerStates() : [])];
  masterOutputsOff = outputs.length > 0 && outputs.every(enabled => !enabled);
  const allOn = outputs.length > 0 && outputs.every(Boolean);
  setText("servoPowerLabel", masterOutputsOff ? "OFF" : allOn ? "ON" : "MIXED");
  allServosOffButton.setAttribute("aria-pressed", String(allOn));
  const action = masterOutputsOff ? "Switch on all servo PWM outputs" : "Switch off all servo PWM outputs";
  allServosOffButton.setAttribute("aria-label", action);
  allServosOffButton.title = action;
  allServosOffButton.disabled = controllerRebooting || servoControls.some(control => control.powerPending);
}

function simulatedPowerKey() {
  return "servoSimulationPower:" + currentRobotName;
}

function rememberSimulatedServoPower() {
  if (!offlineSimulation || !robotPersisted || !servoPreview) return;
  const outputs = servoControls.map(control => {
    const node = servoPreview.servoNodes[control.channel - 1];
    const index = servoPreview.nodes.indexOf(node);
    const config = servoPreview.configuration.components[index];
    return config ? { name: config.name, address: Number(config.address), channel: config.channel, enabled: control.outputEnabled } : null;
  }).filter(Boolean);
  try { sessionStorage.setItem(simulatedPowerKey(), JSON.stringify(outputs)); } catch (_) { /* Storage may be disabled. */ }
}

function restoreSimulatedServoPower() {
  if (!offlineSimulation || !robotPersisted || !servoPreview) return;
  let saved;
  try { saved = JSON.parse(sessionStorage.getItem(simulatedPowerKey())); } catch (_) { return; }
  if (!Array.isArray(saved)) return;
  servoControls.forEach(control => {
    const node = servoPreview.servoNodes[control.channel - 1];
    const config = servoPreview.configuration.components[servoPreview.nodes.indexOf(node)];
    const state = config && saved.find(output => output && output.name === config.name && output.address === Number(config.address) && output.channel === config.channel);
    if (!state || typeof state.enabled !== "boolean") return;
    control.outputEnabled = node.outputEnabled = state.enabled;
    syncServoPower(control);
    setText("servoStatus" + control.channel, !state.enabled ? "Off" : control.muted ? "Muted" : "Simulated");
  });
  syncMasterPower();
  drawServoPreview();
}

async function setServoPower(control, enabled) {
  if (!control.ready || control.powerPending) return;
  const previous = control.outputEnabled;
  control.outputEnabled = enabled;
  control.powerPending = true;
  control.powerRevision += 1;
  control.pendingCommand = null;
  if (control.timer !== null) {
    clearTimeout(control.timer);
    control.timer = null;
  }
  syncServoPower(control);
  syncMasterPower();
  try {
    // Finish requests already in flight before changing the output state.
    await requestServo(control, { outputEnabled: enabled ? "1" : "0" });
    setText("servoMessage" + control.channel, "");
  } catch (error) {
    control.outputEnabled = previous;
    setText("servoMessage" + control.channel, "Power command failed: " + error.message);
  } finally {
    control.powerPending = false;
    control.powerRevision += 1;
    syncServoPower(control);
    syncMasterPower();
  }
}

allServosOffButton.addEventListener("click", () => {
  stopSweep();
  stopSequence();
  const enabled = masterOutputsOff;
  if (typeof componentPanels !== "undefined") componentPanels.setPower(enabled);
  servoControls.forEach(control => setServoPower(control, enabled));
  syncMasterPower();
  drawServoPreview();
});

function setControllerOnline(online) {
  const tab = document.getElementById("mixerTab");
  const connected = !!online && !offlineSimulation && !controllerRebooting;
  tab.classList.toggle("is-online", connected);
  tab.setAttribute("aria-description", connected ? "Robot online" : "Robot offline or not connected");
}

async function refresh() {
  if (offlineSimulation || controllerRebooting) return;
  const modeRevision = commandModeRevision;
  const colorRevision = ledColorRevision;
  const powerRevisions = servoControls.map(control => control.powerRevision);
  try {
    const response = await fetch("/api/status", { cache: "no-store", signal: AbortSignal.timeout(3000) });
    if (!response.ok) throw new Error("HTTP " + response.status);
    const status = await response.json();
    if (controllerRebooting) return;
    lastDeviceUptime = status.device.uptimeSeconds;
    if (modeRevision !== commandModeRevision) return;
    sensorTelemetry = status.sensors ?? null;
    sensorTelemetryAt = performance.now();
    if (colorRevision === ledColorRevision) setPreviewLedColor(status.led?.rgb, false);
    updateServoPreview(status.servos);
    setControllerOnline(status.wifi.connected);
    setText("connection", status.wifi.connected ? "Online" : "Wi-Fi disconnected");
    setText("chipId", status.device.chipId);
    setText("cpu", status.device.cpuMHz + " MHz");
    setText("sdk", status.device.sdk);
    setText("core", status.device.core);
    setText("resetReason", status.device.resetReason);
    setText("uptime", status.device.uptimeSeconds + " s");
    setText("heap", formatMegabytes(status.device.freeHeap));
    setText("largestBlock", formatMegabytes(status.device.largestFreeBlock));
    setText("fragmentation", status.device.heapFragmentation + "%");
    setText("flashSize", formatMegabytes(status.device.flashSize));
    setText("sketchSize", formatMegabytes(status.device.sketchSize));
    setText("otaSpace", formatMegabytes(status.device.freeOtaSpace));
    setText("ssid", status.wifi.ssid || "—");
    setText("ip", status.wifi.ip);
    setText("rssi", status.wifi.connected ? status.wifi.rssi + " dBm" : "—");
    setText("mac", status.wifi.mac);

    for (const control of servoControls) {
      const servo = status.servos[control.channel - 1];
      if (!servo || servo.id !== control.channel) {
        control.ready = false;
        updateServoPositionTrail(control, NaN);
        setText("servoStatus" + control.channel, "Unavailable");
        control.slider.disabled = true;
        control.muteButton.disabled = true;
        control.soloButton.disabled = true;
        control.motionButton.disabled = true;
        control.speedButton.disabled = true;
        control.reverseButton.disabled = true;
        syncServoPower(control);
        continue;
      }
      if (Number.isFinite(servo.minAngle) && Number.isFinite(servo.maxAngle)) {
        control.minAngle = servo.minAngle; control.maxAngle = servo.maxAngle;
        const [minimum, maximum] = servoCommandLimits(control);
        control.slider.min = String(minimum); control.slider.max = String(maximum);
        syncReverse(control);
      }
      control.ready = servo.ready;
      control.reportedAngle = servo.angleDegrees;
      updateServoPositionTrail(control, servo.angleDegrees);
      control.name = servo.name;
      if (!control.powerPending && powerRevisions[control.channel - 1] === control.powerRevision) {
        control.outputEnabled = servo.outputEnabled !== false;
      }
      syncServoPower(control);
      setText("servoStatus" + control.channel,
        !servo.ready ? "Unavailable" : !control.outputEnabled ? "Off" :
          servo.enabled ? "Active" : "Muted");
      setText("angle" + control.channel, servo.ready ? servoCommandText(control, servo.angleDegrees) : "Unavailable");
      setText("pulse" + control.channel, servo.ready ? servo.pulseMicroseconds + " µs" : "—");
      control.slider.disabled = !servo.ready || sequencePlaying || sequenceApplying;
      control.muteButton.disabled = controllerRebooting || !servo.ready || (sequenceApplying && !sequencePlaying);
      control.soloButton.disabled = controllerRebooting || !servo.ready || (sequenceApplying && !sequencePlaying);
      control.motionButton.disabled = !servo.ready || sequencePlaying || sequenceApplying;
      control.speedButton.disabled = !servo.ready || sequencePlaying || sequenceApplying;
      control.reverseButton.disabled = !servo.ready || sequencePlaying || sequenceApplying;
      if (document.activeElement !== control.slider && servo.ready) {
        control.slider.value = servo.angleDegrees;
      }
    }
    syncMasterPower();
    updateSequencerControls();
    setText("updated", "Last updated: " + new Date().toLocaleTimeString());
    setText("connectionError", "");
  } catch (error) {
    if (controllerRebooting || modeRevision !== commandModeRevision) return;
    setOfflineSimulation(true);
    const reason = error.name === "TimeoutError" ? "Request timed out after 3 seconds" : error.message || String(error);
    setText("connectionError", "Connection failed (/api/status): " + reason + ". Switched to offline simulation.");
  }
}

async function refreshLog() {
  if (offlineSimulation || controllerRebooting) return;
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
    if (location.hostname === "127.0.0.1" || location.hostname === "localhost") {
      try {
        const response = await fetch("/api/devserver", { signal: AbortSignal.timeout(1500) });
        if (response.ok) localConfigServer = (await response.json()).localConfigServer === true;
      } catch (_) { /* Other local static servers retain the download workflow. */ }
    }
    try {
      const response = await fetch("/api/robots", { cache: "no-store" });
      if (response.ok) {
        const folders = await response.json();
        robotStorageAvailable = true;
        currentRobotName = folders.active;
        robotRequiresRestart = folders.runtime !== undefined && folders.runtime !== folders.active;
        robotFolders = folders.robots;
        updateRobotFolderControls();
      }
    } catch (_) { /* Older firmware has no robot-folder API. */ }
    let configuration;
    try {
      const response = await fetch("./config.json" + robotQuery(), { cache: "no-store", signal: AbortSignal.timeout(3000) });
      if (!response.ok) throw new Error("HTTP " + response.status + ": " + (await response.text()).slice(0, 300));
      configuration = await response.json();
    } catch (error) {
      throw new Error("Could not load " + (currentRobotName || "config.json") + ": " + error.message);
    }
    if (!Array.isArray(configuration.components) || configuration.components.length > 60 ||
        configuration.components.some(component => !componentRegistry.hasType(component.objectType ?? "Servo"))) {
      throw new Error("Config must contain at most 60 supported robot, servo, bracket, sensor or hardware components.");
    }
    const servoConfigurations = configuration.components.filter(component => componentRegistry.hasCapability(component, "actuator"));
    if (!Array.isArray(configuration.components) ||
      servoConfigurations.length > 20 ||
      servoConfigurations.some(servo =>
        typeof servo.name !== "string" ||
        (servo.continuous !== undefined && typeof servo.continuous !== "boolean") ||
        (servo.initialMotionMode !== undefined &&
          servo.initialMotionMode !== "immediate" &&
          servo.initialMotionMode !== "smooth" && servo.initialMotionMode !== "linear"))) {
      throw new Error(
        "config.json components must define 0-20 named servos and use an optional initialMotionMode of \"immediate\", \"smooth\" or \"linear\".");
    }
    const outputs = new Map();
    servoConfigurations.forEach(servo => {
      const key = Number(servo.address) + ":" + servo.channel;
      if (outputs.has(key)) {
        throw new Error(outputs.get(key) + " and " + servo.name +
          " share PCA9685 address " + servo.address + ", channel " + servo.channel + ". Use a unique output for each servo.");
      }
      outputs.set(key, servo.name);
    });
    try { localStorage.setItem("servoPreviewConfig:" + currentRobotName, JSON.stringify(configuration)); } catch (_) { /* Storage may be disabled. */ }
    controllerConfiguration = configuration;
    initializeServoControls(servoConfigurations);
    initializeServoPreview(configuration.components, configuration);
    renderSequence();
    if (robotRequiresRestart) {
      setOfflineSimulation(true);
      document.getElementById("previewOffline").disabled = true;
      document.getElementById("rebootButton").disabled = false;
      setText("connection", "Robot changed - restart controller to use this robot on hardware.");
    }
    if (localConfigServer) {
      setOfflineSimulation(true);
      restoreSimulatedServoPower();
      document.getElementById("previewOffline").disabled = true;
      setText("connection", "Local setup — Save robot writes data/config.json on this PC.");
      selectTab(1);
      sequenceLoaded = false;
      updateSequencerControls();
      try { await loadSequence(); }
      catch (error) {
        setText("sequencerStatus", "Could not load local sequence");
        setText("sequencerError", error.message);
      }
      return;
    }
    try {
      await loadSequence();
    } catch (error) {
      setText("sequencerStatus", "Could not load saved sequence");
      setText("sequencerError", error.message);
      renderSequence();
    }
    await refresh();
    await refreshLog();
    setInterval(refresh, 1000);
    setInterval(refreshLog, 1000);
  } catch (error) {
    resetUnavailableConfiguration(error);

  }
}

function resetUnavailableConfiguration(error) {
  stopSweep(); stopSequence();
  commandModeRevision += 1;
  offlineSimulation = true;
  setControllerOnline(false);
  sensorTelemetry = null;
  servoControls.forEach(control => { clearTimeout(control.timer); control.strip.remove(); });
  servoControls = [];
  servoSettingsDirty = false;
  editedServoIndex = -1;
  robotPersisted = false;
  let suffix = 1;
  while (robotFolders.includes("Recovered Robot " + suffix)) suffix++;
  currentRobotName = "Recovered Robot " + suffix;
  const configuration = configurationWithRobot({ components: [{
    name: "Servo 1", objectType: "Servo", ...componentRegistry.withCapability("actuator").defaults,
    address: "0x40", channel: 0, enabled: true, reversed: false, continuous: false,
    initialMotionMode: "smooth", startupAngle: 90, minAngle: 0, maxAngle: 180,
    minPulseMicroseconds: 500, maxPulseMicroseconds: 2500, parent: null,
    position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }
  }] });
  controllerConfiguration = configuration;
  initializeServoControls(configuration.components.filter(component => componentRegistry.hasCapability(component, "actuator")));
  initializeServoPreview(configuration.components, configuration);
  if (servoPreview) {
    servoPreview.savedNames = [];
    servoPreview.nodes.forEach(node => { node.originalName = null; node.outputEnabled = false; });
  }
  simulationSequences.clear();
  sequence = { loop: false, finish: true, steps: [] };
  sequenceLoaded = true;
  renderSequence(); updateSequencerControls();
  document.getElementById("previewOffline").setAttribute("aria-pressed", "true");
  document.getElementById("previewOffline").disabled = true;
  document.getElementById("rebootButton").disabled = true;
  updateRobotFolderControls();
  selectTab(3);
  setText("connection", "Offline draft — configuration reset");
  setText("connectionError", error.message + ". Reset to a new offline draft. Load another robot or use Save robot; stored robots were not changed.");
}

// Simulation shares the command path, but never posts requests to the device.
document.getElementById("previewOffline").addEventListener("click", () => setOfflineSimulation(!offlineSimulation));

function setOfflineSimulation(enabled) {
  if (enabled || offlineSimulation !== enabled) setControllerOnline(false);
  document.getElementById("previewOffline").setAttribute("aria-pressed", String(enabled));
  if (offlineSimulation !== enabled) globalThis.GhostLearning?.stopEnvironment();
  if (offlineSimulation === enabled) return;
  setText("connectionError", "");
  sensorTelemetry = null;
  stopSweep();
  stopSequence();
  commandModeRevision += 1;
  offlineSimulation = enabled;
  document.getElementById("rebootButton").disabled = enabled || controllerRebooting;
  servoControls.forEach((control, index) => {
    clearTimeout(control.timer);
    control.timer = null;
    control.pendingCommand = null;
    control.commandedMotion = null;
    control.ready = enabled;
    control.positionStart = undefined;
    updateServoPositionTrail(control, NaN);
    if (servoPreview) {
      const node = servoPreview.servoNodes[index];
      node.motion = null;
      node.ready = enabled;
      node.outputEnabled = control.outputEnabled;
      node.enabled = !control.muted;
      control.slider.value = node.angle;
      updateServoPositionTrail(control, node.angle);
    }
    syncServoPower(control);
    setText("servoStatus" + control.channel, enabled ? (!control.outputEnabled ? "Off" : control.muted ? "Muted" : "Simulated") : "Connecting");
    setText("pulse" + control.channel, "�");
  });
  syncMasterPower();
  if (enabled) sequenceLoaded = true;
  setServoPlaybackLock(false);
  updateSequencerControls();
  setText("connection", enabled ? "Offline simulation" : "Connecting to device�");
  setText("previewStatus", enabled ? "Offline simulation � controls update this view only." : "Waiting for device angles.");
  drawServoPreview();
  if (!enabled) refresh();
}

function simulateServoRequest(control, request, deferDraw = false, startedAt = performance.now()) {
  if (!servoPreview) return;
  const node = servoPreview.servoNodes[control.channel - 1];
  if (node.continuous && !deferDraw) tickServoSimulation();
  if (request.outputEnabled !== undefined) {
    node.outputEnabled = request.outputEnabled === "1";
    if (!node.outputEnabled) node.motion = null;
    rememberSimulatedServoPower();
  }
  if (request.enabled !== undefined) {
    node.enabled = request.enabled === "1";
    if (!node.enabled) node.motion = null;
  }
  if (request.angle !== undefined && node.outputEnabled && node.enabled) {
    control.positionStart = node.angle;
    const target = clampServoCommand(control, request.angle);
    const mode = request.motionMode ?? (request.smooth === "1" ? "smooth" : "immediate");
    const smooth = mode === "smooth";
    const multiplier = request.speed === "L" ? 4 : request.speed === "M" ? 2 : 1;
    const fullRangeDuration = 1000 * multiplier * (smooth ? 1.5 : 1);
    const duration = mode === "linear" && Number(request.durationMs) > 0
      ? Math.max(1, Math.ceil(Number(request.durationMs) / (Number(request.playbackRate) || 1)))
      : Math.max(50, Math.ceil(Math.abs(target - node.angle) * fullRangeDuration / (180 * (Number(request.playbackRate) || 1))));
    node.motion = target === node.angle || mode === "immediate" ? null : { start: node.angle, target, duration, smooth, at: startedAt };
    if (!node.motion) node.angle = target;
  }
  setText("servoStatus" + control.channel, !node.outputEnabled ? "Off" : !node.enabled ? "Muted" : "Simulated");
  if (!deferDraw) tickServoSimulation();
}

function tickServoSimulation() {
  if (!servoPreview) return;
  cancelAnimationFrame(servoPreview.frame);
  const now = performance.now();
  const elapsed = servoPreview.animationAt === undefined ? 0 : Math.min(0.25, (now - servoPreview.animationAt) / 1000);
  servoPreview.animationAt = now;
  let moving = false;
  servoPreview.servoNodes.forEach((node, index) => {
    if (offlineSimulation && node.motion) {
      const motion = node.motion;
      const t = Math.min(1, (performance.now() - motion.at) / motion.duration);
      const progress = motion.smooth ? t * t * (3 - 2 * t) : t;
      node.angle = motion.start + (motion.target - motion.start) * progress;
      if (t === 1) node.motion = null;
      else moving = true;
    }
    if (node.continuous && node.ready && node.enabled && node.outputEnabled && Math.abs(node.angle - 90) > 0.001) {
      // Approximate visual speed: 60 RPM at full command, independent of load.
      node.spinAngle = ((node.spinAngle + (node.angle - 90) / 90 * 360 * elapsed) % 360 + 360) % 360;
      moving = true;
    }
    if (offlineSimulation) {
      updateServoPositionTrail(servoControls[index], node.angle);
      setText("angle" + (index + 1), servoCommandText(node, node.angle));
    }
  });
  drawServoPreview();
  if (moving) servoPreview.frame = requestAnimationFrame(tickServoSimulation);
}

// Small software 3D renderer: local assets only, no GPU/library dependency.
let servoPreview = null;
function loadPreviewCamera(configuration = {}) {
  try {
    const camera = configuration.camera || JSON.parse(localStorage.getItem("servoPreviewCamera"));
    if (!camera || ![camera.yaw, camera.pitch, camera.zoom].every(Number.isFinite)) return {};
    return { yaw: camera.yaw, pitch: clampPreviewPitch(camera.pitch), roll: Number.isFinite(camera.roll) ? camera.roll : 0,
      zoom: Math.max(0.001, Math.min(5, camera.zoom)),
      panX: Number.isFinite(camera.panX) ? camera.panX : 0,
      panY: Number.isFinite(camera.panY) ? camera.panY : 150,
      panZ: Number.isFinite(camera.panZ) ? camera.panZ : 0, perspective: camera.perspective === true, showGrid: camera.showGrid !== false };
  } catch (_) {
    return {};
  }
}

function savePreviewCamera() {
  if (!servoPreview) return;
  const { yaw, pitch, roll, zoom, panX, panY, panZ, perspective, showGrid } = servoPreview;
  try { localStorage.setItem("servoPreviewCamera", JSON.stringify({ yaw, pitch, roll, zoom, panX, panY, panZ, perspective, showGrid })); }
  catch (_) { /* Camera controls still work when browser storage is unavailable. */ }
}

function currentUserCameraView() {
  const { yaw, pitch, roll, zoom, panX, panY, panZ, perspective } = servoPreview;
  return { yaw, pitch, roll: roll || 0, zoom, panX, panY, panZ, perspective };
}

function validUserCameraView(view) {
  return view && ["yaw", "pitch", "roll", "zoom", "panX", "panY", "panZ"].every(key => Number.isFinite(view[key])) &&
    Math.abs(view.pitch) <= Math.PI / 2 && view.zoom >= 0.001 && view.zoom <= 5 && typeof view.perspective === "boolean";
}

function updateUserCameraButtons() {
  if (!servoPreview) return;
  const current = currentUserCameraView();
  document.querySelectorAll("[data-user-view]").forEach(button => {
    const saved = servoPreview.userViews?.[button.dataset.userView];
    const active = !!saved && Object.keys(current).every(key => typeof current[key] === "number"
      ? Math.abs(current[key] - saved[key]) < 0.000001 : current[key] === saved[key]);
    button.setAttribute("aria-pressed", String(active));
  });
}

function initializeUserCameraViews(configuration) {
  servoPreview.userViews = {};
  for (const slot of ["u1", "u2", "u3"]) {
    const saved = configuration.camera?.views?.[slot];
    if (validUserCameraView(saved)) servoPreview.userViews[slot] = Object.fromEntries(Object.keys(currentUserCameraView()).map(key => [key, saved[key]]));
  }
  document.querySelectorAll("[data-user-view]").forEach(button => {
    button.addEventListener("click", event => {
      const slot = button.dataset.userView;
      if (event.shiftKey) {
        if (document.getElementById("previewSave").disabled) return;
        servoPreview.userViews[slot] = currentUserCameraView();
        updateUserCameraButtons();
        setText("previewSaveStatus", slot.toUpperCase() + " stored. Use Save robot in Setup to keep this view.");
        return;
      }
      const saved = servoPreview.userViews[slot];
      if (!saved) {
        setText("previewSaveStatus", slot.toUpperCase() + " has no saved view. Shift-click its button to store the current view.");
        return;
      }
      animatePreviewCamera(saved);
      setText("previewStatus", "View " + slot.toUpperCase());
    });
  });
  updateUserCameraButtons();
}

let previewPhysics = null;
let previewPhysicsEnabled = false;
let previewPhysicsDebug = false;
let previewPhysicsFrame = 0;
let previewPhysicsRun = 0;
let physicsControlsReady = false;

function collectPreviewPhysicsShapes(nodes = servoPreview.nodes) {
  return GhostRig.forRegistry(componentRegistry).physicsShapes(nodes);
}

function collectPreviewPhysicsNodes(nodes = servoPreview.nodes) {
  return GhostRig.forRegistry(componentRegistry).physicsNodes(nodes);
}

function syncPreviewPhysics() {
  if (!previewPhysics || !servoPreview) return;
  const topology = servoPreview.nodes.map(node => [node.objectType, node.model, node.parent, node.massGrams ?? "auto", JSON.stringify(componentRegistry.settings(node)), ...node.position, ...node.rotation, JSON.stringify(node.constraints || {}), JSON.stringify(node.rotationConstraints || {})].join(":")).join("|");
  previewPhysics.syncRobot(collectPreviewPhysicsNodes(), collectPreviewPhysicsShapes(), topology);
}

function updatePhysicsControls() {
  document.getElementById("previewPhysics").setAttribute("aria-pressed", String(!!previewPhysics && previewPhysicsEnabled));
  ["physicsDrop", "physicsClear", "physicsDebug", "physicsResetRobot"].forEach(id => {
    document.getElementById(id).disabled = !previewPhysics || !previewPhysicsEnabled;
  });
}

async function initializePreviewPhysics(activate = false) {
  if (document.getElementById("previewPhysics").disabled) return;
  if (!physicsControlsReady) {
    physicsControlsReady = true;
    document.getElementById("previewPhysics").addEventListener("click", () => {
      if (!previewPhysics) { initializePreviewPhysics(true); return; }
      previewPhysicsEnabled = !previewPhysicsEnabled;
      updatePhysicsControls();
      setText("physicsStatus", previewPhysicsEnabled ? "Rapier running" : "Rapier paused");
    });
    document.getElementById("physicsDrop").addEventListener("click", () => {
      if (!previewPhysics || !previewPhysicsEnabled) return;
      syncPreviewPhysics();
      previewPhysics.dropCube([servoPreview.panX, Math.max(150, servoPreview.panY + 150), servoPreview.panZ]);
      drawServoPreview();
    });
    document.getElementById("physicsResetRobot").addEventListener("click", () => {
      if (!previewPhysics) return;
      previewPhysics.resetRobot(); syncPreviewPhysics(); drawServoPreview();
      setText("physicsStatus", "Robot reset to configured pose; root is free");
    });
    document.getElementById("physicsClear").addEventListener("click", () => { previewPhysics?.clear(); drawServoPreview(); });
    document.getElementById("physicsDebug").addEventListener("click", () => {
      previewPhysicsDebug = !previewPhysicsDebug;
      document.getElementById("physicsDebug").setAttribute("aria-pressed", String(previewPhysicsDebug));
      drawServoPreview();
    });
    window.addEventListener("pagehide", () => {
      previewPhysicsRun++;
      cancelAnimationFrame(previewPhysicsFrame);
      previewPhysics?.destroy(); previewPhysics = null;
      document.getElementById("previewPhysics").disabled = false;
      updatePhysicsControls();
    });
  }
  if (!activate) {
    updatePhysicsControls();
    setText("physicsStatus", "Physics disabled. Click Physics to enable.");
    return;
  }
  const run = ++previewPhysicsRun;
  const button = document.getElementById("previewPhysics");
  button.disabled = true;
  setText("physicsStatus", "Loading Rapier from CDN…");
  let timeout;
  try {
    const RAPIER = await Promise.race([GhostPhysics.load(), new Promise((_, reject) => {
      timeout = setTimeout(() => reject(new Error("CDN timed out; click Physics to retry")), 20000);
    })]);
    if (run !== previewPhysicsRun) return;
    previewPhysics = GhostPhysics.create(RAPIER);
    previewPhysicsEnabled = true;
    syncPreviewPhysics();
    setText("physicsStatus", "Rapier ready — robot is free-standing; no root is pinned");
    let previousTime = null;
    const frame = time => {
      if (run !== previewPhysicsRun) return;
      previewPhysicsFrame = requestAnimationFrame(frame);
      if (!previewPhysicsEnabled || !servoPreview?.active || document.hidden || !servoPreview.canvas.getClientRects().length) {
        previousTime = null; return;
      }
      try {
        syncPreviewPhysics();
        previewPhysics.advance(previousTime === null ? 0 : (time - previousTime) / 1000);
        previousTime = time;
        drawServoPreview();
      } catch (error) {
        previewPhysicsEnabled = false; updatePhysicsControls();
        setText("physicsStatus", "Rapier paused: " + error.message);
      }
    };
    previewPhysicsFrame = requestAnimationFrame(frame);
  } catch (error) {
    if (run === previewPhysicsRun) {
      previewPhysics?.destroy(); previewPhysics = null;
      setText("physicsStatus", "Rapier unavailable: " + error.message + ". Click Physics to retry.");
    }
  } finally {
    clearTimeout(timeout);
    if (run === previewPhysicsRun) { button.disabled = false; updatePhysicsControls(); }
  }
}

function configurationWithRobot(configuration) {
  const config = JSON.parse(JSON.stringify(configuration));
  if (!Array.isArray(config.components)) return config;
  config.components.forEach(component => {
    if (component.shopProductId === undefined) component.shopProductId = componentRegistry.resolve(component)?.defaults?.shopProductId ?? null;
  });
  if (config.servoController && config.servoController.shopProductId === undefined) config.servoController.shopProductId = componentRegistry.withCapability("servoController")?.defaults?.shopProductId ?? null;
  if (config.components.some(component => componentRegistry.hasCapability(component, "root"))) return config;
  if (config.components.length >= 60) throw new Error("Make room for the Robot board; at most 60 components are supported.");
  let name = "Robot", suffix = 1;
  while (config.components.some(component => component.name === name)) name = "Robot " + suffix++;
  config.components.forEach((component, index) => {
    if (component.position === undefined) component.position = { x: (index - (config.components.length - 1) / 2) * 65, y: 0, z: 0 };
    if (component.parent == null) component.parent = name;
  });
  config.components.push({ name, objectType: componentRegistry.withCapability("root").objectType, ...componentRegistry.withCapability("root").defaults, parent: null,
    position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 } });
  return config;
}

function createRobotNodes(configuration) {
  if (!configuration || !Array.isArray(configuration.components) || configuration.components.length > 60) {
    throw new Error("Robot must contain at most 60 components.");
  }
  const configurations = configuration.components;
  const servos = configurations.filter(component => component && componentRegistry.hasCapability(component, "actuator"));
  if (servos.length > 20) throw new Error("Robot must contain 0-20 servos.");
  const outputs = new Set();
  servos.forEach(servo => {
    const address = Number(servo.address);
    if (!Number.isInteger(address) || address < 3 || address > 119 ||
        !Number.isInteger(servo.channel) || servo.channel < 0 || servo.channel > 15) {
      throw new Error("Each servo requires a valid PCA9685 address and channel (0-15).");
    }
    const output = address + ":" + servo.channel;
    if (outputs.has(output)) throw new Error("Servo outputs must be unique.");
    outputs.add(output);
  });
    const vector = (value, fallback) => {
      if (value === undefined) return fallback;
      if (!value || !["x", "y", "z"].every(axis => Number.isFinite(value[axis]))) {
        throw new Error("Position and rotation require finite x, y and z numbers.");
      }
      return [value.x, value.y, value.z];
    };
    const servoNames = new Map();
    configurations.forEach((config, index) => {
      if (typeof config.name !== "string" || !config.name.trim()) throw new Error("Each component requires a name.");
      if (servoNames.has(config.name)) throw new Error("Component names must be unique for parent references.");
      servoNames.set(config.name, index + 1);
    });
    const nodes = configurations.map((config, index) => {
      const parentName = config.parent === undefined ? null : config.parent;
      if (parentName !== null && (typeof parentName !== "string" ||
          !servoNames.has(parentName) || parentName === config.name)) {
        throw new Error("Parent must be null or another component's exact name.");
      }
      // Resolve names once; rendering and cycle checks use internal node indices.
      const parent = parentName === null ? null : servoNames.get(parentName);
      const objectType = config.objectType ?? "Servo";
      if (!componentRegistry.hasType(objectType)) throw new Error("Unknown component objectType.");
      if (config.constraints !== undefined && (!componentRegistry.hasCapability(config, "constraints") || !config.constraints || typeof config.constraints !== "object" || Array.isArray(config.constraints) ||
          Object.entries(config.constraints).some(([axis, limit]) => !["x", "y", "z"].includes(axis) || !limit || typeof limit.enabled !== "boolean" ||
            !Number.isFinite(limit.min) || !Number.isFinite(limit.max) || limit.min > limit.max))) throw new Error("Invalid Null axis constraints.");
      if (config.rotationConstraints !== undefined && (!componentRegistry.hasCapability(config, "constraints") || !config.rotationConstraints || typeof config.rotationConstraints !== "object" || Array.isArray(config.rotationConstraints) ||
          Object.entries(config.rotationConstraints).some(([axis, locked]) => !["x", "y", "z"].includes(axis) || typeof locked !== "boolean"))) throw new Error("Invalid Null rotation constraints.");
      if (config.massGrams !== undefined && (!Number.isFinite(config.massGrams) || config.massGrams <= 0)) throw new Error("Mass must be a positive number in grams.");
      for (const key of ["minPowerWatts", "maxPowerWatts"]) {
        if (config[key] != null && (!Number.isFinite(config[key]) || config[key] < 0)) throw new Error("Power must be a nonnegative number in watts, or blank.");
      }
      if (config.minPowerWatts != null && config.maxPowerWatts != null && config.minPowerWatts > config.maxPowerWatts) throw new Error("Minimum power must not exceed maximum power.");
      for (const key of ["powerVoltageVolts", "idleCurrentAmps", "runningCurrentAmps", "peakCurrentAmps"]) {
        if (config[key] != null && (!Number.isFinite(config[key]) || (key === "powerVoltageVolts" ? config[key] <= 0 : config[key] < 0))) throw new Error("Voltage must be positive; current must be nonnegative.");
      }
      if (config.idleCurrentAmps != null && config.peakCurrentAmps != null && config.idleCurrentAmps > config.peakCurrentAmps) throw new Error("Idle current must not exceed peak current.");
      if (config.runningCurrentAmps != null && ((config.idleCurrentAmps != null && config.runningCurrentAmps < config.idleCurrentAmps) || (config.peakCurrentAmps != null && config.runningCurrentAmps > config.peakCurrentAmps))) throw new Error("Running current must be between idle and peak current.");
      const model = config.model === undefined ? "standard" : config.model;
      if (!componentRegistry.resolve({ objectType, model })) throw new Error("Unknown component model.");
      return { ...componentRegistry.settings(config), name: config.name, originalName: config.name, parent, model, objectType, powerVoltageVolts: config.powerVoltageVolts ?? null, idleCurrentAmps: config.idleCurrentAmps ?? null, runningCurrentAmps: config.runningCurrentAmps ?? null, peakCurrentAmps: config.peakCurrentAmps ?? null, minPowerWatts: config.minPowerWatts ?? null, maxPowerWatts: config.maxPowerWatts ?? null, massGrams: config.massGrams, constraints: config.constraints ? JSON.parse(JSON.stringify(config.constraints)) : undefined, rotationConstraints: config.rotationConstraints ? { ...config.rotationConstraints } : undefined, continuous: config.continuous === true, minAngle: config.minAngle ?? 0, maxAngle: config.maxAngle ?? 180, spinAngle: 90,
        position: vector(config.position, [(index - (configurations.length - 1) / 2) * 65, 0, 0]),
        rotation: vector(config.rotation, [0, 0, 0]), angle: clampServoCommand(config, config.startupAngle ?? 90),
        ready: false, outputEnabled: false, enabled: config.enabled !== false };
    });
    nodes.forEach((node, index) => {
      const seen = new Set([index + 1]);
      for (let parent = node.parent; parent !== null; parent = nodes[parent - 1].parent) {
        if (seen.has(parent)) throw new Error("Servo parents must not form a cycle.");
        seen.add(parent);
      }
    });
  return nodes;
}

function initializeServoPreview(configurations, configuration = { components: configurations }) {
  globalThis.GhostLearning?.stopEnvironment();
  const canvas = document.getElementById("servoScene");
  const button = document.getElementById("previewToggle");
  try {
    const persistedNames = configurations.map(component => component.name);
    configuration = configurationWithRobot(configuration);
    const nodes = createRobotNodes(configuration);
    nodes.forEach(node => { if (!persistedNames.includes(node.name)) node.originalName = null; });
    servoPreview = { nodes, servoNodes: nodes.filter(node => componentRegistry.hasCapability(node, "actuator")), canvas, yaw: -0.6, pitch: 0.45, roll: 0, zoom: 1, panX: 0, panY: 150, panZ: 0, active: true, frame: 0, selected: null, perspective: false, editing: false, showLabels: false, showGrid: true, configuration };
    Object.assign(servoPreview, loadPreviewCamera(configuration));
    servoPreview.frameAllPending = true;
    setText("controllerRobotName", currentRobotName || nodes.find(node => componentRegistry.hasCapability(node, "root"))?.name || "Robot");
    initializeUserCameraViews(configuration);
    const webcam = configuration.camera?.webcam || {};
    selectedWebcamDevice = typeof webcam.deviceId === "string" ? webcam.deviceId : "";
    savedWebcamControls = { ...(webcam.controls || {}) };
    webcamVideo.style.objectFit = webcam.fit === "contain" ? "contain" : "cover";
    webcamVideo.style.transform = webcam.mirror === true ? "scaleX(-1)" : "";
    updatePreviewProjectionButton();
    const gridButton = document.getElementById("previewGrid");
    gridButton.setAttribute("aria-pressed", String(servoPreview.showGrid));
    gridButton.addEventListener("click", () => {
      servoPreview.showGrid = !servoPreview.showGrid;
      gridButton.setAttribute("aria-pressed", String(servoPreview.showGrid));
      savePreviewCamera();
      drawServoPreview();
    });
    previewReady = true;
    servoPreview.savedNames = persistedNames;
    initializePreviewPlacementControls();
    const labelsButton = document.getElementById("previewLabels");
    labelsButton.setAttribute("aria-pressed", String(servoPreview.showLabels));
    labelsButton.addEventListener("click", () => {
      servoPreview.showLabels = !servoPreview.showLabels;
      labelsButton.setAttribute("aria-pressed", String(servoPreview.showLabels));
      drawServoPreview();
    });
    document.getElementById("previewSave").addEventListener("click", savePreviewConfiguration);
    const headerSave = document.getElementById("setupSaveConfig");
    const robotSave = document.getElementById("previewSave");
    headerSave.addEventListener("click", () => robotSave.click());
    const syncHeaderSave = () => { headerSave.disabled = robotSave.disabled; };
    new MutationObserver(syncHeaderSave).observe(robotSave, { attributes: true, attributeFilter: ["disabled"] });
    syncHeaderSave();
    document.getElementById("previewDownload").addEventListener("click", downloadPreviewConfiguration);
    document.getElementById("previewNewRobot").addEventListener("click", newRobot);
    document.getElementById("previewLoadRobot").addEventListener("click", loadRobotFolder);
    document.getElementById("previewImportRobot").addEventListener("click", () => document.getElementById("robotFile").click());
    document.getElementById("robotFile").addEventListener("change", async event => {
      const file = event.target.files[0];
      if (!file) return;
      try {
        if (await replaceSetupRobot(JSON.parse(await file.text()), "Config imported. Name this robot and use Save robot to create its folder.")) {
          currentRobotName = file.name.replace(/\.json$/i, "").replace(/[^A-Za-z0-9 _-]/g, "_").slice(0, 40) || "Robot";
          robotPersisted = false;
          updateRobotFolderControls();
        }
      }
      catch (error) { setText("previewSaveStatus", "Load failed: " + error.message); }
      finally { event.target.value = ""; }
    });
    const draw = () => {
      savePreviewCamera();
      drawServoPreview();
    };
    button.addEventListener("click", () => {
      servoPreview.active = !servoPreview.active;
      document.getElementById("previewPanel").hidden = !servoPreview.active;
      ["mixerPanel", "servoSettingsPanel"].forEach(id => {
        document.getElementById(id).classList.toggle("preview-hidden", !servoPreview.active);
      });
      button.setAttribute("aria-expanded", String(servoPreview.active));
      button.textContent = servoPreview.active ? "Deactivate 3D view" : "Activate 3D view";
      draw();
    });
    document.getElementById("previewProjection").addEventListener("click", () => {
      servoPreview.perspective = !servoPreview.perspective;
      updatePreviewProjectionButton();
      draw();
    });
    document.getElementById("previewReset").addEventListener("click", () => {
      animatePreviewCamera(frameAllPreviewCamera());
    });
    document.getElementById("previewCameraViews").addEventListener("click", event => {
      const preset = event.target.closest("button[data-view]")?.dataset.view;
      const views = {
        left: [-Math.PI / 2, 0], right: [Math.PI / 2, 0],
        front: [0, 0], back: [Math.PI, 0],
        top: [0, Math.PI / 2], bottom: [0, -Math.PI / 2]
      };
      if (!views[preset]) return;
      animatePreviewCamera({ yaw: views[preset][0], pitch: views[preset][1] });
    });
    let drag = null;
    canvas.addEventListener("contextmenu", event => event.preventDefault());
    canvas.addEventListener("pointerdown", event => {
      if (drag || (event.button !== 0 && event.button !== 2)) return;
      event.preventDefault();
      cancelPreviewCameraFocus(event.button === 0);
      drag = { x: event.clientX, y: event.clientY, pan: event.button === 2, pointerId: event.pointerId };
      canvas.setPointerCapture(event.pointerId);
    });
    canvas.addEventListener("pointermove", event => {
      if (!drag || drag.pointerId !== event.pointerId) return;
      const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
      if (drag.pan) {
        panPreviewFloor(dx, dy);
      } else {
        servoPreview.yaw += dx * 0.01;
        servoPreview.pitch = clampPreviewPitch(servoPreview.pitch + dy * 0.01);
      }
      drag.x = event.clientX; drag.y = event.clientY;
      draw();
    });
    ["pointerup", "pointercancel", "lostpointercapture"].forEach(type => canvas.addEventListener(type, event => {
      if (drag && drag.pointerId === event.pointerId) drag = null;
    }));
    canvas.addEventListener("wheel", event => {
      cancelPreviewCameraFocus();
      event.preventDefault(); servoPreview.zoom = Math.max(0.001, Math.min(5, servoPreview.zoom * Math.exp(-event.deltaY * 0.001))); draw();
    }, { passive: false });
    canvas.addEventListener("keydown", event => {
      if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "+", "=", "-"].includes(event.key)) return;
      event.preventDefault();
      cancelPreviewCameraFocus(event.key.startsWith("Arrow"));
      if (event.key === "ArrowLeft") servoPreview.yaw -= 0.1;
      if (event.key === "ArrowRight") servoPreview.yaw += 0.1;
      if (event.key === "ArrowUp") servoPreview.pitch -= 0.1;
      if (event.key === "ArrowDown") servoPreview.pitch += 0.1;
      servoPreview.pitch = clampPreviewPitch(servoPreview.pitch);
      if (["+", "="].includes(event.key)) servoPreview.zoom *= 1.1;
      if (event.key === "-") servoPreview.zoom /= 1.1;
      servoPreview.zoom = Math.max(0.001, Math.min(5, servoPreview.zoom)); draw();
    });
    new ResizeObserver(draw).observe(canvas);
    initializePreviewPhysics();
    if (webcam.active === true) startWebcam();
  } catch (error) {
    servoPreview = null; button.disabled = true;
    document.getElementById("previewSave").disabled = true;
    document.getElementById("previewDownload").disabled = true;
    button.textContent = "3D configuration error: " + error.message;
  }
}

function previewConfigurationSnapshot() {
  const configuration = JSON.parse(JSON.stringify(servoPreview.configuration));
  servoPreview.nodes.forEach((node, index) => {
    const vector = values => ({ x: values[0], y: values[1], z: values[2] });
    Object.assign(configuration.components[index], componentRegistry.settings(node));
    configuration.components[index].name = node.name;
    configuration.components[index].parent = node.parent === null ? null : servoPreview.nodes[node.parent - 1].name;
    configuration.components[index].position = vector(node.position);
    configuration.components[index].rotation = vector(node.rotation);
    configuration.components[index].minPowerWatts = node.minPowerWatts ?? null;
    configuration.components[index].maxPowerWatts = node.maxPowerWatts ?? null;
    for (const key of ["powerVoltageVolts", "idleCurrentAmps", "runningCurrentAmps", "peakCurrentAmps"]) configuration.components[index][key] = node[key] ?? null;
    if (node.massGrams === undefined) delete configuration.components[index].massGrams;
    else configuration.components[index].massGrams = node.massGrams;
    if (componentRegistry.hasCapability(node, "constraints") && node.constraints) configuration.components[index].constraints = JSON.parse(JSON.stringify(node.constraints));
    if (componentRegistry.hasCapability(node, "constraints") && node.rotationConstraints) configuration.components[index].rotationConstraints = { ...node.rotationConstraints };
  });
  const { yaw, pitch, roll, zoom, panX, panY, panZ, perspective, showGrid } = servoPreview;
  configuration.camera = { yaw, pitch, roll: roll || 0, zoom, panX, panY, panZ, perspective, showGrid: showGrid !== false,
    views: JSON.parse(JSON.stringify(servoPreview.userViews || {})),
    webcam: {
      active: Boolean(webcamStream && !webcamVideo.hidden),
      deviceId: webcamStream?.getVideoTracks()[0]?.getSettings?.().deviceId || selectedWebcamDevice,
      fit: webcamVideo.style.objectFit === "contain" ? "contain" : "cover",
      mirror: webcamVideo.style.transform === "scaleX(-1)",
      controls: { ...savedWebcamControls }
    }
  };
  return configuration;
}

function updateRobotFolderControls() {
  setText("controllerRobotName", currentRobotName || servoPreview?.nodes.find(node => componentRegistry.hasCapability(node, "root"))?.name || "Robot");
  const name = document.getElementById("robotName");
  name.value = currentRobotName;
  name.readOnly = false;
  const folders = document.getElementById("robotFolders");
  folders.replaceChildren();
  robotFolders.forEach(folder => {
    const option = makeElement("option", "", folder);
    option.value = folder;
    folders.append(option);
  });
  folders.value = currentRobotName;
  document.getElementById("previewLoadRobot").disabled = !robotStorageAvailable || !robotFolders.length;
}

async function loadRobotFolder() {
  if (sequenceSaving || sequenceLoading || sequenceApplying || document.getElementById("previewSave").disabled) return;
  const name = document.getElementById("robotFolders").value;
  if (!name) return;
  try {
    const response = await fetch("/config.json?robot=" + encodeURIComponent(name), { cache: "no-store" });
    if (!response.ok) throw new Error(await response.text());
    const config = await response.json();
    createRobotNodes(config);
    const selected = await fetch("/api/robot/select", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
    if (!selected.ok) throw new Error(await selected.text());
    if (!await replaceSetupRobot(config, "Robot folder loaded. Restart the controller to use this robot on hardware.")) return;
    currentRobotName = name;
    robotPersisted = true;
    robotRequiresRestart = !localConfigServer;
    document.getElementById("rebootButton").disabled = localConfigServer;
    servoPreview.savedNames = config.components.map(component => component.name);
    servoPreview.nodes.forEach(node => { node.originalName = config.components.some(component => component.name === node.name) ? node.name : null; });
    updateRobotFolderControls();
    await loadSequence();
    updateSequencerControls();
  } catch (error) { setText("previewSaveStatus", "Load failed: " + error.message); }
}

async function replaceSetupRobot(configuration, message) {
  if (!servoPreview?.editing || controllerRebooting || document.getElementById("previewSave").disabled) return;
  if (sequenceLoading || sequenceSaving || sequenceApplying) {
    setText("previewSaveStatus", "Wait for the current sequence operation before loading a robot.");
    return;
  }
  configuration = configurationWithRobot(configuration);
  const nodes = createRobotNodes(configuration);
  const saveButton = document.getElementById("previewSave");
  saveButton.disabled = true;
  try {
    // Stop old playback and invalidate queued requests before replacing the mapping.
    setOfflineSimulation(true);
    stopSweep();
    stopSequence();
    commandModeRevision += 1;
    servoControls.forEach(control => {
      clearTimeout(control.timer);
      control.timer = null;
      control.pendingCommand = null;
    });
    await Promise.allSettled(servoControls.map(control => control.requestQueue));
    // Keep persisted names for save conflict detection.
    nodes.forEach(node => { node.originalName = null; });
    servoPreview.configuration = configuration;
    servoPreview.nodes = nodes;
    servoPreview.frameAllPending = true;
    servoPreview.servoNodes = nodes.filter(node => componentRegistry.hasCapability(node, "actuator"));
    servoPreview.selected = nodes.findIndex(node => componentRegistry.hasCapability(node, "root"));
    controllerConfiguration = configuration;
    servoControls.forEach(control => control.strip.remove());
    servoControls = [];
    initializeServoControls(configuration.components.filter(component => componentRegistry.hasCapability(component, "actuator")));
    servoControls.forEach((control, index) => {
      const node = servoPreview.servoNodes[index];
      control.ready = true;
      node.ready = true;
      node.enabled = !control.muted;
      node.outputEnabled = control.outputEnabled;
      syncServoPower(control);
      setText("servoStatus" + control.channel, "Off");
      setText("pulse" + control.channel, "�");
    });
    syncMasterPower();
    setServoPlaybackLock(false);
    simulationSequences.clear();
    sequence = { loop: false, finish: true, steps: [] };
    selectedSequenceStepIndex = -1;
    playbackSequenceView = null;
    sequenceLoaded = true;
    renderSequence();
    updateSequencerControls();
    editedServoIndex = -1;
    servoSettingsDirty = false;
    document.getElementById("servoSettingsForm").hidden = true;
    // File output indices must not be used against the previous live robot.
    document.getElementById("previewOffline").disabled = true;
    setText("connection", "Loaded robot � offline simulation. Save and reload to reconnect.");
    clearPreviewTreeDrag();
    initializePreviewPlacementControls();
    drawServoPreview();
    setText("previewSaveStatus", message);
    return true;
  } finally {
    saveButton.disabled = false;
  }
}

async function newRobot() {
  if (!servoPreview?.editing || document.getElementById("previewSave").disabled) return;
  try {
    const configuration = JSON.parse(JSON.stringify(servoPreview.configuration));
    delete configuration.camera;
    configuration.components = [];
    if (await replaceSetupRobot(configuration, "New robot created. Name it and use Save robot to create its folder.")) {
      let suffix = 1;
      while (robotFolders.includes("Robot " + suffix)) suffix++;
      currentRobotName = "Robot " + suffix;
      robotPersisted = false;
      updateRobotFolderControls();
    }
  } catch (error) {
    setText("previewSaveStatus", "New robot failed: " + error.message);
  }
}

function downloadPreviewConfiguration() {
  if (!servoPreview || document.getElementById("previewDownload").disabled) return;
  if (!commitPreviewComponentName()) return;
  try {
    const configuration = previewConfigurationSnapshot();
    const url = URL.createObjectURL(new Blob([JSON.stringify(configuration, null, 2) + "\n"], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "config.json";
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setText("previewSaveStatus", "Current config downloaded, including unsaved changes.");
  } catch (error) {
    setText("previewSaveStatus", "Download failed: " + error.message);
  }
}

async function saveLocalConfiguration(configuration) {
  const originalNames = servoPreview?.savedNames ?? controllerConfiguration.components.map(component => component.name);
  const response = await fetch("/api/config/local", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ configuration, originalNames: robotPersisted ? originalNames : null, robot: currentRobotName || undefined })
  });
  const result = await response.text();
  if (!response.ok) throw new Error(result || "HTTP " + response.status);
  return result;
}

async function savePreviewConfiguration() {
  if (controllerRebooting) return;
  if (!servoPreview || !servoPreview.editing) return;
  const button = document.getElementById("previewSave");
  if (button.disabled) return;
  if (!commitPreviewComponentName()) return;
  // A draft must be saved as a named robot, even if initial capability discovery failed.
  if (!robotPersisted && !robotStorageAvailable) {
    try {
      const response = await fetch("/api/robots", { cache: "no-store", signal: AbortSignal.timeout(3000) });
      if (!response.ok) throw new Error("Robot-folder API returned HTTP " + response.status);
      const manifest = await response.json();
      if (!Array.isArray(manifest.robots)) throw new Error("Invalid robot-folder response");
      robotStorageAvailable = true;
      robotFolders = manifest.robots;
    } catch (error) {
      setText("previewSaveStatus", "Robot not saved: " + error.message + ". Reconnect to the controller and ensure its firmware supports robot folders.");
      return;
    }
  }
  const desiredName = robotStorageAvailable ? document.getElementById("robotName").value.trim() : currentRobotName;
  if (robotStorageAvailable) {
    const name = desiredName;
    if (!/^[A-Za-z0-9][A-Za-z0-9 _-]{0,39}$/.test(name)) { setText("previewSaveStatus", "Enter a valid robot folder name (1-40 letters, numbers, spaces, underscores or hyphens)."); return; }
    if (robotPersisted && name !== currentRobotName && robotFolders.some(folder => folder.toLowerCase() === name.toLowerCase())) { setText("previewSaveStatus", "A robot with that name already exists."); return; }
    if (!robotPersisted) currentRobotName = name;
  }
  if (robotPersisted && desiredName !== currentRobotName && (sequencePlaying || sequenceSaving || sequenceLoading || sequenceApplying)) {
    setText("previewSaveStatus", "Stop playback and wait for sequence operations before renaming the robot.");
    return;
  }
  try { stageServoSettings(); }
  catch (error) { setText("previewSaveStatus", "Save failed: " + error.message); return; }
  const configuration = previewConfigurationSnapshot();
  const controls = Array.from(document.querySelectorAll("#setupPanel button, #setupPanel input, #setupPanel select"))
    .map(control => ({ control, disabled: control.disabled }));
  controls.forEach(({ control }) => { control.disabled = true; });
  button.disabled = true;
  document.getElementById("setupSelectedName").contentEditable = "false";
  setText("previewSaveStatus", "Saving config...");
  try {
    if (localConfigServer) {
      setText("previewSaveStatus", await saveLocalConfiguration(configuration));
    } else if (offlineSimulation && !robotStorageAvailable) {
      const url = URL.createObjectURL(new Blob([JSON.stringify(configuration, null, 2) + "\n"], { type: "application/json" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = "config.json";
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setText("previewSaveStatus", "Config downloaded. Replace data/config.json with this file to keep the layout. Device config was not updated.");
    } else {
      const placements = configuration.components.map((component, index) => ({ ...component, originalName: servoPreview.nodes[index].originalName }));
      const response = await fetch("/api/config/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ components: placements, originalNames: robotPersisted ? servoPreview.savedNames : null, robot: currentRobotName || undefined, configuration: robotPersisted ? undefined : configuration, camera: configuration.camera })
      });
      const result = await response.text();
      if (!response.ok) throw new Error(result || "HTTP " + response.status);
      setText("previewSaveStatus", "Config saved on controller. Restart and reload to apply changes to the servo list.");
    }
    if (robotStorageAvailable) {
      const response = await fetch("/api/robots", { cache: "no-store", signal: AbortSignal.timeout(3000) });
      if (!response.ok) throw new Error("Could not verify saved robot folder (HTTP " + response.status + ")");
      const manifest = await response.json();
      if (manifest.active !== currentRobotName || !Array.isArray(manifest.robots) || !manifest.robots.includes(currentRobotName)) {
        throw new Error("Controller did not confirm the robot folder and active selection. The robot has not been marked saved.");
      }
    }
    servoPreview.nodes.forEach(node => { node.originalName = node.name; });
    servoPreview.savedNames = configuration.components.map(component => component.name);
    servoPreview.configuration = configuration;
    if (robotStorageAvailable && robotPersisted && desiredName !== currentRobotName) {
      const previousName = currentRobotName;
      const response = await fetch("/api/robot/rename", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ from: previousName, to: desiredName }) });
      if (!response.ok) throw new Error("Config saved, but rename failed: " + await response.text());
      currentRobotName = desiredName;
      robotFolders = robotFolders.map(name => name === previousName ? desiredName : name);
      try {
        const power = sessionStorage.getItem("servoSimulationPower:" + previousName);
        if (power) sessionStorage.setItem(simulatedPowerKey(), power);
        localStorage.removeItem("servoPreviewConfig:" + previousName);
      } catch (_) { /* Storage may be disabled. */ }
    }
    const wasDraft = !robotPersisted;
    robotPersisted = true;
    if (wasDraft && robotStorageAvailable && !localConfigServer) {
      robotRequiresRestart = true;
      document.getElementById("rebootButton").disabled = false;
    }
    if (robotStorageAvailable) {
      if (!robotFolders.includes(currentRobotName)) robotFolders.push(currentRobotName);
      updateRobotFolderControls();
      if (wasDraft) {
        simulationSequences.set(selectedSequenceSlot, sequence);
        for (const [slot, saved] of simulationSequences) {
          const response = await fetch(robotSequenceEndpoint(slot), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(saved) });
          if (!response.ok) throw new Error("Robot saved, but sequence " + slot + " failed: " + await response.text());
        }
      }
    }
    if (editedServoIndex >= 0) editedServoName = configuration.components[editedServoIndex]?.name ?? null;
    try { localStorage.setItem("servoPreviewConfig:" + currentRobotName, JSON.stringify(configuration)); } catch (_) { /* Storage may be disabled. */ }
  } catch (error) {
    setText("previewSaveStatus", "Save failed: " + error.message);
  } finally {
    document.getElementById("setupSelectedName").contentEditable = servoPreview.nodes[servoPreview.selected] ? "plaintext-only" : "false";
    controls.forEach(({ control, disabled }) => { control.disabled = disabled; });
    button.disabled = false;
  }
}

// The viewing camera is a built-in Setup entry, not a servo or attachment.
function renderSetupCameraControls() {
  const host = document.getElementById("setupTransforms");
  host.replaceChildren();
  const note = makeElement("p", "subtle", "View position shifts the scene centre. Rotation orbits around it. Use Save robot to keep the camera and webcam settings.");
  host.append(note);
  const numberControl = (group, key, text, step, scale = 1, min, max) => {
    const label = makeElement("label", "", text);
    const input = makeElement("input");
    input.type = "number"; input.step = "any";
    input.dataset.cameraKey = key; input.dataset.cameraScale = String(scale);
    if (min !== undefined) input.min = String(min);
    if (max !== undefined) input.max = String(max);
    const apply = value => {
      if (!Number.isFinite(value)) return;
      value = Math.max(min ?? -Infinity, Math.min(max ?? Infinity, value));
      servoPreview[key] = value / scale;
      savePreviewCamera(); drawServoPreview();
    };
    input.addEventListener("change", () => {
      if (input.value !== "" && input.checkValidity()) apply(Number(input.value));
      syncSetupCameraControls();
    });
    const controls = makeElement("div", "camera-adjustment");
    const minus = makeElement("button", "", "−"), plus = makeElement("button", "", "+");
    [minus, plus].forEach((button, direction) => {
      button.type = "button";
      button.setAttribute("aria-label", text + (direction ? " increase" : " decrease"));
      button.addEventListener("click", event => {
        apply(servoPreview[key] * scale + (direction ? 1 : -1) * (event.shiftKey ? step / 5 : step));
      });
    });
    controls.append(minus, input, plus); label.append(controls); group.append(label);
  };
  const group = title => {
    const element = makeElement("fieldset", "camera-control-group");
    element.append(makeElement("legend", "", title)); host.append(element); return element;
  };
  const position = group("View position (mm)");
  ["panX", "panY", "panZ"].forEach((key, i) => numberControl(position, key, ["X", "Y", "Z"][i], 5));
  const rotation = group("Rotation (degrees)");
  numberControl(rotation, "pitch", "Pitch", 5, 180 / Math.PI, -90, 90);
  numberControl(rotation, "yaw", "Yaw", 5, 180 / Math.PI);
  numberControl(rotation, "roll", "Roll", 5, 180 / Math.PI);
  const view = group("View");
  numberControl(view, "zoom", "Zoom", 0.1, 1, 0.001, 5);
  const projection = makeElement("button", "", "Toggle perspective"); projection.type = "button"; projection.id = "setupCameraProjection";
  projection.addEventListener("click", () => document.getElementById("previewProjection").click());
  const reset = makeElement("button", "", "Reset view"); reset.type = "button";
  reset.addEventListener("click", () => document.getElementById("previewReset").click());
  view.append(projection, reset);
  const webcam = group("Webcam"); webcam.id = "setupWebcamControls";
  syncSetupCameraControls(); refreshSetupWebcamControls();
}

function syncSetupCameraControls() {
  if (!servoPreview || servoPreview.selected !== "camera") return;
  const projection = document.getElementById("setupCameraProjection");
  if (projection) {
    projection.textContent = servoPreview.perspective ? "Perspective" : "Orthographic";
    projection.setAttribute("aria-pressed", String(servoPreview.perspective));
  }
  document.querySelectorAll("[data-camera-key]").forEach(input => {
    if (document.activeElement !== input) input.value = Number(((servoPreview[input.dataset.cameraKey] || 0) * Number(input.dataset.cameraScale)).toFixed(3));
  });
}

async function refreshSetupWebcamControls() {
  const host = document.getElementById("setupWebcamControls");
  if (!host) return;
  host.replaceChildren(makeElement("legend", "", "Webcam"));
  host.append(webcamToggle);
  const refresh = makeElement("button", "", "Refresh cameras"); refresh.type = "button";
  refresh.addEventListener("click", () => refreshSetupWebcamControls()); host.append(refresh);
  const accessHelp = makeElement("details", "webcam-access-help");
  accessHelp.append(makeElement("summary", "", "Webcam blocked? Allow access in Chrome"));
  accessHelp.append(makeElement("p", "subtle", "Webcam access requires HTTPS, localhost, or a browser exception. For this controller over HTTP, follow these steps in Chrome:"));
  const accessSteps = makeElement("ol", "");
  [
    "Copy chrome://flags/#unsafely-treat-insecure-origin-as-secure into Chrome's address bar and open it.",
    "In Insecure origins treated as secure, add http://ghost-controller.local (include http://). Keep any existing entries; separate origins with commas.",
    "Set the option to Enabled and relaunch Chrome. Save any unsaved controller changes before relaunching.",
    "Open http://ghost-controller.local, return to Setup > Camera, select Activate webcam, and allow camera access when prompted."
  ].forEach((text, index) => {
    const step = makeElement("li", "", text);
    if (index === 0 || index === 1 || index === 3) {
      const copy = makeElement("button", "webcam-copy-address", "\u29c9");
      copy.type = "button";
      const copyLabel = index === 0 ? "Copy Chrome flags address" : "Copy controller address";
      copy.title = copyLabel;
      copy.setAttribute("aria-label", copyLabel);
      const feedback = makeElement("span", "subtle");
      feedback.setAttribute("role", "status");
      copy.addEventListener("click", async () => {
        const address = index === 0 ? "chrome://flags/#unsafely-treat-insecure-origin-as-secure" : "http://ghost-controller.local";
        let copied = false;
        try {
          if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(address);
            copied = true;
          }
        } catch (_) { /* HTTP and browser permissions may require the fallback. */ }
        if (!copied) {
          const field = makeElement("textarea");
          field.value = address;
          field.readOnly = true;
          field.style.position = "fixed";
          field.style.opacity = "0";
          document.body.append(field);
          try {
            field.select();
            copied = document.execCommand("copy");
          } catch (_) { /* Keep the address visible for manual copying. */ }
          finally { field.remove(); copy.focus({ preventScroll: true }); }
        }
        feedback.textContent = copied ? " Copied!" : " Could not copy. Select and copy the address above.";
      });
      step.append(copy, feedback);
    }
    accessSteps.append(step);
  });
  accessHelp.append(accessSteps);
  accessHelp.append(makeElement("p", "subtle", "This exception treats the specified HTTP origin as secure; it does not encrypt the connection. Use it only on a trusted network. Each user must configure their browser. Use the hostname rather than the IP address so the exception still applies if the controller's IP changes. To undo it, remove this origin from the flag and relaunch Chrome."));
  accessHelp.open = !navigator.mediaDevices?.getUserMedia;
  host.append(accessHelp);
  if (!navigator.mediaDevices?.getUserMedia) {
    host.append(makeElement("p", "subtle", "Webcam access requires a supported browser on HTTPS, localhost, or an allowed secure origin."));
    return;
  }
  const track = webcamStream?.getVideoTracks()[0];
  const settings = track?.getSettings?.() || {};
  let capabilities = {};
  try { capabilities = track?.getCapabilities?.() || {}; }
  catch (_) { /* Device selection and video display still work without capabilities. */ }
  const label = makeElement("label", "", "Camera device");
  const devices = makeElement("select");
  const defaultOption = makeElement("option", "", "Default camera"); defaultOption.value = ""; devices.append(defaultOption);
  label.append(devices); host.append(label);
  devices.value = settings.deviceId || selectedWebcamDevice;
  devices.disabled = webcamToggle.disabled;
  devices.addEventListener("change", () => {
    const deviceId = devices.value;
    if (deviceId !== selectedWebcamDevice) savedWebcamControls = {};
    selectedWebcamDevice = deviceId;
    if (webcamStream) startWebcam(deviceId);
  });
  const fitLabel = makeElement("label", "", "Video fit"), fit = makeElement("select");
  ["cover", "contain"].forEach(value => { const option = makeElement("option", "", value === "cover" ? "Fill view" : "Show entire frame"); option.value = value; fit.append(option); });
  fit.value = webcamVideo.style.objectFit || "cover";
  fit.addEventListener("change", () => { webcamVideo.style.objectFit = fit.value; }); fitLabel.append(fit); host.append(fitLabel);
  const mirrorLabel = makeElement("label", "camera-checkbox", "Mirror video"), mirror = makeElement("input");
  mirror.type = "checkbox"; mirror.checked = webcamVideo.style.transform === "scaleX(-1)";
  mirror.addEventListener("change", () => { webcamVideo.style.transform = mirror.checked ? "scaleX(-1)" : ""; });
  mirrorLabel.append(mirror); host.append(mirrorLabel);
  if (!track) host.append(makeElement("p", "subtle", "Activate the webcam to reveal device names and supported camera controls."));
  else {
    host.append(makeElement("p", "subtle", [track.label, settings.width && settings.height ? settings.width + " × " + settings.height : "", settings.frameRate ? settings.frameRate.toFixed(1) + " fps" : ""].filter(Boolean).join(" · ")));
    const names = { width: "Width (pixels)", height: "Height (pixels)", frameRate: "Frame rate", zoom: "Optical zoom", pan: "Camera pan", tilt: "Camera tilt", focusMode: "Focus mode", focusDistance: "Focus distance", exposureMode: "Exposure mode", exposureCompensation: "Exposure compensation", exposureTime: "Exposure time", whiteBalanceMode: "White balance", colorTemperature: "Colour temperature", brightness: "Brightness", contrast: "Contrast", saturation: "Saturation", sharpness: "Sharpness", torch: "Light" };
    Object.entries(names).forEach(([key, text]) => {
      const capability = capabilities[key];
      const numeric = capability && Number.isFinite(capability.min) && Number.isFinite(capability.max) && capability.max > capability.min;
      const choices = Array.isArray(capability) && capability.length > 1;
      if (!numeric && !choices) return;
      const field = makeElement("label", "", text);
      const input = makeElement(choices ? "select" : "input");
      if (numeric) { input.type = "number"; input.min = capability.min; input.max = capability.max; input.step = capability.step || "any"; }
      else capability.forEach(value => { const option = makeElement("option", "", String(value)); option.value = String(value); input.append(option); });
      input.value = settings[key] ?? (numeric ? capability.min : capability[0]);
      input.addEventListener("change", async () => {
        if (track !== webcamStream?.getVideoTracks()[0] || (numeric && (!input.value || !input.checkValidity()))) return;
        const value = numeric ? Number(input.value) : typeof capability[0] === "boolean" ? input.value === "true" : input.value;
        input.disabled = true;
        try {
          const previous = track.getConstraints?.() || {};
          const constraints = ["width", "height", "frameRate"].includes(key)
            ? { ...previous, [key]: { exact: value } }
            : { ...previous, advanced: [{ ...(previous.advanced?.[0] || {}), [key]: value }] };
          await track.applyConstraints(constraints);
          savedWebcamControls[key] = value;
          setText("webcamStatus", text + " updated");
        } catch (error) { setText("webcamStatus", text + ": " + error.message); }
        finally { refreshSetupWebcamControls(); }
      });
      field.append(input); host.append(field);
    });
  }
  try {
    const cameras = (await navigator.mediaDevices.enumerateDevices()).filter(device => device.kind === "videoinput");
    if (!host.isConnected || document.getElementById("setupWebcamControls") !== host || !devices.isConnected) return;
    cameras.forEach((device, i) => { const option = makeElement("option", "", device.label || "Camera " + (i + 1)); option.value = device.deviceId; devices.append(option); });
    devices.value = settings.deviceId || selectedWebcamDevice;
  } catch (error) { setText("webcamStatus", "Could not list webcams: " + error.message); }
}

function renderNullConstraints(node, host) {
  const group = makeElement("fieldset", "null-constraints");
  group.append(makeElement("legend", "", "Physics constraints"));
  group.append(makeElement("p", "subtle", "World axes. Min/max are offsets in mm from the configured Null position. 0 / 0 holds an axis; unchecked is free. Use the rotation locks below to prevent tipping. Save robot to keep changes."));
  for (const axis of ["x", "y", "z"]) {
    const stored = node.constraints?.[axis] || { enabled: false, min: 0, max: 0 };
    const row = makeElement("div", "null-constraint-row");
    const label = makeElement("label", "null-constraint-toggle", "Constrain " + axis.toUpperCase());
    const enabled = makeElement("input"); enabled.type = "checkbox"; enabled.checked = stored.enabled === true;
    label.append(enabled); row.append(label);
    const inputs = {};
    for (const bound of ["min", "max"]) {
      const field = makeElement("label", "", bound === "min" ? "Min (mm)" : "Max (mm)");
      const input = makeElement("input"); input.type = "number"; input.step = "any";
      input.value = Number.isFinite(stored[bound]) ? stored[bound] : 0;
      input.disabled = !enabled.checked;
      input.setAttribute("aria-label", axis.toUpperCase() + " constraint " + bound + " offset in millimetres");
      field.append(input); row.append(field); inputs[bound] = input;
    }
    const apply = () => {
      const min = Number(inputs.min.value), max = Number(inputs.max.value);
      if (inputs.min.value === "" || inputs.max.value === "" || !Number.isFinite(min) || !Number.isFinite(max) || min > max) {
        const previous = node.constraints?.[axis] || stored;
        inputs.min.value = previous.min; inputs.max.value = previous.max; enabled.checked = previous.enabled === true;
        setText("previewSaveStatus", "Constraint minimum must be a finite number no greater than maximum.");
        return;
      }
      node.constraints ||= {};
      node.constraints[axis] = { enabled: enabled.checked, min, max };
      inputs.min.disabled = inputs.max.disabled = !enabled.checked;
      setText("previewSaveStatus", "Unsaved Null constraint changes");
      if (previewPhysics && previewPhysicsEnabled) syncPreviewPhysics();
      drawServoPreview();
    };
    enabled.addEventListener("change", apply);
    inputs.min.addEventListener("change", apply); inputs.max.addEventListener("change", apply);
    group.append(row);
  }
  const rotation = makeElement("div", "null-rotation-constraints");
  rotation.append(makeElement("p", "subtle", "Rotation locks keep the configured orientation on the selected world axes. Lock X and Z to stay upright while allowing yaw and free walking."));
  for (const axis of ["x", "y", "z"]) {
    const label = makeElement("label", "null-constraint-toggle", "Lock rotation " + axis.toUpperCase());
    const input = makeElement("input"); input.type = "checkbox"; input.checked = node.rotationConstraints?.[axis] === true;
    input.addEventListener("change", () => {
      node.rotationConstraints ||= {};
      node.rotationConstraints[axis] = input.checked;
      setText("previewSaveStatus", "Unsaved Null rotation constraints");
      if (previewPhysics && previewPhysicsEnabled) syncPreviewPhysics();
      drawServoPreview();
    });
    label.append(input); rotation.append(label);
  }
  group.append(rotation);
  host.append(group);
}

function renderComponentPower(node, host) {
  const group = makeElement("fieldset", "component-power");
  group.append(makeElement("legend", "", "Estimated power"));
  const inputs = {};
  for (const [key, title] of [["minPowerWatts", "Minimum (W)"], ["maxPowerWatts", "Maximum (W)"]]) {
    const label = makeElement("label", "", title);
    const input = makeElement("input");
    input.type = "number"; input.min = "0"; input.step = "any";
    const defaults = componentRegistry.resolve(node).getPower(node);
    input.placeholder = String(key === "minPowerWatts" ? defaults.min : defaults.max) + " (model default)";
    input.value = node[key] ?? "";
    input.setAttribute("aria-label", "Component " + title.toLowerCase());
    inputs[key] = input;
    input.addEventListener("change", () => {
      const min = inputs.minPowerWatts.value === "" ? null : Number(inputs.minPowerWatts.value);
      const max = inputs.maxPowerWatts.value === "" ? null : Number(inputs.maxPowerWatts.value);
      if (!servoPreview?.editing || [min, max].some(value => value !== null && (!Number.isFinite(value) || value < 0)) ||
          (min !== null && max !== null && min > max)) {
        input.value = node[key] ?? "";
        setText("previewSaveStatus", "Power must be nonnegative, with minimum no greater than maximum.");
        return;
      }
      node.minPowerWatts = min; node.maxPowerWatts = max;
      refreshSummary();
      setText("previewSaveStatus", "Unsaved power settings. Use Save robot to keep changes.");
    });
    label.append(input); group.append(label);
  }
  const summary = makeElement("small", "subtle");
  const refreshSummary = () => {
    const range = componentRegistry.getPower(node);
    summary.textContent = "Calculated: idle " + range.min.toFixed(3) + " W, running " +
      (range.running ?? range.max).toFixed(3) + " W, peak " + range.max.toFixed(3) + " W.";
  };
  for (const [key, title, modelKey] of [
    ["powerVoltageVolts", "Supply voltage (V)", "voltage"], ["idleCurrentAmps", "Idle current (A)", "idleCurrentAmps"],
    ["runningCurrentAmps", "Running current (A)", "runningCurrentAmps"], ["peakCurrentAmps", "Peak / stall current (A)", "peakCurrentAmps"]
  ]) {
    const label = makeElement("label", "", title), input = makeElement("input");
    input.type = "number"; input.min = key === "powerVoltageVolts" ? "0.001" : "0"; input.step = "any";
    const defaults = componentRegistry.resolve(node).getPower(node);
    input.placeholder = defaults[modelKey] == null ? "Not set" : String(defaults[modelKey]) + " (model default)";
    input.value = node[key] ?? "";
    input.addEventListener("change", () => {
      const value = input.value === "" ? null : Number(input.value);
      if (!servoPreview?.editing || (value !== null && (!Number.isFinite(value) || (key === "powerVoltageVolts" ? value <= 0 : value < 0)))) {
        input.value = node[key] ?? ""; return;
      }
      const candidate = { ...node, [key]: value, minPowerWatts: null, maxPowerWatts: null };
      try { componentRegistry.getPower(candidate); }
      catch (error) { input.value = node[key] ?? ""; setText("previewSaveStatus", error.message); return; }
      node[key] = value;
      node.minPowerWatts = node.maxPowerWatts = null;
      inputs.minPowerWatts.value = inputs.maxPowerWatts.value = "";
      refreshSummary();
      setText("previewSaveStatus", "Unsaved voltage/current settings. Use Save robot to keep changes.");
    });
    label.append(input); group.append(label);
  }
  group.append(makeElement("small", "subtle", "Watts = volts x amps. Divide mA by 1000 (40 mA = 0.040 A). Editing voltage/current clears watt overrides; blank values use model defaults."));
  refreshSummary(); group.append(summary);
  host.append(group);
}

function renderComponentMass(node, host) {
  const group = makeElement("fieldset", "component-mass");
  group.append(makeElement("legend", "", "Physics"));
  const label = makeElement("label", "", "Mass (g)");
  const input = makeElement("input");
  input.type = "number"; input.min = "0"; input.step = "any";
  const physics = componentRegistry.getPhysics(node);
  input.placeholder = String(physics.massGrams);
  input.disabled = !physics.real;
  input.value = node.massGrams ?? "";
  input.setAttribute("aria-label", "Component mass in grams");
  input.addEventListener("change", () => {
    const mass = input.value.trim() === "" ? undefined : Number(input.value);
    if (!servoPreview?.editing || (mass !== undefined && (!Number.isFinite(mass) || mass <= 0))) {
      input.value = node.massGrams ?? "";
      setText("previewSaveStatus", "Mass must be greater than zero, or blank for the model mass.");
      return;
    }
    node.massGrams = mass;
    setText("previewSaveStatus", "Unsaved mass change. Use Save robot to keep it.");
    if (previewPhysics && previewPhysicsEnabled) syncPreviewPhysics();
    drawServoPreview();
  });
  label.append(input); group.append(label);
  group.append(makeElement("small", "subtle", physics.real ? "Physical component. Leave blank to use the model mass (g)." : "Virtual component: visual only, with no mass or collisions."));
  host.append(group);
}

function initializePreviewPlacementControls() {
  if (servoSettingsDirty) {
    try { stageServoSettings(); }
    catch (error) {
      servoPreview.selected = editedServoIndex;
      setText("servoSettingsStatus", "Settings not applied: " + error.message);
      return;
    }
  }
  document.getElementById("servoSettingsForm").hidden = true;
  document.getElementById("setupServoGroup").hidden = true;
  document.getElementById("servoSettingsTitle").hidden = true;
  const selection = document.getElementById("previewServoSelection");
  selection.replaceChildren();
  const rootItem = makeElement("li");
  const rootTarget = makeElement("button", "tree-root-target", "Scene (drop here to detach)");
  rootTarget.type = "button";
  bindPreviewTreeDrop(rootTarget, null);
  rootItem.append(rootTarget);
  selection.append(rootItem);
  const appendChildren = (parent, list) => {
    servoPreview.nodes.forEach((node, index) => {
      if (node.parent !== parent) return;
      const item = makeElement("li");
      const body = componentRegistry.hasCapability(node, "actuator") && servoPreview.nodes.some(child => child.parent === index + 1 && componentRegistry.hasCapability(child, "servoShaft"));
      const button = makeElement("button", "", node.name + (body ? " (Body)" : ""));
      button.type = "button";
      button.draggable = true;
      button.addEventListener("dragstart", event => {
        if (!servoPreview.editing || document.getElementById("previewSave").disabled) {
          event.preventDefault(); return;
        }
        previewDraggedNode = node;
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", node.name);
        button.classList.add("tree-dragging");
      });
      button.addEventListener("dragend", clearPreviewTreeDrag);
      bindPreviewTreeDrop(button, index + 1);
      button.setAttribute("aria-pressed", String(index === servoPreview.selected));
      button.addEventListener("click", () => {
        servoPreview.selected = index;
        initializePreviewPlacementControls();
        drawServoPreview();
      });
      item.append(button);
      const children = makeElement("ul");
      appendChildren(index + 1, children);
      if (children.children.length) item.append(children);
      list.append(item);
    });
  };
  const cameraItem = makeElement("li");
  const cameraButton = makeElement("button", "", "Camera");
  cameraButton.type = "button";
  cameraButton.setAttribute("aria-pressed", String(servoPreview.selected === "camera"));
  cameraButton.addEventListener("click", () => {
    servoPreview.selected = "camera";
    initializePreviewPlacementControls();
    drawServoPreview();
  });
  cameraItem.append(cameraButton);
  selection.append(cameraItem);
  appendChildren(null, selection);
  const addItem = makeElement("li");
  const addButton = makeElement("button", "component-add-button", "+");
  addButton.type = "button";
  addButton.setAttribute("aria-label", "Add component");
  addButton.setAttribute("aria-pressed", String(servoPreview.selected === "add"));
  addButton.disabled = servoPreview.nodes.length >= 60;
  addButton.addEventListener("click", () => {
    servoPreview.selected = "add";
    initializePreviewPlacementControls();
    drawServoPreview();
  });
  addItem.append(addButton);
  selection.append(addItem);
  updatePreviewAddButton();
  const selectedNode = servoPreview.nodes[servoPreview.selected];
  const heading = document.getElementById("setupSelectedName");
  heading.contentEditable = selectedNode ? "plaintext-only" : "false";
  const robotSelected = componentRegistry.hasCapability(selectedNode ?? {}, "root");
  document.getElementById("setupRobotControls").hidden = !robotSelected;
  document.getElementById("setupTransforms").hidden = false;
  document.getElementById("setupTransformHint").hidden = false;
  const adding = servoPreview.selected === "add";
  document.getElementById("setupAddComponent").hidden = !adding;
  if (adding) {
    heading.contentEditable = "false";
    setText("setupSelectedName", "Add component");
    document.getElementById("previewRemove").disabled = true;
    document.getElementById("setupTransforms").hidden = true;
    document.getElementById("setupTransformHint").hidden = true;
    renderComponentChoices();
    updatePreviewTransform();
    return;
  }
  if (servoPreview.selected === "camera") {
    heading.contentEditable = "false";
    setText("setupSelectedName", "Camera");
    document.getElementById("previewRemove").disabled = true;
    renderSetupCameraControls();
    updatePreviewTransform();
    return;
  }
  if (!selectedNode) {
    document.getElementById("previewRemove").disabled = true;
    setText("setupSelectedName", "Select a component");
    document.getElementById("setupTransforms").replaceChildren();
    updatePreviewTransform();
    return;
  }
  document.getElementById("previewRemove").disabled = robotSelected || componentRegistry.hasCapability(selectedNode, "servoShaft");
  setText("setupSelectedName", selectedNode.name);
  if ((selectedNode.objectType ?? "Servo") === "Servo") renderServoComponentSettings(servoPreview.selected);
  const transforms = document.getElementById("setupTransforms");
  transforms.replaceChildren();
  ["position", "rotation"].forEach(field => {
    const group = makeElement("fieldset");
    group.append(makeElement("legend", "", field === "position" ? "Position (mm)" : "Rotation (degrees)"));
    ["X", "Y", "Z"].forEach((axis, index) => {
      const label = makeElement("label", "", axis);
      const input = makeElement("input");
      input.type = "number"; input.step = "any"; input.value = selectedNode[field][index];
      input.addEventListener("change", () => {
        if (!servoPreview.editing || !input.value || !Number.isFinite(Number(input.value))) {
          input.value = selectedNode[field][index]; return;
        }
        selectedNode[field][index] = Number(input.value);
        setText("previewSaveStatus", "Unsaved transform changes");
        updatePreviewTransform(); drawServoPreview();
      });
      const control = makeElement("div", "setup-axis-control");
      const nudgeAxis = index + (field === "rotation" ? 3 : 0);
      const minus = makeElement("button", "", "-");
      const plus = makeElement("button", "", "+");
      [minus, plus].forEach((button, direction) => {
        button.type = "button";
        button.setAttribute("aria-label", "Nudge " + (field === "position" ? "local " : "R") + axis +
          (direction ? " plus " : " minus ") + (field === "position" ? "5 mm; Shift-click for 1 mm" : "15 degrees; Shift-click for 1 degree"));
        button.addEventListener("click", event => {
          const step = event.shiftKey ? 1 : (field === "position" ? 5 : 15);
          nudgePreviewServo(nudgeAxis, (direction ? 1 : -1) * step);
        });
      });
      label.htmlFor = "setup-" + field + "-" + axis;
      input.id = label.htmlFor;
      control.append(minus, input, plus);
      const row = makeElement("div", "setup-axis-row setup-axis-" + axis.toLowerCase());
      row.append(label, control);
      group.append(row);
    });
    transforms.append(group);
  });
  renderComponentMass(selectedNode, transforms);
  const settingsBeforePower = componentRegistry.resolve(selectedNode)?.settingsBeforePower;
  if (!settingsBeforePower) renderComponentPower(selectedNode, transforms);
  componentRegistry.resolve(selectedNode)?.renderSettings?.({ node: selectedNode, host: transforms,
    readCalibration: () => {
      const index = servoPreview.nodes.indexOf(selectedNode);
      return { offline: offlineSimulation, sensor: sensorTelemetry?.vl53l0x,
        telemetryAgeMs: performance.now() - sensorTelemetryAt,
        direction: GhostSensor.sensorRay(servoPreview.nodes, index, previewWorldPoint)?.direction,
        simulated: createPreviewSensorSampler()(index) };
    },
    controllerAddressChanged: updatePreviewControllerAddress,
    editing: servoPreview.editing, change: () => {
      Object.assign(servoPreview.configuration.components[servoPreview.selected], componentRegistry.settings(selectedNode));
      setText("previewSaveStatus", "Unsaved component change. Use Save robot to keep it.");
      if (previewPhysicsEnabled && previewPhysics) syncPreviewPhysics();
      drawServoPreview();
    } });
  if (settingsBeforePower) renderComponentPower(selectedNode, transforms);
  if (componentRegistry.hasCapability(selectedNode, "constraints")) renderNullConstraints(selectedNode, transforms);
  updatePreviewTransform();
}

function updatePreviewControllerAddress(node, address) {
  const oldAddress = node.i2cAddress ?? 0x40;
  if (address === oldAddress) return;
  const components = servoPreview.configuration.components;
  const outputs = new Set();
  for (const component of components) {
    if (!componentRegistry.hasCapability(component, "actuator")) continue;
    const nextAddress = Number(component.address) === oldAddress ? address : Number(component.address);
    const key = nextAddress + ":" + component.channel;
    if (outputs.has(key)) throw new Error("That address would assign two servos to the same controller channel.");
    outputs.add(key);
  }
  if (servoPreview.nodes.some(other => other !== node && componentRegistry.hasCapability(other, "servoController") &&
      (other.i2cAddress ?? 0x40) === address)) throw new Error("Another controller already uses that I²C address.");
  for (const component of components) {
    if (componentRegistry.hasCapability(component, "actuator") && Number(component.address) === oldAddress) component.address = "0x" + address.toString(16);
  }
  node.i2cAddress = address;
  if (servoPreview.configuration.servoController && Number(servoPreview.configuration.servoController.address ?? 0x40) === oldAddress) {
    servoPreview.configuration.servoController.address = "0x" + address.toString(16);
  }
}

function commitPreviewComponentName() {
  if (!servoPreview?.editing || document.getElementById("previewSave").disabled) return false;
  const heading = document.getElementById("setupSelectedName");
  const index = servoPreview.selected;
  const node = servoPreview.nodes[index];
  if (!node) return true;
  const name = heading.textContent.trim();
  const maximumNameBytes = componentRegistry.hasCapability(node, "actuator") ? 31 : 63;
  if (!name || new TextEncoder().encode(name).length > maximumNameBytes ||
      servoPreview.nodes.some((other, otherIndex) => otherIndex !== index && other.name === name)) {
    heading.textContent = node.name;
    setText("previewSaveStatus", "Name must be unique, nonempty and at most " + maximumNameBytes + " bytes.");
    return false;
  }
  if (name === node.name) { heading.textContent = name; return true; }
  const oldName = node.name;
  node.name = name;
  servoPreview.configuration.components[index].name = name;
  servoPreview.configuration.components.forEach(component => {
    if (component.parent === oldName) component.parent = name;
  });
  initializePreviewPlacementControls();
  setText("previewSaveStatus", "Unsaved component name change");
  drawServoPreview();
  return true;
}

document.getElementById("setupSelectedName").addEventListener("blur", commitPreviewComponentName);
document.getElementById("setupSelectedName").addEventListener("keydown", event => {
  if (event.key === "Enter") {
    event.preventDefault(); event.currentTarget.blur();
  } else if (event.key === "Escape") {
    event.preventDefault();
    event.currentTarget.textContent = servoPreview.nodes[servoPreview.selected]?.name ?? "Select a component";
    event.currentTarget.blur();
  }
});

let previewDraggedNode = null;

function canReparentPreviewNode(index, parent) {
  if (!servoPreview || !Number.isInteger(index) || !servoPreview.nodes[index]) return false;
  const partner = previewServoPartner(index);
  const seen = new Set([index + 1]);
  for (let ancestor = parent; ancestor !== null; ancestor = servoPreview.nodes[ancestor - 1].parent) {
    if (!Number.isInteger(ancestor) || !servoPreview.nodes[ancestor - 1] || seen.has(ancestor)) return false;
    if (ancestor === partner + 1) return false;
    seen.add(ancestor);
  }
  return true;
}

// Keep the mechanical pair together while allowing either end to be mounted.
function previewServoPartner(index) {
  const node = servoPreview.nodes[index];
  const capability = componentRegistry.hasCapability(node, "servoShaft") ? "actuator" :
    componentRegistry.hasCapability(node, "actuator") ? "servoShaft" : null;
  const parent = node.parent === null ? -1 : node.parent - 1;
  if (capability === "actuator" && parent >= 0) {
    const body = servoPreview.nodes[parent];
    if (body.parent !== null && componentRegistry.hasCapability(servoPreview.nodes[body.parent - 1], "servoShaft")) return -1;
  }
  return capability && parent >= 0 && componentRegistry.hasCapability(servoPreview.nodes[parent], capability) ? parent : -1;
}

function reparentPreviewNode(index, parent) {
  if (!servoPreview?.editing || document.getElementById("previewSave").disabled ||
      !canReparentPreviewNode(index, parent) || servoPreview.nodes[index].parent === parent) return;
  const partner = previewServoPartner(index);
  if (partner >= 0) {
    servoPreview.nodes[partner].parent = index + 1;
    servoPreview.nodes[partner].position = [0, 0, 0];
    servoPreview.nodes[partner].rotation = [0, 0, 0];
  }
  servoPreview.nodes[index].parent = parent;
  servoPreview.selected = index;
  initializePreviewPlacementControls();
  setText("previewSaveStatus", "Unsaved parent changes");
  drawServoPreview();
}

function clearPreviewTreeDrag() {
  previewDraggedNode = null;
  document.querySelectorAll(".tree-drop-target, .tree-dragging").forEach(element => {
    element.classList.remove("tree-drop-target", "tree-dragging");
  });
}

function bindPreviewTreeDrop(target, parent) {
  const canDrop = () => previewDraggedNode !== null && servoPreview?.editing &&
    !document.getElementById("previewSave").disabled &&
    canReparentPreviewNode(servoPreview.nodes.indexOf(previewDraggedNode), parent) && previewDraggedNode.parent !== parent;
  target.addEventListener("dragover", event => {
    if (!canDrop()) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    target.classList.add("tree-drop-target");
  });
  target.addEventListener("dragleave", () => target.classList.remove("tree-drop-target"));
  target.addEventListener("drop", event => {
    event.preventDefault();
    if (canDrop()) reparentPreviewNode(servoPreview.nodes.indexOf(previewDraggedNode), parent);
    clearPreviewTreeDrag();
  });
}

function renderComponentChoices() {
  const host = document.getElementById("setupComponentChoices");
  const picker = document.getElementById("previewAddComponent");
  host.replaceChildren();
  const groups = new Map();
  componentRegistry.choices().forEach(definition => {
    const type = definition.group ?? definition.objectType;
    if (!groups.has(type)) {
      const group = makeElement("fieldset");
      group.append(makeElement("legend", "", type));
      host.append(group);
      groups.set(type, group);
    }
    const value = definition.choice ?? definition.objectType;
    const button = makeElement("button", "component-choice", definition.label ?? definition.objectType);
    button.type = "button";
    button.setAttribute("aria-label", "Add " + (definition.label ?? definition.objectType));
    button.disabled = servoPreview.nodes.length >= 60 || definition.capabilities?.includes("actuator") &&
      servoPreview.nodes.filter(node => componentRegistry.hasCapability(node, "actuator")).length >= 20;
    button.addEventListener("click", () => {
      picker.value = value;
      updatePreviewAddButton();
      document.getElementById("previewAdd").click();
    });
    groups.get(type).append(button);
  });
}

function updatePreviewAddButton() {
  const choice = document.getElementById("previewAddComponent").value;
  const definition = componentRegistry.choice(choice);
  const isServo = definition?.capabilities?.includes("actuator");
  if (isServo && servoPreview.nodes.length > 58) {
    setText("previewSaveStatus", "A servo requires space for its body and shaft (60 component limit)."); return;
  }
  document.getElementById("previewAdd").disabled = !choice || !servoPreview ||
    servoPreview.nodes.length >= 60 || (isServo && servoPreview.nodes.filter(node => componentRegistry.hasCapability(node, "actuator")).length >= 20);
}

function refreshAddedComponent(component, node) {
  // Retain existing strips, listeners, output states and command queues.
  controllerConfiguration = previewConfigurationSnapshot();
  if (componentRegistry.hasCapability(node, "actuator")) {
    initializeServoControls([component]);
    const control = servoControls[servoControls.length - 1];
    control.ready = node.ready = offlineSimulation;
    node.outputEnabled = control.outputEnabled;
    node.enabled = !control.muted;
    [control.slider, control.muteButton, control.soloButton, control.motionButton, control.speedButton, control.reverseButton]
      .forEach(input => { input.disabled = !control.ready; });
    syncServoPower(control);
    syncMasterPower();
    setText("servoStatus" + control.channel, offlineSimulation ? "Off" : "Save and restart to connect");
    setText("pulse" + control.channel, "\u2014");
    updateSequencerControls();
  }
  if (previewPhysics && previewPhysicsEnabled) syncPreviewPhysics();
}

document.getElementById("previewAddComponent").addEventListener("change", updatePreviewAddButton);
document.getElementById("previewAdd").addEventListener("click", () => {
  const choice = document.getElementById("previewAddComponent").value;
  const definition = componentRegistry.choice(choice);
  if (!definition || !servoPreview?.editing || servoPreview.nodes.length >= 60) return;
  const isServo = definition?.capabilities?.includes("actuator");
  const components = servoPreview.configuration.components;
  if (isServo && servoPreview.nodes.filter(node => componentRegistry.hasCapability(node, "actuator")).length >= 20) {
    setText("previewSaveStatus", "A maximum of 20 servos is supported."); return;
  }
  const objectType = definition.objectType;
  let suffix = 1;
  while (components.some(component => component.name === objectType + " " + suffix) ||
      servoPreview.savedNames.includes(objectType + " " + suffix)) suffix++;
  const robot = servoPreview.nodes.find(node => componentRegistry.hasCapability(node, "root"));
  const component = { minPowerWatts: null, maxPowerWatts: null, ...JSON.parse(JSON.stringify(definition.defaults ?? {})), name: objectType + " " + suffix, objectType, parent: robot?.name ?? null,
    position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 } };
  if (isServo) {
    const used = new Set(components.filter(c => componentRegistry.hasCapability(c, "actuator")).map(c => Number(c.address) + ":" + c.channel));
    const controller = servoPreview.nodes.find(node => componentRegistry.hasCapability(node, "servoController"));
    let address = Number(controller?.i2cAddress ?? servoPreview.configuration.servoController?.address ?? "0x40"), channel = 0;
    while (used.has(address + ":" + channel)) { if (++channel === 16) { channel = 0; address++; } }
    if (address > 0x77) { setText("previewSaveStatus", "No available servo output."); return; }
    Object.assign(component, {
      address: "0x" + address.toString(16), channel, enabled: true, reversed: false, continuous: false,
      initialMotionMode: "smooth", startupAngle: 90, minAngle: 0, maxAngle: 180,
      minPulseMicroseconds: 500, maxPulseMicroseconds: 2500 });
  }
  components.push(component);
  const node = { ...component, originalName: null, parent: robot ? servoPreview.nodes.indexOf(robot) + 1 : null, position: [0, 0, 0], rotation: [0, 0, 0],
    spinAngle: 90, angle: 90, ready: false, outputEnabled: false, enabled: true };
  servoPreview.nodes.push(node);
  if (isServo) servoPreview.servoNodes.push(node);
  servoPreview.selected = servoPreview.nodes.length - 1;
  if (isServo) {
    const bodyIndex = servoPreview.selected;
    let shaftName = component.name + " Shaft", suffix = 2;
    while (components.some(entry => entry.name === shaftName) || servoPreview.savedNames.includes(shaftName)) shaftName = component.name + " Shaft " + suffix++;
    const shaft = { name: shaftName, objectType: "Servo Shaft", parent: component.name,
      position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 } };
    components.push(shaft);
    servoPreview.nodes.push({ ...shaft, originalName: null, parent: bodyIndex + 1,
      position: [0, 0, 0], rotation: [0, 0, 0], angle: 90, spinAngle: 90 });
  }
  refreshAddedComponent(component, node);

  initializePreviewPlacementControls();
  setText("previewSaveStatus", "Component added. Press Save robot to keep changes." + (isServo ? " New servos are unmuted with power off; configure their output in component Setup." : ""));
  drawServoPreview();
});

document.getElementById("previewRemove").addEventListener("click", () => {
  if (!servoPreview?.editing) return;
  let index = servoPreview.selected;
  const removed = servoPreview.nodes[index];
  if (!removed || componentRegistry.hasCapability(removed, "root")) return;
  if (componentRegistry.hasCapability(removed, "servoShaft")) return;
  const mountedShaft = previewServoPartner(index);
  if (mountedShaft >= 0) {
    removed.parent = servoPreview.nodes[mountedShaft].parent;
    servoPreview.nodes[mountedShaft].parent = index + 1;
  }
  // Remove the integral shaft first, retaining its attachments on the body.
  for (let child = servoPreview.nodes.length - 1; child >= 0; child--) {
    if (servoPreview.nodes[child].parent !== index + 1 || !componentRegistry.hasCapability(servoPreview.nodes[child], "servoShaft")) continue;
    servoPreview.nodes.forEach(node => {
      if (node.parent === child + 1) node.parent = index + 1;
      if (node.parent !== null && node.parent > child + 1) node.parent--;
    });
    servoPreview.nodes.splice(child, 1);
    servoPreview.configuration.components.splice(child, 1);
    index = servoPreview.nodes.indexOf(removed);
  }
  const removedParent = removed.parent;
  servoPreview.nodes.forEach(node => {
    if (node.parent === index + 1) node.parent = removedParent;
    if (node.parent !== null && node.parent > index + 1) node.parent--;
  });
  servoPreview.nodes.splice(index, 1);
  servoPreview.configuration.components.splice(index, 1);
  // Keep the runtime servo mapping intact until restart; setup edits must not reroute mixer commands.
  servoPreview.selected = null;
  initializePreviewPlacementControls();
  setText("previewSaveStatus", "Component removed. Press Save robot to keep changes.");
  drawServoPreview();
});

function nudgePreviewServo(axis, amount) {
  if (!servoPreview || !servoPreview.editing || !Number.isInteger(axis) || axis < 0 || axis > 5 || !Number.isFinite(amount)) return;
  const node = servoPreview.nodes[servoPreview.selected];
  if (!node) return;
  if (axis < 3) {
    // Position is stored in the parent frame; convert the component's local
    // direction into that frame, using the same rotations as its geometry.
    const direction = [0, 0, 0];
    direction[axis] = amount;
    const posed = rotateServoPoint(direction, componentRegistry.localPoseRotation(servoPreview.nodes, servoPreview.selected, false));
    const delta = rotateServoPoint(posed, componentRegistry.placementRotation(servoPreview.nodes, servoPreview.selected, false));
    node.position = node.position.map((value, index) => value + delta[index]);
  } else {
    node.rotation[axis - 3] += amount;
  }
  setText("previewSaveStatus", "Unsaved placement changes");
  initializePreviewPlacementControls();
  drawServoPreview();
}

function updatePreviewTransform() {
  if (!servoPreview) return;
  const node = servoPreview.nodes[servoPreview.selected];
  if (!node) { setText("previewTransform", ""); return; }
  const format = value => Number(value.toFixed(2));
  setText("previewTransform", node.name + " (local)\n" +
    node.position.map((value, axis) => ["X", "Y", "Z"][axis] + " " + format(value)).join("  ") + " mm\n" +
    node.rotation.map((value, axis) => ["RX", "RY", "RZ"][axis] + " " + format(value)).join("  ") + " deg");
}

function updateServoPreview(servos) {
  if (!servoPreview || offlineSimulation) return;
  if (servoPreview.servoNodes.some(node => node.continuous)) tickServoSimulation();
  servoPreview.servoNodes.forEach((node, index) => {
    const state = servos.find(servo => servo.id === index + 1);
    node.ready = !!state && state.ready;
    if (state) {
      if (Number.isFinite(state.angleDegrees)) node.angle = state.angleDegrees;
      node.outputEnabled = state.outputEnabled !== false;
      node.enabled = state.enabled !== false;
    }
  });
  setText("previewStatus", "Device commands updated: " + new Date().toLocaleTimeString());
  tickServoSimulation();
}

function rotateServoPoint(point, rotation) {
  return GhostRig.rotatePoint(point, rotation);
}

function servoWorldPoint(nodes, index, point, shaft = false) {
  return GhostRig.forRegistry(componentRegistry).worldPoint(nodes, index, point, shaft);
}

function previewWorldPoint(nodes, index, point, shaft = false) {
  const node = nodes[index];
  if (previewPhysicsEnabled && previewPhysics && !componentRegistry.getPhysics(node).real) {
    point = rotateServoPoint(point, componentRegistry.localPoseRotation(nodes, index, shaft));
    point = rotateServoPoint(point, componentRegistry.placementRotation(nodes, index, shaft)).map((value, axis) => value + node.position[axis]);
    return node.parent === null ? point : previewWorldPoint(nodes, node.parent - 1,
      componentRegistry.childMountPoint(nodes[node.parent - 1], point),
      componentRegistry.attachment(nodes, index).parentSide === "shaft");
  }
  return (previewPhysicsEnabled && previewPhysics?.point(index, point, shaft)) || servoWorldPoint(nodes, index, point, shaft);
}

function drawPreviewConstraintGuides(ctx, project, line, width, height) {
  if (!previewPhysicsEnabled || !previewPhysics) return;
  const colors = { x: "#ff7373", y: "#76e6a4", z: "#7abfff" };
  previewPhysics.constraintGuides().forEach(guide => {
    if (!guide.current) return;
    const axis = ["x", "y", "z"].indexOf(guide.axis), color = colors[guide.axis];
    const low = guide.origin[axis] + guide.min, high = guide.origin[axis] + guide.max;
    const target = [...guide.current]; target[axis] = Math.max(low, Math.min(high, guide.current[axis]));
    const start = [...target], end = [...target]; start[axis] = low; end[axis] = high;
    const tick = (point, span = 5) => {
      const a = [...point], b = [...point]; a[(axis + 1) % 3] -= span; b[(axis + 1) % 3] += span;
      line(a, b, color, 2);
    };
    ctx.save();
    if (low === high) {
      // A cross shows the held plane even when a zero-length range has no rail.
      for (const perpendicular of [(axis + 1) % 3, (axis + 2) % 3]) {
        const a = [...start], b = [...start]; a[perpendicular] -= 45; b[perpendicular] += 45;
        line(a, b, color, 2);
      }
    } else {
      line(start, end, color, 3); tick(start); tick(end);
    }
    ctx.setLineDash([5, 4]);
    if (guide.axis === "y") {
      const floor = [...target]; floor[1] = 0;
      line(floor, target, color, 1);
    }
    if (Math.abs(guide.current[axis] - target[axis]) > 0.01) line(guide.current, target, "#ff9d9d", 2);
    ctx.setLineDash([]);
    const screen = project(guide.current);
    if (screen.every(Number.isFinite)) {
      ctx.beginPath(); ctx.arc(screen[0], screen[1], 4, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill();
      const name = servoPreview.nodes[guide.index]?.name || "Null";
      const error = guide.current[axis] - target[axis];
      const text = name + " " + guide.axis.toUpperCase() + " " + guide.current[axis].toFixed(1) + " mm | " +
        (low === high ? "hold " + low.toFixed(1) : low.toFixed(1) + "…" + high.toFixed(1)) + " mm" +
        (Math.abs(error) > 0.5 ? " (error " + error.toFixed(1) + " mm)" : "");
      ctx.font = "11px system-ui";
      ctx.textAlign = screen[0] > width / 2 ? "right" : "left";
      const x = Math.max(8, Math.min(width - 8, screen[0] + (ctx.textAlign === "right" ? -8 : 8)));
      const y = Math.max(16, Math.min(height - 8, screen[1] - 12 - axis * 13));
      ctx.lineWidth = 3; ctx.strokeStyle = "#0d1822"; ctx.strokeText(text, x, y);
      ctx.fillStyle = color; ctx.fillText(text, x, y);
    }
    ctx.restore();
  });
}

function clampPreviewPitch(pitch) {
  // Include exact side, top and bottom views.
  return Math.max(-Math.PI / 2, Math.min(Math.PI / 2, pitch));
}

function previewCameraPoint(point, yaw, pitch, roll = 0) {
  const degrees = 180 / Math.PI;
  // World Y orbit first, then camera elevation: yaw must not tilt the floor.
  const orbit = rotateServoPoint(point, [0, yaw * degrees, 0]);
  const elevated = rotateServoPoint(orbit, [clampPreviewPitch(pitch) * degrees, 0, 0]);
  return roll ? rotateServoPoint(elevated, [0, 0, roll * degrees]) : elevated;
}

function cancelPreviewCameraFocus(settle = false) {
  if (!servoPreview) return;
  if (servoPreview.focusFrame) cancelAnimationFrame(servoPreview.focusFrame);
  servoPreview.focusFrame = 0;
  servoPreview.focusTransition = null;
  servoPreview.viewTransition = null;
  if (settle && Number.isInteger(servoPreview.selected) && servoPreview.nodes[servoPreview.selected]) {
    const point = previewWorldPoint(servoPreview.nodes, servoPreview.selected, [0, 0, 0]);
    [servoPreview.panX, servoPreview.panY, servoPreview.panZ] = point;
  }
}

function animatePreviewCamera(target) {
  if (!servoPreview) return;
  cancelPreviewCameraFocus();
  const view = servoPreview;
  view.focusedNode = Number.isInteger(view.selected) ? view.nodes[view.selected] : null;
  const from = {}, to = {}, delta = {};
  for (const key of ["yaw", "pitch", "roll", "zoom", "panX", "panY", "panZ"]) {
    if (!Number.isFinite(target[key])) continue;
    from[key] = view[key] ?? 0;
    to[key] = target[key];
    delta[key] = to[key] - from[key];
    if (key === "yaw" || key === "roll") delta[key] = Math.atan2(Math.sin(delta[key]), Math.cos(delta[key]));
  }
  view.viewTransition = { start: performance.now(), from, to, delta, perspective: target.perspective };
  drawServoPreview();
}

function updatePreviewCameraFocus(now = performance.now()) {
  const view = servoPreview;
  const node = Number.isInteger(view.selected) ? view.nodes[view.selected] : null;
  if (view.viewTransition && view.focusedNode === node) {
    const transition = view.viewTransition;
    const progress = Math.min(1, Math.max(0, (now - transition.start) / 350));
    const eased = progress * progress * (3 - 2 * progress);
    for (const key of Object.keys(transition.to)) view[key] = progress === 1 ? transition.to[key] : transition.from[key] + transition.delta[key] * eased;
    if (progress === 1) {
      if (typeof transition.perspective === "boolean") view.perspective = transition.perspective;
      cancelPreviewCameraFocus();
      updatePreviewProjectionButton();
      savePreviewCamera();
    } else if (!view.focusFrame) {
      view.focusFrame = requestAnimationFrame(() => {
        view.focusFrame = 0;
        if (servoPreview === view) drawServoPreview();
      });
    }
    return;
  }
  if (view.focusedNode !== node) {
    cancelPreviewCameraFocus();
    view.focusedNode = node;
    if (node) view.focusTransition = { start: now, from: [view.panX, view.panY, view.panZ] };
  }
  const transition = view.focusTransition;
  if (!transition) return;
  const target = previewWorldPoint(view.nodes, view.selected, [0, 0, 0]);
  const progress = Math.min(1, Math.max(0, (now - transition.start) / 350));
  const eased = progress * progress * (3 - 2 * progress);
  [view.panX, view.panY, view.panZ] = target.map((value, axis) =>
    transition.from[axis] + (value - transition.from[axis]) * eased);
  if (progress === 1) {
    cancelPreviewCameraFocus();
    savePreviewCamera();
  } else if (!view.focusFrame) {
    view.focusFrame = requestAnimationFrame(() => {
      view.focusFrame = 0;
      if (servoPreview === view) drawServoPreview();
    });
  }
}

function panPreviewFloor(dx, dy) {
  if (!servoPreview) return;
  const { canvas, yaw, pitch, zoom } = servoPreview;
  const scale = Math.min(canvas.clientWidth, canvas.clientHeight) / 400 * zoom;
  if (scale <= 0) return;
  // Invert the floor's screen projection so the grabbed ground follows the mouse.
  const across = -dx / scale;
  const elevation = Math.sin(clampPreviewPitch(pitch));
  // At the horizon, pan vertically rather than invert the edge-on floor.
  const forward = Math.abs(elevation) < 0.05 ? 0 : -dy / (scale * elevation);
  if (Math.abs(elevation) < 0.05) servoPreview.panY += dy / scale;
  servoPreview.panX += Math.cos(yaw) * across - Math.sin(yaw) * forward;
  servoPreview.panZ += Math.sin(yaw) * across + Math.cos(yaw) * forward;
}

function updatePreviewProjectionButton() {
  const button = document.getElementById("previewProjection");
  button.textContent = servoPreview.perspective ? "Perspective" : "Orthographic";
  button.setAttribute("aria-pressed", String(servoPreview.perspective));
}

function projectPreviewPoint(point, width, height, scale, perspective) {
  const factor = perspective ? 1000 / (1000 - point[2]) : 1;
  return [width / 2 + point[0] * scale * factor, height / 2 - point[1] * scale * factor,
    perspective ? 1000 * (factor - 1) : point[2]];
}

function clipPreviewNearPlane(points) {
  const clipped = [];
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    const insideA = a[2] <= 990, insideB = b[2] <= 990;
    if (insideA) clipped.push(a);
    if (insideA !== insideB) {
      const t = (990 - a[2]) / (b[2] - a[2]);
      clipped.push(a.map((value, axis) => value + (b[axis] - value) * t));
    }
  }
  return clipped;
}

function drawSelectedPreviewAxes(ctx, nodes, index, project, muted = false) {
  if (!nodes[index]) return;
  const origin = project(previewWorldPoint(nodes, index, [0, 0, 0]));
  if (!origin.every(Number.isFinite)) return;
  ctx.save();
  ctx.font = "bold 11px system-ui";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const axes = muted ? [["X", "#9b6d6a"], ["Y", "#6f987d"], ["Z", "#6c829f"]] :
    [["X", "#d9443c"], ["Y", "#42e76a"], ["Z", "#3979df"]];
  axes.forEach(([label, color], axis) => {
    const point = [0, 0, 0];
    point[axis] = muted ? 18 : 25;
    const end = project(previewWorldPoint(nodes, index, point));
    const dx = end[0] - origin[0], dy = end[1] - origin[1];
    const length = Math.hypot(dx, dy);
    if (!Number.isFinite(length) || length < 1) return;
    const ux = dx / length, uy = dy / length;
    ctx.beginPath();
    ctx.moveTo(origin[0], origin[1]); ctx.lineTo(end[0], end[1]);
    ctx.moveTo(end[0] - ux * 6 - uy * 3, end[1] - uy * 6 + ux * 3);
    ctx.lineTo(end[0], end[1]);
    ctx.lineTo(end[0] - ux * 6 + uy * 3, end[1] - uy * 6 - ux * 3);
    ctx.strokeStyle = "#0d1822"; ctx.lineWidth = 5; ctx.stroke();
    ctx.strokeStyle = color; ctx.lineWidth = muted ? 1.5 : 2.5; ctx.stroke();
    const x = end[0] + ux * 10, y = end[1] + uy * 10;
    ctx.strokeStyle = "#0d1822"; ctx.lineWidth = 3; ctx.strokeText(label, x, y);
    ctx.fillStyle = color; ctx.fillText(label, x, y);
  });
  ctx.restore();
}

function previewRayDistance(origin, direction, surfaces, sensorIndex, limit = 2000) {
  return GhostSensor.raycast({ origin, direction, surfaces, sensorIndex, limit }).distanceMm;
}

function createPreviewSensorSampler() {
  const nodes = servoPreview.nodes, worldPoint = previewWorldPoint;
  let scene;
  const readings = new Map();
  return index => {
    if (!readings.has(index)) {
      scene ??= GhostSensor.buildScene({ nodes, worldPoint, registry: componentRegistry, props: previewPhysics?.boxes() ?? [] });
      readings.set(index, GhostSensor.read({ nodes, index, worldPoint, scene }));
    }
    return readings.get(index);
  };
}

function setPreviewLedColor(rgb, redraw = true) {
  if (!Array.isArray(rgb) || rgb.length !== 3 || rgb.some(value => !Number.isInteger(value) || value < 0 || value > 255)) return;
  previewLedColor = [...rgb];
  if (redraw) drawServoPreview();
}

function updateComponentPanels(surfaces = null, measureSensor = createPreviewSensorSampler()) {
  componentPanels.update({ nodes: servoPreview.nodes, surfaces, worldPoint: previewWorldPoint,
    offline: offlineSimulation, sensors: sensorTelemetry, telemetryAgeMs: performance.now() - sensorTelemetryAt,
    rayDistance: previewRayDistance, measureSensor,
    servoSolo: servoControls.some(control => control.solo),
    redraw: drawServoPreview,
    openSettings: node => {
      const index = servoPreview.nodes.indexOf(node);
      if (index < 0) return;
      servoPreview.selected = index;
      selectTab(3); initializePreviewPlacementControls(); drawServoPreview();
    },
    mixChanged: () => { syncMuteSolo(); syncMasterPower(); }, change: node => {
    const index = servoPreview.nodes.indexOf(node);
    if (index < 0) return;
    Object.assign(servoPreview.configuration.components[index], componentRegistry.settings(node));
    setText("previewSaveStatus", "Unsaved component change. Use Save robot to keep it.");
    if (previewPhysicsEnabled && previewPhysics) syncPreviewPhysics();
    drawServoPreview();
  } });
}

function frameAllPreviewCamera() {
  const view = servoPreview, points = [];
  const addBox = (index, offset, dimensions, shaft = false) => {
    for (let bits = 0; bits < 8; bits++) points.push(previewWorldPoint(view.nodes, index,
      dimensions.map((size, axis) => offset[axis] + ((bits >> axis) & 1 ? 0.5 : -0.5) * size), shaft));
  };
  view.nodes.forEach((node, index) => {
    points.push(previewWorldPoint(view.nodes, index, [0, 0, 0]));
    componentRegistry.draw(node, { node, purpose: "bounds", color: "#269f89", state: { ledRgb: previewLedColor },
      box: (offset, dimensions, color, shaft) => addBox(index, offset, dimensions, shaft),
      cylinder: (offset, radius, height, color, shaft) => addBox(index, offset, [radius * 2, height, radius * 2], shaft), label() {} });
  });
  const valid = points.filter(point => point.every(Number.isFinite));
  const center = [0, 1, 2].map(axis => valid.length ? (Math.min(...valid.map(p => p[axis])) + Math.max(...valid.map(p => p[axis]))) / 2 : 0);
  const yaw = -0.6, pitch = 0.45, roll = 0;
  const projected = valid.map(point => previewCameraPoint(point.map((v, axis) => v - center[axis]), yaw, pitch, roll));
  const half = [0, 1].map(axis => Math.max(10, ...projected.map(p => Math.abs(p[axis]))));
  const width = view.canvas.clientWidth || 640, height = view.canvas.clientHeight || 480;
  const scale = Math.min(width * 0.4 / half[0], height * 0.4 / half[1]);
  return { yaw, pitch, roll, panX: center[0], panY: center[1], panZ: center[2],
    zoom: Math.max(0.001, Math.min(5, scale * 400 / Math.min(width, height))), perspective: false };
}

function drawServoPreview() {
  if (!servoPreview || !servoPreview.active) return;
  if (servoPreview.frameAllPending && servoPreview.canvas.clientWidth && servoPreview.canvas.clientHeight) {
    cancelPreviewCameraFocus();
    Object.assign(servoPreview, frameAllPreviewCamera());
    servoPreview.focusedNode = Number.isInteger(servoPreview.selected) ? servoPreview.nodes[servoPreview.selected] : null;
    servoPreview.frameAllPending = false;
    updatePreviewProjectionButton();
  }
  updatePreviewCameraFocus();
  syncSetupCameraControls();
  updateUserCameraButtons();
  const { canvas, nodes, yaw, pitch, zoom } = servoPreview;
  // Keep scene measurements current when the mixer tab hides the preview canvas.
  const width = canvas.clientWidth || 640, height = canvas.clientHeight || 480;
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio);
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.scale(ratio, ratio);
  if (!webcamStream || webcamVideo.hidden) {
    ctx.fillStyle = "#0d1822";
    ctx.fillRect(0, 0, width, height);
  }
  // The orbit centre is animated to a newly selected component; panning can offset it.
  const center = [servoPreview.panX, servoPreview.panY, servoPreview.panZ];
  const scale = Math.min(width, height) / 400 * zoom;
  const cameraPoint = point => previewCameraPoint(point.map((v, axis) => v - center[axis]), yaw, pitch, servoPreview.roll);
  const projectCamera = point => projectPreviewPoint(point, width, height, scale, servoPreview.perspective);
  const project = point => {
    const camera = cameraPoint(point);
    return servoPreview.perspective && camera[2] > 990 ? [NaN, NaN, NaN] : projectCamera(camera);
  };
  const projectPolygon = points => {
    const camera = points.map(cameraPoint);
    return (servoPreview.perspective ? clipPreviewNearPlane(camera) : camera).map(projectCamera);
  };
  // Grid planes and colored scene axes share the world origin.
  const floorY = 0;
  const gridExtent = 500;
  const gridMajorStep = 100;
  const gridStep = gridMajorStep / 10;
  const gridLine = (start, end, color, lineWidth) => {
    let startCamera = cameraPoint(start), endCamera = cameraPoint(end);
    if (servoPreview.perspective) {
      if (startCamera[2] > 990 && endCamera[2] > 990) return;
      if (startCamera[2] > 990 || endCamera[2] > 990) {
        const t = (990 - startCamera[2]) / (endCamera[2] - startCamera[2]);
        const clipped = startCamera.map((value, axis) => value + (endCamera[axis] - value) * t);
        if (startCamera[2] > 990) startCamera = clipped;
        else endCamera = clipped;
      }
    }
    const a = projectCamera(startCamera), b = projectCamera(endCamera);
    ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]);
    ctx.strokeStyle = color; ctx.lineWidth = lineWidth; ctx.stroke();
  };
  // At side presets the floor is edge-on; use a vertical background grid.
  const sideGrid = Math.abs(pitch) < 0.0001 && Math.abs(Math.sin(2 * yaw)) < 0.0001;
  const gridPoint = (across, up) => sideGrid
    ? (Math.abs(Math.cos(yaw)) > 0.5 ? [across, up, 0] : [0, up, across])
    : [across, floorY, up];
  if (servoPreview.showGrid !== false) {
    for (let offset = -gridExtent; offset <= gridExtent; offset += gridStep) {
      if (offset === 0) continue;
      const major = offset % gridMajorStep === 0;
      const color = major ? "#344959" : "#223340";
      gridLine(gridPoint(offset, -gridExtent), gridPoint(offset, gridExtent), color, major ? 1 : 0.5);
      gridLine(gridPoint(-gridExtent, offset), gridPoint(gridExtent, offset), color, major ? 1 : 0.5);
    }
    gridLine([-gridExtent, floorY, 0], [0, floorY, 0], "#af625d", 1.5);
    gridLine([0, floorY, 0], [gridExtent, floorY, 0], "#d9443c", 2.5);
    gridLine([0, floorY, -gridExtent], [0, floorY, 0], "#5d83af", 1.5);
    gridLine([0, floorY, 0], [0, floorY, gridExtent], "#3979df", 2.5);
    gridLine([0, -gridExtent, 0], [0, 0, 0], "#79df9b", 1.5);
    gridLine([0, 0, 0], [0, gridExtent, 0], "#42e76a", 2.5);
  }
  ctx.lineWidth = 1;
  const faces = [], labels = [], sensorSurfaces = [];
  function box(index, offset, dimensions, color, shaft) {
    const vertices = Array.from({ length: 8 }, (_, bits) => previewWorldPoint(nodes, index,
      dimensions.map((size, axis) => offset[axis] + ((bits >> axis) & 1 ? 0.5 : -0.5) * size), shaft));
    [[0, 1, 3, 2], [4, 6, 7, 5], [0, 4, 5, 1], [2, 3, 7, 6], [0, 2, 6, 4], [1, 5, 7, 3]].forEach(indices => {
      const world = indices.map(i => vertices[i]);
      sensorSurfaces.push({ index, vertices: world, color });
      const points = projectPolygon(world);
      if (points.length < 3) return;
      faces.push({ points, depth: points.reduce((sum, p) => sum + p[2], 0) / 4, color, selected: servoPreview.editing && index === servoPreview.selected });
    });
  }
  function cylinder(index, offset, radius, height, color, shaft, options = {}) {
    const segments = 16;
    const rings = [-0.5, 0.5].map(side => Array.from({ length: segments }, (_, i) => {
      const angle = i * Math.PI * 2 / segments;
      return previewWorldPoint(nodes, index,
        [offset[0] + Math.cos(angle) * radius, offset[1] + side * height,
          offset[2] + Math.sin(angle) * radius], shaft);
    }));
    const addFace = vertices => {
      sensorSurfaces.push({ index, vertices, color });
      const points = projectPolygon(vertices);
      if (points.length < 3) return;
      faces.push({ points,
      depth: points.reduce((sum, point) => sum + point[2], 0) / points.length,
      outline: options.outline !== false, color, selected: servoPreview.editing && index === servoPreview.selected });
    };
    rings.forEach(addFace);
    for (let i = 0; i < segments; ++i) {
      const next = (i + 1) % segments;
      addFace([rings[0][i], rings[0][next], rings[1][next], rings[1][i]]);
    }
  }
  nodes.forEach((node, index) => {
    const color = !node.ready ? "#59636d" : !node.outputEnabled ? "#b47c34" : !node.enabled ? "#477caf" : "#269f89";
    componentRegistry.draw(node, {
      purpose: "render",
      state: { ledRgb: previewLedColor },
      box: (...args) => box(index, ...args),
      cylinder: (...args) => cylinder(index, ...args),
      color,
      label: point => {
        if (!servoPreview.showLabels) return;
        const suffix = componentRegistry.hasCapability(node, "actuator") ? " \u00b7 " + servoCommandText(node, node.angle) : "";
        labels.push({ point: project(previewWorldPoint(nodes, index, point)), text: node.name + suffix });
      }
    });
  });
  if (previewPhysics) {
    previewPhysics.boxes().forEach(({ vertices, color }) => {
      [[0, 1, 3, 2], [4, 6, 7, 5], [0, 4, 5, 1], [2, 3, 7, 6], [0, 2, 6, 4], [1, 5, 7, 3]].forEach(indices => {
        const world = indices.map(i => vertices[i]);
        sensorSurfaces.push({ index: null, vertices: world, color });
        const points = projectPolygon(world);
        if (points.length >= 3) faces.push({ points, color, depth: points.reduce((sum, point) => sum + point[2], 0) / points.length });
      });
    });
  }
  renderPreviewFaces(ctx, faces, canvas.width, canvas.height, ratio);
  const measureSensor = createPreviewSensorSampler();
  updateComponentPanels(sensorSurfaces, measureSensor);
  componentRegistry.drawOverlays({ ctx, nodes, surfaces: sensorSurfaces, project, line: gridLine, ratio,
    offline: offlineSimulation, sensors: sensorTelemetry, telemetryAgeMs: performance.now() - sensorTelemetryAt,
    worldPoint: previewWorldPoint, rayDistance: previewRayDistance, measureSensor, depthBuffers: previewDepthBuffers, state: { ledRgb: previewLedColor } });
  if (previewPhysics && previewPhysicsDebug) {
    previewPhysics.debugLines().forEach(({ start, end, color }) => gridLine(start, end, color, 1));
  }
  drawPreviewConstraintGuides(ctx, project, gridLine, width, height);
  ctx.font = "12px system-ui"; ctx.textAlign = "center";
  labels.forEach(({ point, text }) => {
    if (!point.every(Number.isFinite)) return;
    ctx.lineWidth = 4; ctx.strokeStyle = "#0d1822"; ctx.strokeText(text, point[0], point[1]);
    ctx.fillStyle = "#edf5ff"; ctx.fillText(text, point[0], point[1]);
  });
  nodes.forEach((node, index) => {
    if (componentRegistry.hasCapability(node, "constraints")) drawSelectedPreviewAxes(ctx, nodes, index, project, true);
  });
  if (servoPreview.editing && !componentRegistry.hasCapability(nodes[servoPreview.selected] ?? {}, "constraints")) {
    drawSelectedPreviewAxes(ctx, nodes, servoPreview.selected, project);
  }
}

let editedServoName = null;
let editedServoIndex = -1;
const servoSettingsFields = [
  ["name", "Name", "text"], ["type", "Servo hardware type", "text"],
  ["address", "I²C address (e.g. 0x41)", "text"],
  ["channel", "Hardware channel (0-15)", "number", 0, 15],
  ["startupAngle", "Startup command (0-180; continuous: 90 = stop)", "number", 0, 180],
  ["minPulseMicroseconds", "Minimum pulse (microseconds)", "number", 500, 2500],
  ["maxPulseMicroseconds", "Maximum pulse (microseconds)", "number", 500, 2500],
  ["minAngle", "Minimum angle", "number", 0, 180],
  ["maxAngle", "Maximum angle", "number", 0],
  ["minPowerWatts", "Minimum power (W)", "number", 0],
  ["maxPowerWatts", "Maximum power (W)", "number", 0],
  ["powerVoltageVolts", "Supply voltage (V)", "number", 0.001],
  ["idleCurrentAmps", "Idle current (A)", "number", 0],
  ["runningCurrentAmps", "Running current (A)", "number", 0],
  ["peakCurrentAmps", "Peak / stall current (A)", "number", 0],
  ["initialMotionMode", "Initial motion mode", ["immediate", "smooth", "linear"]],
  ["continuous", "Continuous 360-degree servo", "checkbox"],
  ["enabled", "Enabled", "checkbox"], ["reversed", "Reversed", "checkbox"],
  ["model", "3D model", componentRegistry.models("Servo")], ["parent", "Parent component", "parent"]

];

function openServoSettings(channel) {
  if (!servoPreview) return;
  const node = servoPreview.servoNodes[channel - 1];
  if (!node) return;
  servoPreview.selected = servoPreview.nodes.indexOf(node);
  selectTab(3);
  initializePreviewPlacementControls();
  document.getElementById("setupTab").focus();
}

function renderServoComponentSettings(index) {
  const config = previewConfigurationSnapshot();
  const servo = config.components[index];
  if (!servo) return;
  editedServoIndex = index;
  editedServoName = servo.name;
  const fields = document.getElementById("servoSettingsFields");
  fields.replaceChildren();
  const servoGroup = document.getElementById("setupServoGroup");
  servoGroup.replaceChildren();
  servoGroup.hidden = false;
  const groups = [
    ["Servo", ["name", "type", "enabled"]],
    ["Controller", ["address", "channel"]],
    ["Motion", ["startupAngle", "initialMotionMode", "continuous", "reversed"]],
    ["Pulse range", ["minPulseMicroseconds", "maxPulseMicroseconds"]],
    ["Angle range", ["minAngle", "maxAngle"]],
    ["Power (V/A, or watt overrides)", ["powerVoltageVolts", "idleCurrentAmps", "runningCurrentAmps", "peakCurrentAmps", "minPowerWatts", "maxPowerWatts"]],
    ["3D model and attachment", ["model", "parent"]]
  ];
  const fieldGroups = new Map();
  groups.forEach(([title, keys]) => {
    const group = makeElement("fieldset", "servo-settings-group");
    group.append(makeElement("legend", "", title));
    const inputs = makeElement("div", "servo-settings-group-inputs");
    group.append(inputs);
    (title === "Servo" ? servoGroup : fields).append(group);
    keys.forEach(key => fieldGroups.set(key, inputs));
  });
  servoSettingsFields.forEach(([key, text, type, min, max]) => {
    const label = makeElement("label", "", text);
    const input = makeElement(Array.isArray(type) || type === "parent" ? "select" : "input");
    input.name = key;
    input.setAttribute("form", "servoSettingsForm");
    if (Array.isArray(type) || type === "parent") {
      const values = type === "parent" ? ["", ...config.components.filter(c => c !== servo).map(c => c.name)] : type;
      values.forEach(value => {
        const title = key === "model" ? componentRegistry.resolve({ objectType: "Servo", model: value })?.defaults?.type || value : value;
        const option = makeElement("option", "", title || "None (root)");
        option.value = value; input.append(option);
      });
    } else {
      input.type = type;
      if (type === "number") { input.step = key.includes(".") || (key.endsWith("PowerWatts") || key.endsWith("CurrentAmps") || key === "powerVoltageVolts") ? "any" : "1"; }
      if (min !== undefined) input.min = String(min);
      if (max !== undefined) input.max = String(max);
      input.required = type !== "checkbox" && key !== "type" && !(key.endsWith("PowerWatts") || key.endsWith("CurrentAmps") || key === "powerVoltageVolts");
      if (key === "name") input.maxLength = 31;
    }
    if ((key.endsWith("PowerWatts") || key.endsWith("CurrentAmps") || key === "powerVoltageVolts")) {
      const defaults = componentRegistry.resolve(servo).getPower(servo);
      const modelKey = key === "minPowerWatts" ? "min" : key === "maxPowerWatts" ? "max" : key === "powerVoltageVolts" ? "voltage" : key;
      input.placeholder = defaults[modelKey] == null ? "Not set" : String(defaults[modelKey]) + " (model default)";
    }
    const value = key.split(".").reduce((current, part) => current?.[part], servo);
    if (type === "checkbox") input.checked = value === true;
    else input.value = value ?? (key.includes(".") ? 0 : key === "initialMotionMode" ? "smooth" : key === "model" ? "standard" : "");
    if (type === "checkbox") label.classList.add("servo-settings-checkbox");
    label.append(input); fieldGroups.get(key).append(label);
  });
  setText("servoSettingsTitle", "Settings: " + servo.name);
  setText("servoSettingsStatus", "");
  document.getElementById("servoSettingsForm").hidden = false;
  document.getElementById("servoSettingsTitle").hidden = false;
}

function editedServoConfiguration(form) {
  const config = servoPreview ? previewConfigurationSnapshot() : JSON.parse(JSON.stringify(controllerConfiguration));
  const original = config.components[editedServoIndex];
  const servo = JSON.parse(JSON.stringify(original));
  servoSettingsFields.forEach(([key, text, type]) => {
    const input = form.elements.namedItem(key);
    const value = type === "checkbox" ? input.checked : type === "number" ?
      ((key.endsWith("PowerWatts") || key.endsWith("CurrentAmps") || key === "powerVoltageVolts") && input.value === "" ? null : Number(input.value)) : input.value;
    const parts = key.split(".");
    if (parts.length === 2) { servo[parts[0]] ||= {}; servo[parts[0]][parts[1]] = value; }
    else servo[key] = key === "parent" && value === "" ? null : value;
  });
  if (!servo.name.trim()) throw new Error("Name must not be empty.");
  const electricalKeys = ["powerVoltageVolts", "idleCurrentAmps", "runningCurrentAmps", "peakCurrentAmps"];
  if (electricalKeys.some(key => servo[key] !== (original[key] ?? null))) servo.minPowerWatts = servo.maxPowerWatts = null;
  for (const key of electricalKeys) {
    if (servo[key] !== null && (!Number.isFinite(servo[key]) || (key === "powerVoltageVolts" ? servo[key] <= 0 : servo[key] < 0))) throw new Error("Voltage must be positive; current must be nonnegative.");
  }
  componentRegistry.getPower(servo);

  for (const key of ["minPowerWatts", "maxPowerWatts"]) {
    if (servo[key] !== null && (!Number.isFinite(servo[key]) || servo[key] < 0)) throw new Error("Power must be nonnegative watts.");
  }
  if (servo.minPowerWatts !== null && servo.maxPowerWatts !== null && servo.minPowerWatts > servo.maxPowerWatts) throw new Error("Minimum power must not exceed maximum power.");
  if (!/^0x[0-9a-f]+$/i.test(servo.address) || Number(servo.address) < 0x40 || Number(servo.address) > 0x77) throw new Error("Address must be hexadecimal between 0x40 and 0x77.");
  if (servo.minPulseMicroseconds >= servo.maxPulseMicroseconds) throw new Error("Minimum pulse must be less than maximum pulse.");
  if (!Number.isInteger(servo.minAngle) || !Number.isInteger(servo.maxAngle) || servo.minAngle < 0 || servo.minAngle > 180 || servo.minAngle > servo.maxAngle) throw new Error("Minimum angle must not exceed maximum angle.");
  config.components[editedServoIndex] = servo;
  config.components.forEach(component => { if (component.parent === original.name) component.parent = servo.name; });
  const names = new Map(), outputs = new Set();
  config.components.forEach(component => {
    if (names.has(component.name)) throw new Error("Component names must be unique.");
    names.set(component.name, component);
    if (componentRegistry.hasCapability(component, "actuator")) {
      const key = Number(component.address) + ":" + component.channel;
      if (outputs.has(key)) throw new Error("That PCA9685 address/channel is already assigned to another servo.");
      outputs.add(key);
    }
  });
  config.components.forEach(component => {
    const seen = new Set([component.name]);
    for (let parent = component.parent; parent != null; parent = names.get(parent).parent) {
      if (!names.has(parent) || seen.has(parent)) throw new Error("Parent references must exist and must not form a cycle.");
      seen.add(parent);
    }
  });
  return { config, servo };
}

function applyServoSettingsConfiguration(config) {
  const nodes = createRobotNodes(config);
  servoSettingsDirty = false;
  if (servoPreview) {
    nodes.forEach((node, index) => {
      const current = servoPreview.nodes[index];
      // Keep live output state and identity while updating saved setup fields.
      for (const key of ["name", "parent", "model", "continuous", "minAngle", "maxAngle", "position", "rotation", "constraints", "rotationConstraints", "minPowerWatts", "maxPowerWatts", "powerVoltageVolts", "idleCurrentAmps", "runningCurrentAmps", "peakCurrentAmps"]) {
        current[key] = node[key];
      }
    });
    servoPreview.configuration = config;
    servoControls.forEach(control => {
      const node = servoPreview.servoNodes[control.channel - 1];
      if (!node) return;
      control.minAngle = node.minAngle; control.maxAngle = node.maxAngle;
      const [minimum, maximum] = servoCommandLimits(control);
      control.slider.min = String(minimum); control.slider.max = String(maximum);
      syncReverse(control);
    });
    initializePreviewPlacementControls();
    drawServoPreview();
  }
  controllerConfiguration = config;
}

function stageServoSettings() {
  if (!servoSettingsDirty) return;
  const form = document.getElementById("servoSettingsForm");
  if (!form.reportValidity()) throw new Error("Correct the highlighted servo settings first.");
  const { config } = editedServoConfiguration(form);
  servoSettingsDirty = false;
  applyServoSettingsConfiguration(config);
  setText("servoSettingsStatus", "Settings applied to this robot. Use Save robot in Setup to keep changes.");
}

document.getElementById("servoSettingsForm").addEventListener("input", () => { servoSettingsDirty = true; });
document.getElementById("servoSettingsForm").addEventListener("change", () => { servoSettingsDirty = true; });
document.getElementById("setupServoGroup").addEventListener("input", () => { servoSettingsDirty = true; });
document.getElementById("setupServoGroup").addEventListener("change", () => { servoSettingsDirty = true; });

// Save robot owns persistence; prevent implicit form submission on Enter.
document.getElementById("servoSettingsForm").addEventListener("submit", event => {
  event.preventDefault();
  try { stageServoSettings(); }
  catch (error) { setText("servoSettingsStatus", "Settings not applied: " + error.message); }
});

async function rebootController() {
  if (controllerRebooting || (offlineSimulation && !robotRequiresRestart)) return;
  const button = document.getElementById("rebootButton");
  stopSweep();
  stopSequence();
  controllerRebooting = true;
  setControllerOnline(false);
  commandModeRevision += 1;
  button.disabled = true;
  button.textContent = "Rebooting...";
  servoControls.forEach(control => {
    clearTimeout(control.timer);
    control.timer = null;
    control.pendingCommand = null;
  });
  setServoPlaybackLock(true);
  [sweepButton, sweepAllButton, centerButton, allServosOffButton].forEach(item => { item.disabled = true; });
  setText("connection", "Rebooting controller...");
  try {
    // Drain commands already sent before asking the controller to restart.
    await Promise.allSettled(servoControls.map(control => control.requestQueue));
    const response = await fetch("/api/reboot", { method: "POST", signal: AbortSignal.timeout(8000) });
    const message = await response.text();
    if (!response.ok) throw new Error(message || "HTTP " + response.status);
    setText("connection", "Waiting for controller to restart...");
    for (let attempt = 0; attempt < 20; ++attempt) {
      await new Promise(resolve => setTimeout(resolve, 1500));
      try {
        const statusResponse = await fetch("/api/status", { cache: "no-store", signal: AbortSignal.timeout(2000) });
        if (!statusResponse.ok) continue;
        const status = await statusResponse.json();
        const uptime = status.device?.uptimeSeconds;
        if (Number.isFinite(uptime) && (uptime < 30 || (lastDeviceUptime !== null && uptime < lastDeviceUptime))) {
          window.location.reload();
          return;
        }
      } catch (_) { /* Wi-Fi and HTTP may be unavailable briefly during restart. */ }
    }
    throw new Error("Controller has not returned yet. Reload the page when it is available.");
  } catch (error) {
    setText("connection", "Reboot: " + error.message);
    controllerRebooting = false;
    button.disabled = offlineSimulation && !robotRequiresRestart;
    button.textContent = "Reboot";
    setServoPlaybackLock(false);
    [sweepButton, sweepAllButton, centerButton].forEach(item => { item.disabled = false; });
    syncMasterPower();
    updateSequencerControls();
  }
}
document.getElementById("rebootButton").addEventListener("click", rebootController);

const servoPowerMeters = createServoPowerMeters({
  master: masterStrip.querySelector(".meter"),
  readComponents: () => servoPreview?.nodes ?? [],
  read: () => {
    const now = performance.now();
    return servoControls.map(control => {
      const component = servoPreview?.servoNodes[control.channel - 1];
      const node = offlineSimulation ? component : null;
      return {
        control,
        ready: control.ready,
        powered: isEligible(control),
        component,
        continuous: control.continuous,
        angle: node ? node.angle : estimatedCommandedAngle(control, now),
        motion: node ? node.motion : control.commandedMotion
      };
    });
  }
});

createServoMetrics({
  toggle: document.getElementById("metricsToggle"),
  panel: document.getElementById("metricsPanel"),
  canvas: document.getElementById("metricsGraph"),
  legend: document.getElementById("metricsLegend"),
  categoryButtons: document.querySelectorAll("[data-metric-category]"),
  read: () => ({ robot: servoPreview?.nodes, servos: (servoPreview?.nodes ?? []).filter(node => componentRegistry.hasCapability(node, "actuator")).map(node => ({
    id: node, name: node.name, continuous: node.continuous,
    angle: node.ready ? (node.continuous ? node.spinAngle : node.angle) : null
  })), series: servoPreview ? componentRegistry.metrics({ nodes: servoPreview.nodes,
    worldPoint: previewWorldPoint, now: performance.now() }).concat(servoPowerMeters.readMetrics().filter(metric => servoPreview.nodes.includes(metric.owner))) : [] })
});


start();


// Capture the current editor state without leaving the controller.
function prepareShopRobot() {
  try {
    if (!previewReady) throw new Error("Wait for the robot configuration to load.");
    stageServoSettings();
    const definition = previewConfigurationSnapshot();
    delete definition.camera;
    document.dispatchEvent(new CustomEvent("shop:robot", { detail: {
      name: currentRobotName || definition.components.find(component => componentRegistry.hasCapability(component, "root"))?.name || "Robot",
      definition
    } }));
  } catch (error) {
    document.getElementById("shopStatus").textContent = "Could not prepare shop data: " + error.message;
    document.getElementById("shopSend").disabled = true;
  }
}
document.addEventListener("shop:refresh", prepareShopRobot);
