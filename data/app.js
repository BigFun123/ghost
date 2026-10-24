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
  { button: document.getElementById("setupTab"), panel: document.getElementById("setupPanel") }
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
const sequenceLoopInput = document.getElementById("sequenceLoop");
const sequenceFinishInput = document.getElementById("sequenceFinish");
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
let controllerRebooting = false;
let lastDeviceUptime = null;
let offlineSimulation = false;
let localConfigServer = false;
let commandModeRevision = 0;
let masterOutputsOff = false;
let sweepRunId = 0;
let sweepRunning = false;
let sequence = { loop: false, finish: false, steps: [] };
let sequenceRunId = 0;
let sequenceStepIndex = -1;
let playbackSequenceView = null;
let selectedSequenceStepIndex = -1;
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
const sequenceFilename = () => "sequence_" + selectedSequenceSlot + ".json";
const sequenceEndpoint = () => "/api/sequence/" + selectedSequenceSlot;
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
  sequence = simulationSequences.get(selectedSequenceSlot) || { loop: false, finish: false, steps: [] };
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
selectTab(1);

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
  strip.append(makeElement("div", "meter"));
  const angle = makeElement("div", "channel-readout", "0°");
  angle.id = "angle" + channel;
  angle.textContent = servoCommandText(configuration, configuration.continuous ? 90 : 0);
  strip.append(angle);

  const faderWithScale = makeElement("div", "fader-with-scale");
  const verticalControl = makeElement("div", "vertical-control");
  const slider = makeElement("input");
  slider.type = "range";
  slider.min = "0";
  slider.max = "180";
  slider.step = "1";
  slider.value = configuration.continuous ? "90" : "0";
  slider.id = "servoSlider" + channel;
  slider.setAttribute("aria-label", configuration.name + (configuration.continuous ? " direction and speed (90 stops)" : " position"));
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
  const reverseButton = makeElement("button", "mix-button reverse-button", "REVERSED");
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
  return { strip, slider, scale, muteButton, soloButton, motionButton, speedButton, reverseButton, powerButton, angle };
}

function isEligible(control) {
  const hasSolo = servoControls.some(candidate => candidate.solo);
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
  writeStepButton.disabled = locked || !allServosReady ||
    (selectedSequenceStepIndex < 0 && sequence.steps.length >= 32);
  playSequenceButton.disabled = locked || sweepRunning || sequence.steps.length === 0;
  stopSequenceButton.disabled = !sequencePlaying;
  clearSequenceButton.disabled = locked || sequence.steps.length === 0;
  sequenceSlotButtons.forEach(button => {
    // A slot click waits for the current save, including a duration input blur.
    button.disabled = controllerRebooting || sequencePlaying || sequenceLoading || sequenceApplying || !sequenceLoaded || sweepRunning;
    button.setAttribute("aria-pressed", String(button.dataset.slot === (playbackSequenceView?.slot || selectedSequenceSlot)));
  });
  document.getElementById("appendSequenceStep").disabled = locked || !allServosReady || sequence.steps.length >= 32;
  document.getElementById("appendSequenceCall").disabled = locked || sequence.steps.length >= 32;
  document.getElementById("appendSequenceColor").disabled = locked || sequence.steps.length >= 32;
  stepDurationInput.disabled = locked;
  sequenceLoopInput.disabled = locked;
  sequenceFinishInput.disabled = locked;
  playbackRateInput.disabled = locked;
  sequencerSteps.querySelectorAll("input, select, button").forEach(element => {
    if (element.id === "appendSequenceStep" || element.id === "appendSequenceCall" || element.id === "appendSequenceColor") return;
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
  sequenceLoopInput.checked = displayedSequence.loop;
  sequenceFinishInput.checked = displayedSequence.finish === true;
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
    duration.min = "100";
    duration.max = "60000";
    duration.step = "100";
    duration.value = String(step.durationMs);
    if (!overdueSequenceSteps.has(step)) duration.setAttribute("aria-label", "" + (index + 1) + " duration in milliseconds");
    duration.addEventListener("change", () => {
      const durationMs = Number(duration.value);
      if (!Number.isInteger(durationMs) || durationMs < 100 || durationMs > 60000) {
        setText("sequencerError", "Step duration must be between 100 and 60000 milliseconds.");
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
    if (step.type === "sequence") {
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
      select.dataset.sequenceCall = "true";
      select.title = "LED color step";
    } else {
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
    durationMs
  };
}

async function applySequenceStep(step, useStartupMotion = false, playbackRate = 1) {
  if (step.type === "color") {
    if (!offlineSimulation) {
      const response = await fetch("/api/led", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rgb: step.rgb }), signal: AbortSignal.timeout(3000)
      });
      if (!response.ok) throw new Error(await response.text() || "Could not set LED color");
    }
    return;
  }
  step.servoStates.forEach((state, servoIndex) => {
    if (servoControls[servoIndex]?.ready) applyServoState(servoControls[servoIndex], state);
  });
  const hasSolo = servoControls.some(control => control.solo);
  await Promise.all(step.angles.map(async (angle, servoIndex) => {
    const control = servoControls[servoIndex];
    if (!control?.ready) return;
    const enabled = !control.muted && (!hasSolo || control.solo);
    await requestServo(control, {
      angle: String(angle),
      enabled: enabled ? "1" : "0",
      smooth: useStartupMotion || control.smoothMode ? "1" : "0",
      speed: useStartupMotion ? "M" : control.motionSpeed,
      playbackRate: String(playbackRate)
    });
    control.slider.value = angle;
    setText("angle" + control.channel, servoCommandText(control, angle));
  }));
}

async function selectSequenceStep(index) {
  if (["sequence", "color"].includes(sequence.steps[index]?.type)) return;
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
  // Bits 0-2 hold mute, solo, and smooth; bits 3-4 hold low, medium, or high speed.
  const speed = control.motionSpeed === "L" ? 0 :
    control.motionSpeed === "M" ? 1 : 2;
  return (control.muted ? 1 : 0) |
    (control.solo ? 2 : 0) |
    (control.smoothMode ? 4 : 0) |
    (speed << 3);
}

function applyServoState(control, encodedState) {
  control.muted = (encodedState & 1) !== 0;
  control.solo = (encodedState & 2) !== 0;
  const overrides = sequencePlaying ? sequenceLiveOverrides.get(control) : null;
  if (overrides?.muted !== undefined) control.muted = overrides.muted;
  if (overrides?.solo !== undefined) control.solo = overrides.solo;
  control.smoothMode = (encodedState & 4) !== 0;
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
  const saving = Promise.resolve().then(async () => {
    if (pending) await pending;
    try {
      if (!offlineSimulation || localConfigServer) {
        const response = await fetch("/api/sequence/" + slot, {
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
          (offlineSimulation && !localConfigServer ? "kept in this page" :
            "saved to " + (localConfigServer ? "data/" : "") + "sequence_" + slot + ".json"));
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
  if (offlineSimulation && !localConfigServer) {
    return simulationSequences.get(slot) || (slot === selectedSequenceSlot ? sequence : { loop: false, finish: false, steps: [] });
  }
  const response = await fetch("/api/sequence/" + slot, { cache: "no-store", signal: AbortSignal.timeout(3000) });
  if (!response.ok) {
    const result = await response.text();
    throw new Error(/<[^>]+>/.test(result) ? "Could not load sequence (HTTP " + response.status + ")" : result || "HTTP " + response.status);
  }
  const saved = await response.json();
  if (typeof saved.loop !== "boolean" || (saved.finish !== undefined && typeof saved.finish !== "boolean") || !Array.isArray(saved.steps) ||
    saved.steps.length > 32 ||
    saved.steps.some(step => step?.type === "color" ?
      !Array.isArray(step.rgb) || step.rgb.length !== 3 || step.rgb.some(value => !Number.isInteger(value) || value < 0 || value > 255) ||
      !Number.isInteger(step.durationMs) || step.durationMs < 100 || step.durationMs > 60000 : step?.type === "sequence" ? !/^[a-j]$/.test(step.slot) :
      !step || !Array.isArray(step.angles) || step.angles.length !== servoControls.length ||
      (step.servoStates !== undefined &&
        (!Array.isArray(step.servoStates) ||
          step.servoStates.length !== servoControls.length ||
          step.servoStates.some(state =>
            !Number.isInteger(state) || state < 0 || state > 23))) ||
      !Number.isInteger(step.durationMs) || step.durationMs < 100 ||
      step.durationMs > 60000 ||
      step.angles.some(angle => !Number.isInteger(angle) || angle < 0 || angle > 180))) {
    throw new Error("Stored sequence data has an invalid format.");
  }
  return {
    ...saved,
    finish: saved.finish === true,
    steps: saved.steps.map(step => ["sequence", "color"].includes(step.type) ? step : ({
      ...step,
      servoStates: step.servoStates || servoControls.map(encodeServoState)
    }))
  };
}

async function loadSequence() {
  sequence = await readSequence(selectedSequenceSlot);
  sequenceLoaded = true;
  renderSequence();
  setText("sequencerStatus", sequence.steps.length + " step(s) loaded from " + (localConfigServer ? "data/" : "") + sequenceFilename());
}

async function writeSequenceStep() {
  if (controllerRebooting || sequencePlaying || sequenceSaving || sequenceLoading || sequenceApplying || !sequenceLoaded) return;
  const durationMs = Number(stepDurationInput.value);
  if (!Number.isInteger(durationMs) || durationMs < 100 || durationMs > 60000) {
    setText("sequencerError", "New step duration must be between 100 and 60000 milliseconds.");
    return;
  }
  if (!servoControls.every(control => control.ready)) {
    setText("sequencerError", "All configured servos must be available to write a step.");
    return;
  }
  if (selectedSequenceStepIndex < 0 && sequence.steps.length >= 32) {
    setText("sequencerError", "The sequence is limited to 32 steps.");
    return;
  }
  setText("sequencerError", "");
  const step = captureSequenceStep(durationMs);
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
  if (!finish) return step.durationMs / playbackRate;
  const remaining = Math.max(0, ...motionEnds.map(end => end - performance.now()));
  // Continuous servos have no destination, so their run time still comes from the step.
  const continuousDuration = servoControls.some(control => control.ready && isEligible(control) && control.continuous)
    ? step.durationMs / playbackRate : 0;
  // Yield even for immediate moves so a looping sequence remains stoppable.
  return Math.max(16, remaining, continuousDuration);
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
  let index = 0;
  let startup = true;
  try {
    const plan = [];
    const cache = new Map();
    async function expand(saved, slot, path, rootIndex = null) {
      if (path.includes(slot)) throw new Error("Circular sequence call: " + [...path, slot].map(s => s.toUpperCase()).join(" > "));
      for (let i = 0; i < saved.steps.length; i++) {
        if (runId !== sequenceRunId) return;
        const step = saved.steps[i];
        if (step.type === "sequence") {
          if ([...path, slot].includes(step.slot)) throw new Error("Circular sequence call: " + [...path, slot, step.slot].map(s => s.toUpperCase()).join(" > "));
          if (!cache.has(step.slot)) cache.set(step.slot, await readSequence(step.slot));
          if (runId !== sequenceRunId) return;
          await expand(cache.get(step.slot), step.slot, [...path, slot], rootIndex ?? i);
        } else {
          if (plan.length >= 4096) throw new Error("Sequence chain exceeds 4096 motion steps.");
          plan.push({ step, sequence: saved, finish: saved.finish, slot, index: i, rootIndex: rootIndex ?? i });
        }
      }
    }
    const hasCalls = sequence.steps.some(step => step.type === "sequence");
    if (hasCalls) await expand(sequence, selectedSequenceSlot, []);
    if (runId !== sequenceRunId) return;
    if (hasCalls && plan.length === 0) throw new Error("Sequence chain has no motion steps.");
    while (runId === sequenceRunId) {
      const entry = hasCalls ? plan[index] : null;
      const step = entry ? entry.step : sequence.steps[index];
      const finish = entry ? entry.finish : sequence.finish;
      playbackSequenceView = entry ? { sequence: entry.sequence, slot: entry.slot } : null;
      sequenceStepIndex = entry ? entry.index : index;
      renderSequence();
      setText("sequencerStatus", "Playing step " + (index + 1) +
        " of " + sequence.steps.length);
      if (entry) setText("sequencerStatus", "Playing " + entry.slot.toUpperCase() + " step " + (entry.index + 1));
      // The initial smooth move is step 1, not a separate pre-roll and hold.
      await applySequenceStep(step, startup, playbackRate);
      if (step.type !== "color") startup = false;
      if (runId !== sequenceRunId) break;
      const deadline = performance.now() + step.durationMs / playbackRate;
      const motionEnds = step.type === "color" ? [] : activeStepMotionEnds();
      await waitForStep(runId, sequenceStepWaitMilliseconds(step, playbackRate, motionEnds, step.type === "color" ? false : finish));
      if (runId !== sequenceRunId) break;
      if (!finish && motionEnds.some(end => end > deadline + 1)) {
        overdueSequenceSteps.add(step);
      }
      index += 1;
      if (index >= (hasCalls ? plan.length : sequence.steps.length)) {
        if (!sequence.loop) break;
        index = 0;
      }
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
  saveSequenceChange({ ...sequence, steps: [...sequence.steps, { type: "sequence", slot: "a" }] });
});
document.getElementById("appendSequenceColor").addEventListener("click", () => {
  if (sequencePlaying || sequenceSaving || sequenceLoading || sequenceApplying || controllerRebooting || !sequenceLoaded || sequence.steps.length >= 32) return;
  saveSequenceChange({ ...sequence, steps: [...sequence.steps, { type: "color", rgb: [0, 0, 255], durationMs: 100 }] });
});
writeStepButton.addEventListener("click", writeSequenceStep);
playSequenceButton.addEventListener("click", playSequence);
stopSequenceButton.addEventListener("click", stopSequence);
clearSequenceButton.addEventListener("click", () => {
  if (window.confirm("Delete all saved sequencer steps?")) {
    const previousSelection = selectedSequenceStepIndex;
    selectedSequenceStepIndex = -1;
    saveSequenceChange({ ...sequence, steps: [] }, previousSelection);
  }
});
sequenceLoopInput.addEventListener("change", () => {
  saveSequenceChange({ ...sequence, loop: sequenceLoopInput.checked });
});
sequenceFinishInput.addEventListener("change", () => {
  saveSequenceChange({ ...sequence, finish: sequenceFinishInput.checked });
});

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
  const target = Number(request.angle);
  if (request.smooth !== "1" || target === start) {
    control.reportedAngle = target;
    control.commandedMotion = null;
    return;
  }
  const multiplier = request.speed === "L" ? 4 : request.speed === "M" ? 2 : 1;
  const duration = Math.max(50, Math.ceil(Math.abs(target - start) * 1500 * multiplier / (180 * (Number(request.playbackRate) || 1))));
  control.commandedMotion = { start, target, duration, at, smooth: true };
}

function activeStepMotionEnds() {
  return servoControls.filter(control => control.ready && isEligible(control) && !control.continuous).map(control => {
    const motion = offlineSimulation
      ? servoPreview?.servoNodes[control.channel - 1].motion : control.commandedMotion;
    return motion ? motion.at + motion.duration : 0;
  });
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

async function performServoRequest(control, command) {
  const request = { ...command };
  // A queued step must respect mute/solo changes made since it was queued.
  if (sequencePlaying && request.enabled !== undefined) {
    request.enabled = !control.muted && (!servoControls.some(candidate => candidate.solo) || control.solo) ? "1" : "0";
  }
  // Saved steps and macros cannot restart motion while this output is off.
  if (!control.outputEnabled) delete request.angle;
  if (Object.keys(request).length === 0) return;
  if (request.angle !== undefined && request.smooth === undefined) {
    request.smooth = control.smoothMode ? "1" : "0";
  }
  if (request.angle !== undefined && request.speed === undefined) {
    request.speed = control.motionSpeed;
  }
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
      (!servoControls.some(candidate => candidate.solo) || control.solo);
    scheduleCommand(control, { enabled: enabled ? "1" : "0" });
    syncServoStateButtons(control);
  });
}

function syncServoStateButtons(control) {
  control.muteButton.setAttribute("aria-pressed", String(control.muted));
  control.soloButton.setAttribute("aria-pressed", String(control.solo));
  control.muteButton.textContent = "MUTE";
  control.soloButton.textContent = "SOLO";
}

function syncMotionMode(control) {
  control.motionButton.setAttribute("aria-pressed", String(control.smoothMode));
  control.motionButton.textContent = control.smoothMode ? "/" : "-";
  const mode = control.smoothMode ? "smooth" : "immediate";
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

function initializeServoControls(configurations) {
  configurations.forEach((configuration, index) => {
    const channel = index + 1;
    const ui = createServoStrip(configuration, channel);
    mixer.append(ui.strip);
    const control = {
      ...ui,
      channel,
      name: configuration.name,
      continuous: configuration.continuous === true,
      ready: false,
      pendingCommand: null,
      timer: null,
      inFlight: false,
      requestQueue: Promise.resolve(),
      outputEnabled: true,
      powerPending: false,
      powerRevision: 0,
      reversed: false,
      muted: false,
      solo: false,
      smoothMode: true,
      motionSpeed: "M"
    };
    syncMotionMode(control);
    syncMotionSpeed(control);
    syncReverse(control);
    syncServoPower(control);
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
      if (sequencePlaying) sequenceLiveOverrides.set(control, { ...sequenceLiveOverrides.get(control), muted: control.muted });
      syncMuteSolo();
    });
    ui.soloButton.addEventListener("click", () => {
      control.solo = !control.solo;
      if (sequencePlaying) sequenceLiveOverrides.set(control, { ...sequenceLiveOverrides.get(control), solo: control.solo });
      syncMuteSolo();
    });
    ui.motionButton.addEventListener("click", () => {
      control.smoothMode = !control.smoothMode;
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
  control.reverseButton.setAttribute("aria-pressed", String(control.reversed));
  control.reverseButton.setAttribute("aria-label", control.name + " reversed slider direction");
  control.reverseButton.title = control.continuous ? "Reverse direction/speed slider" : "Reverse position slider";
  const low = control.continuous ? "REV 100%" : "0\u00b0";
  const high = control.continuous ? "FWD 100%" : "180\u00b0";
  control.scale.firstElementChild.textContent = control.reversed ? low : high;
  control.scale.children[1].textContent = control.continuous ? "STOP" : "90\u00b0";
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
  masterOutputsOff = servoControls.length > 0 && servoControls.every(control => !control.outputEnabled);
  const allOn = servoControls.length > 0 && servoControls.every(control => control.outputEnabled);
  setText("servoPowerLabel", masterOutputsOff ? "OFF" : allOn ? "ON" : "MIXED");
  allServosOffButton.setAttribute("aria-pressed", String(allOn));
  const action = masterOutputsOff ? "Switch on all servo PWM outputs" : "Switch off all servo PWM outputs";
  allServosOffButton.setAttribute("aria-label", action);
  allServosOffButton.title = action;
  allServosOffButton.disabled = controllerRebooting || servoControls.some(control => control.powerPending);
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
  servoControls.forEach(control => setServoPower(control, enabled));
});

async function refresh() {
  if (offlineSimulation || controllerRebooting) return;
  const modeRevision = commandModeRevision;
  const powerRevisions = servoControls.map(control => control.powerRevision);
  try {
    const response = await fetch("/api/status", { cache: "no-store", signal: AbortSignal.timeout(3000) });
    if (!response.ok) throw new Error("HTTP " + response.status);
    const status = await response.json();
    if (controllerRebooting) return;
    lastDeviceUptime = status.device.uptimeSeconds;
    if (modeRevision !== commandModeRevision) return;
    updateServoPreview(status.servos);
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
      control.ready = servo.ready;
      control.reportedAngle = servo.angleDegrees;
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
  } catch (error) {
    if (controllerRebooting || modeRevision !== commandModeRevision) return;
    setOfflineSimulation(true);
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
    let configuration;
    try {
      const response = await fetch("./config.json", { cache: "no-store", signal: AbortSignal.timeout(3000) });
      if (!response.ok) throw new Error("HTTP " + response.status);
      configuration = await response.json();
    } catch (error) {
      try { configuration = JSON.parse(localStorage.getItem("servoPreviewConfig")); } catch (_) { /* No cached config. */ }
      if (!configuration) throw error;
    }
    if (!Array.isArray(configuration.components) || configuration.components.length > 60 ||
        configuration.components.some(component => !["Servo", "U Bracket Short", "U Bracket Long", "Null"].includes(component.objectType ?? "Servo"))) {
      throw new Error("Config must contain at most 60 components of type Servo, U Bracket Short, U Bracket Long or Null.");
    }
    const servoConfigurations = configuration.components.filter(component => (component.objectType ?? "Servo") === "Servo");
    if (!Array.isArray(configuration.components) ||
      servoConfigurations.length < 1 || servoConfigurations.length > 20 ||
      servoConfigurations.some(servo =>
        typeof servo.name !== "string" ||
        (servo.continuous !== undefined && typeof servo.continuous !== "boolean") ||
        (servo.initialMotionMode !== undefined &&
          servo.initialMotionMode !== "immediate" &&
          servo.initialMotionMode !== "smooth"))) {
      throw new Error(
        "config.json components must define 1-20 named servos and use an optional initialMotionMode of \"immediate\" or \"smooth\".");
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
    try { localStorage.setItem("servoPreviewConfig", JSON.stringify(configuration)); } catch (_) { /* Storage may be disabled. */ }
    controllerConfiguration = configuration;
    initializeServoControls(servoConfigurations);
    initializeServoPreview(configuration.components, configuration);
    renderSequence();
    if (localConfigServer) {
      setOfflineSimulation(true);
      document.getElementById("previewOffline").disabled = true;
      setText("connection", "Local setup — Save config writes data/config.json on this PC.");
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
    setText("connection", "Servo configuration unavailable: " + error.message);
    setText("macroError", error.message);
  }
}

// Simulation shares the command path, but never posts requests to the device.
function setOfflineSimulation(enabled) {
  if (offlineSimulation === enabled) return;
  stopSweep();
  stopSequence();
  commandModeRevision += 1;
  offlineSimulation = enabled;
  document.getElementById("rebootButton").disabled = enabled || controllerRebooting;
  document.getElementById("previewOffline").checked = enabled;
  servoControls.forEach((control, index) => {
    clearTimeout(control.timer);
    control.timer = null;
    control.pendingCommand = null;
    control.commandedMotion = null;
    control.ready = enabled;
    if (servoPreview) {
      const node = servoPreview.servoNodes[index];
      node.motion = null;
      node.ready = enabled;
      node.outputEnabled = control.outputEnabled;
      node.enabled = !control.muted;
      control.slider.value = node.angle;
    }
    syncServoPower(control);
    setText("servoStatus" + control.channel, enabled ? "Simulated" : "Connecting");
    setText("pulse" + control.channel, "�");
  });
  if (enabled) sequenceLoaded = true;
  setServoPlaybackLock(false);
  updateSequencerControls();
  setText("connection", enabled ? "Offline simulation" : "Connecting to device�");
  setText("previewStatus", enabled ? "Offline simulation � controls update this view only." : "Waiting for device angles.");
  drawServoPreview();
  if (!enabled) refresh();
}

function simulateServoRequest(control, request) {
  if (!servoPreview) return;
  const node = servoPreview.servoNodes[control.channel - 1];
  if (node.continuous) tickServoSimulation();
  if (request.outputEnabled !== undefined) {
    node.outputEnabled = request.outputEnabled === "1";
    if (!node.outputEnabled) node.motion = null;
  }
  if (request.enabled !== undefined) {
    node.enabled = request.enabled === "1";
    if (!node.enabled) node.motion = null;
  }
  if (request.angle !== undefined && node.outputEnabled && node.enabled) {
    const target = Math.max(0, Math.min(180, Number(request.angle)));
    const smooth = request.smooth === "1";
    const multiplier = request.speed === "L" ? 4 : request.speed === "M" ? 2 : 1;
    const fullRangeDuration = smooth ? 1000 * multiplier * 1.5 : 500;
    const duration = Math.max(50, Math.ceil(Math.abs(target - node.angle) * fullRangeDuration / (180 * (Number(request.playbackRate) || 1))));
    node.motion = target === node.angle || (node.continuous && !smooth) ? null : { start: node.angle, target, duration, smooth, at: performance.now() };
    if (!node.motion) node.angle = target;
  }
  tickServoSimulation();
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
    if (offlineSimulation) setText("angle" + (index + 1), servoCommandText(node, node.angle));
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
      zoom: Math.max(0.2, Math.min(5, camera.zoom)),
      panX: Number.isFinite(camera.panX) ? camera.panX : 0,
      panY: Number.isFinite(camera.panY) ? camera.panY : 0,
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
    Math.abs(view.pitch) <= Math.PI / 2 && view.zoom >= 0.2 && view.zoom <= 5 && typeof view.perspective === "boolean";
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
        setText("previewSaveStatus", slot.toUpperCase() + " stored. Use Save config in Setup to keep this view.");
        return;
      }
      const saved = servoPreview.userViews[slot];
      if (!saved) {
        setText("previewSaveStatus", slot.toUpperCase() + " has no saved view. Shift-click its button to store the current view.");
        return;
      }
      Object.assign(servoPreview, saved);
      updatePreviewProjectionButton();
      savePreviewCamera();
      drawServoPreview();
      setText("previewStatus", "View " + slot.toUpperCase());
    });
  });
  updateUserCameraButtons();
}

let previewPhysics = null;
let previewPhysicsEnabled = true;
let previewPhysicsDebug = false;
let previewPhysicsFrame = 0;
let previewPhysicsRun = 0;
let physicsControlsReady = false;

function collectPreviewPhysicsShapes() {
  const shapes = [];
  servoPreview.nodes.forEach((node, index) => {
    if (node.objectType === "Null") return;
    const model = node.objectType === "U Bracket Short" ? drawUBracketShort :
      node.objectType === "U Bracket Long" ? drawUBracketLong : node.model === "micro" ? drawMicro9g : drawTD7120;
    const add = (kind, offset, dimensions, shaft, radius, height) => {
      const origin = servoWorldPoint(servoPreview.nodes, index, [0, 0, 0], shaft);
      const axes = [0, 1, 2].map(axis => servoWorldPoint(servoPreview.nodes, index,
        [0, 1, 2].map(i => i === axis ? 1 : 0), shaft).map((value, i) => value - origin[i]));
      shapes.push({ kind, index, shaft: !!shaft, offset: [...offset], center: servoWorldPoint(servoPreview.nodes, index, offset, shaft), axes, dimensions, radius, height });
    };
    model({ box: (offset, dimensions, color, shaft) => add("box", offset, dimensions, shaft),
      cylinder: (offset, radius, height, color, shaft) => add("cylinder", offset, null, shaft, radius, height),
      color: "#269f89", label() {} });
  });
  return shapes;
}

function collectPreviewPhysicsNodes() {
  return servoPreview.nodes.map((node, index) => {
    const pose = shaft => {
      const center = servoWorldPoint(servoPreview.nodes, index, [0, 0, 0], shaft);
      const axes = [0, 1, 2].map(axis => servoWorldPoint(servoPreview.nodes, index,
        [0, 1, 2].map(i => i === axis ? 1 : 0), shaft).map((value, i) => value - center[i]));
      return { center, axes };
    };
    const parent = node.parent === null ? null : servoPreview.nodes[node.parent - 1];
    const shaftMounted = node.objectType === "Servo" && parent?.objectType === "U Bracket Long";
    const parentShaftMounted = parent?.objectType === "Servo" && parent.parent !== null &&
      servoPreview.nodes[parent.parent - 1].objectType === "U Bracket Long";
    const parentSide = parent?.objectType === "Servo" &&
      (node.objectType === "U Bracket Long" || (node.objectType === "Servo" && !parentShaftMounted)) ? "shaft" : "body";
    return { index, parent: node.parent === null ? null : node.parent - 1, parentSide,
      servo: node.objectType === "Servo", null: node.objectType === "Null", fixedSide: shaftMounted ? "shaft" : "body",
      constraints: node.objectType === "Null" ? node.constraints : undefined,
      rotationConstraints: node.objectType === "Null" ? node.rotationConstraints : undefined,
      body: pose(false), shaft: pose(true), target: (node.angle - 90) * Math.PI / 180,
      continuous: node.continuous, velocity: (node.angle - 90) / 90 * 2 * Math.PI,
      enabled: node.outputEnabled && node.enabled };
  });
}

function syncPreviewPhysics() {
  if (!previewPhysics || !servoPreview) return;
  const topology = servoPreview.nodes.map(node => [node.objectType, node.model, node.parent, ...node.position, ...node.rotation, JSON.stringify(node.constraints || {}), JSON.stringify(node.rotationConstraints || {})].join(":")).join("|");
  previewPhysics.syncRobot(collectPreviewPhysicsNodes(), collectPreviewPhysicsShapes(), topology);
}

function updatePhysicsControls() {
  document.getElementById("previewPhysics").setAttribute("aria-pressed", String(!!previewPhysics && previewPhysicsEnabled));
  ["physicsDrop", "physicsClear", "physicsDebug", "physicsResetRobot"].forEach(id => {
    document.getElementById(id).disabled = !previewPhysics || !previewPhysicsEnabled;
  });
}

async function initializePreviewPhysics() {
  if (document.getElementById("previewPhysics").disabled) return;
  if (!physicsControlsReady) {
    physicsControlsReady = true;
    document.getElementById("previewPhysics").addEventListener("click", () => {
      if (!previewPhysics) { initializePreviewPhysics(); return; }
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

function initializeServoPreview(configurations, configuration = { components: configurations }) {
  const canvas = document.getElementById("servoScene");
  const button = document.getElementById("previewToggle");
  try {
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
      if (!["Servo", "U Bracket Short", "U Bracket Long", "Null"].includes(objectType)) throw new Error("Unknown component objectType.");
      if (config.constraints !== undefined && (objectType !== "Null" || !config.constraints || typeof config.constraints !== "object" || Array.isArray(config.constraints) ||
          Object.entries(config.constraints).some(([axis, limit]) => !["x", "y", "z"].includes(axis) || !limit || typeof limit.enabled !== "boolean" ||
            !Number.isFinite(limit.min) || !Number.isFinite(limit.max) || limit.min > limit.max))) throw new Error("Invalid Null axis constraints.");
      if (config.rotationConstraints !== undefined && (objectType !== "Null" || !config.rotationConstraints || typeof config.rotationConstraints !== "object" || Array.isArray(config.rotationConstraints) ||
          Object.entries(config.rotationConstraints).some(([axis, locked]) => !["x", "y", "z"].includes(axis) || typeof locked !== "boolean"))) throw new Error("Invalid Null rotation constraints.");
      const model = config.model === undefined ? "standard" : config.model;
      if (objectType === "Servo" && !["standard", "micro"].includes(model)) throw new Error("Model must be standard or micro.");
      return { name: config.name, originalName: config.name, parent, model, objectType, constraints: config.constraints ? JSON.parse(JSON.stringify(config.constraints)) : undefined, rotationConstraints: config.rotationConstraints ? { ...config.rotationConstraints } : undefined, continuous: config.continuous === true, spinAngle: 90,
        position: vector(config.position, [(index - (configurations.length - 1) / 2) * 65, 0, 0]),
        rotation: vector(config.rotation, [0, 0, 0]), angle: config.startupAngle ?? 90,
        ready: false, outputEnabled: false, enabled: true };
    });
    nodes.forEach((node, index) => {
      const seen = new Set([index + 1]);
      for (let parent = node.parent; parent !== null; parent = nodes[parent - 1].parent) {
        if (seen.has(parent)) throw new Error("Servo parents must not form a cycle.");
        seen.add(parent);
      }
    });
    servoPreview = { nodes, servoNodes: nodes.filter(node => node.objectType === "Servo"), canvas, yaw: -0.6, pitch: 0.45, roll: 0, zoom: 1, panX: 0, panY: 0, panZ: 0, active: true, frame: 0, selected: null, perspective: false, editing: false, showLabels: false, showGrid: true, configuration };
    Object.assign(servoPreview, loadPreviewCamera(configuration));
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
    servoPreview.savedNames = configurations.map(component => component.name);
    initializePreviewPlacementControls();
    document.getElementById("previewLabels").addEventListener("change", event => {
      servoPreview.showLabels = event.target.checked;
      drawServoPreview();
    });
    document.getElementById("previewSave").addEventListener("click", savePreviewConfiguration);
    document.getElementById("previewDownload").addEventListener("click", downloadPreviewConfiguration);
    document.getElementById("previewOffline").addEventListener("change", event => setOfflineSimulation(event.target.checked));
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
      Object.assign(servoPreview, { yaw: -0.6, pitch: 0.45, roll: 0, zoom: 1, panX: 0, panY: 0, panZ: 0 }); draw();
    });
    document.getElementById("previewCameraViews").addEventListener("click", event => {
      const preset = event.target.closest("button[data-view]")?.dataset.view;
      const views = {
        left: [-Math.PI / 2, 0], right: [Math.PI / 2, 0],
        front: [0, 0], back: [Math.PI, 0],
        top: [0, Math.PI / 2], bottom: [0, -Math.PI / 2]
      };
      if (!views[preset]) return;
      [servoPreview.yaw, servoPreview.pitch] = views[preset];
      draw();
    });
    let drag = null;
    canvas.addEventListener("contextmenu", event => event.preventDefault());
    canvas.addEventListener("pointerdown", event => {
      if (drag || (event.button !== 0 && event.button !== 2)) return;
      event.preventDefault();
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
      event.preventDefault(); servoPreview.zoom = Math.max(0.2, Math.min(5, servoPreview.zoom * Math.exp(-event.deltaY * 0.001))); draw();
    }, { passive: false });
    canvas.addEventListener("keydown", event => {
      if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "+", "=", "-"].includes(event.key)) return;
      event.preventDefault();
      if (event.key === "ArrowLeft") servoPreview.yaw -= 0.1;
      if (event.key === "ArrowRight") servoPreview.yaw += 0.1;
      if (event.key === "ArrowUp") servoPreview.pitch -= 0.1;
      if (event.key === "ArrowDown") servoPreview.pitch += 0.1;
      servoPreview.pitch = clampPreviewPitch(servoPreview.pitch);
      if (["+", "="].includes(event.key)) servoPreview.zoom *= 1.1;
      if (event.key === "-") servoPreview.zoom /= 1.1;
      servoPreview.zoom = Math.max(0.2, Math.min(5, servoPreview.zoom)); draw();
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
    configuration.components[index].name = node.name;
    configuration.components[index].parent = node.parent === null ? null : servoPreview.nodes[node.parent - 1].name;
    configuration.components[index].position = vector(node.position);
    configuration.components[index].rotation = vector(node.rotation);
    if (node.objectType === "Null" && node.constraints) configuration.components[index].constraints = JSON.parse(JSON.stringify(node.constraints));
    if (node.objectType === "Null" && node.rotationConstraints) configuration.components[index].rotationConstraints = { ...node.rotationConstraints };
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
    body: JSON.stringify({ configuration, originalNames })
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
    } else if (offlineSimulation) {
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
        body: JSON.stringify({ components: placements, originalNames: servoPreview.savedNames, camera: configuration.camera })
      });
      const result = await response.text();
      if (!response.ok) throw new Error(result || "HTTP " + response.status);
      setText("previewSaveStatus", "Config saved on controller. Restart and reload to apply changes to the servo list.");
    }
    servoPreview.nodes.forEach(node => { node.originalName = node.name; });
    servoPreview.savedNames = configuration.components.map(component => component.name);
    servoPreview.configuration = configuration;
    try { localStorage.setItem("servoPreviewConfig", JSON.stringify(configuration)); } catch (_) { /* Storage may be disabled. */ }
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
  const note = makeElement("p", "subtle", "View position shifts the scene centre. Rotation orbits around it. Use Save config to keep the camera and webcam settings.");
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
  numberControl(view, "zoom", "Zoom", 0.1, 1, 0.2, 5);
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
  group.append(makeElement("p", "subtle", "World axes. Min/max are offsets in mm from the configured Null position. 0 / 0 holds an axis; unchecked is free. Use the rotation locks below to prevent tipping. Save config to keep changes."));
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

function initializePreviewPlacementControls() {
  const selection = document.getElementById("previewServoSelection");
  selection.replaceChildren();
  const rootItem = makeElement("li");
  const rootTarget = makeElement("button", "tree-root-target", "Root (drop here to detach)");
  rootTarget.type = "button";
  bindPreviewTreeDrop(rootTarget, null);
  rootItem.append(rootTarget);
  selection.append(rootItem);
  const appendChildren = (parent, list) => {
    servoPreview.nodes.forEach((node, index) => {
      if (node.parent !== parent) return;
      const item = makeElement("li");
      const button = makeElement("button", "", node.name);
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
  document.getElementById("previewAddComponent").disabled = servoPreview.nodes.length >= 60;
  updatePreviewAddButton();
  const selectedNode = servoPreview.nodes[servoPreview.selected];
  const heading = document.getElementById("setupSelectedName");
  heading.contentEditable = selectedNode ? "plaintext-only" : "false";
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
  document.getElementById("previewRemove").disabled = selectedNode.objectType === "Servo" &&
    servoPreview.nodes.filter(node => node.objectType === "Servo").length <= 1;
  setText("setupSelectedName", selectedNode.name);
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
        button.setAttribute("aria-label", "Nudge " + (field === "rotation" ? "R" : "") + axis +
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
  if (selectedNode.objectType === "Null") renderNullConstraints(selectedNode, transforms);
  updatePreviewTransform();
}

function commitPreviewComponentName() {
  if (!servoPreview?.editing || document.getElementById("previewSave").disabled) return false;
  const heading = document.getElementById("setupSelectedName");
  const index = servoPreview.selected;
  const node = servoPreview.nodes[index];
  if (!node) return true;
  const name = heading.textContent.trim();
  if (!name || new TextEncoder().encode(name).length > 31 ||
      servoPreview.nodes.some((other, otherIndex) => otherIndex !== index && other.name === name)) {
    heading.textContent = node.name;
    setText("previewSaveStatus", "Name must be unique, nonempty and at most 31 bytes.");
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
  const seen = new Set([index + 1]);
  for (let ancestor = parent; ancestor !== null; ancestor = servoPreview.nodes[ancestor - 1].parent) {
    if (!Number.isInteger(ancestor) || !servoPreview.nodes[ancestor - 1] || seen.has(ancestor)) return false;
    seen.add(ancestor);
  }
  return true;
}

function reparentPreviewNode(index, parent) {
  if (!servoPreview?.editing || document.getElementById("previewSave").disabled ||
      !canReparentPreviewNode(index, parent) || servoPreview.nodes[index].parent === parent) return;
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

function updatePreviewAddButton() {
  const choice = document.getElementById("previewAddComponent").value;
  const isServo = choice === "standard" || choice === "micro";
  document.getElementById("previewAdd").disabled = !choice || !servoPreview ||
    servoPreview.nodes.length >= 60 || (isServo && servoPreview.nodes.filter(node => node.objectType === "Servo").length >= 20);
}

document.getElementById("previewAddComponent").addEventListener("change", updatePreviewAddButton);
document.getElementById("previewAdd").addEventListener("click", () => {
  const choice = document.getElementById("previewAddComponent").value;
  if (!choice || !servoPreview?.editing || servoPreview.nodes.length >= 60) return;
  const isServo = choice === "standard" || choice === "micro";
  const components = servoPreview.configuration.components;
  if (isServo && servoPreview.nodes.filter(node => node.objectType === "Servo").length >= 20) {
    setText("previewSaveStatus", "A maximum of 20 servos is supported."); return;
  }
  const objectType = isServo ? "Servo" : choice;
  let suffix = 1;
  while (components.some(component => component.name === objectType + " " + suffix) ||
      servoPreview.savedNames.includes(objectType + " " + suffix)) suffix++;
  const component = { name: objectType + " " + suffix, objectType, parent: null,
    position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 } };
  if (isServo) {
    const used = new Set(components.filter(c => (c.objectType ?? "Servo") === "Servo").map(c => Number(c.address) + ":" + c.channel));
    let address = Number(servoPreview.configuration.servoController?.address ?? "0x40"), channel = 0;
    while (used.has(address + ":" + channel)) { if (++channel === 16) { channel = 0; address++; } }
    if (address > 0x77) { setText("previewSaveStatus", "No available servo output."); return; }
    Object.assign(component, { model: choice, type: choice === "micro" ? "MicroServo 9g" : "TD-7120",
      address: "0x" + address.toString(16), channel, enabled: false, reversed: false, continuous: false,
      initialMotionMode: "immediate", startupAngle: 90, minAngle: 0, maxAngle: 180,
      minPulseMicroseconds: 500, maxPulseMicroseconds: 2500 });
  }
  components.push(component);
  const node = { ...component, originalName: null, parent: null, position: [0, 0, 0], rotation: [0, 0, 0],
    spinAngle: 90, angle: 90, ready: false, outputEnabled: false, enabled: false };
  servoPreview.nodes.push(node);
  if (isServo) servoPreview.servoNodes.push(node);
  servoPreview.selected = servoPreview.nodes.length - 1;

  initializePreviewPlacementControls();
  setText("previewSaveStatus", "Component added. Press Save config to keep changes." + (isServo ? " New servos are disabled; configure their output in Servo settings after restart." : ""));
  drawServoPreview();
});

document.getElementById("previewRemove").addEventListener("click", () => {
  if (!servoPreview?.editing) return;
  const index = servoPreview.selected;
  const removed = servoPreview.nodes[index];
  if (!removed) return;
  if (removed.objectType === "Servo" && servoPreview.nodes.filter(node => node.objectType === "Servo").length <= 1) return;
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
  setText("previewSaveStatus", "Component removed. Press Save config to keep changes.");
  drawServoPreview();
});

function nudgePreviewServo(axis, amount) {
  if (!servoPreview || !servoPreview.editing || !Number.isInteger(axis) || axis < 0 || axis > 5 || !Number.isFinite(amount)) return;
  const node = servoPreview.nodes[servoPreview.selected];
  if (!node) return;
  const vector = axis < 3 ? node.position : node.rotation;
  vector[axis % 3] += amount;
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
  let [x, y, z] = point;
  const [a, b, c] = rotation.map(degrees => degrees * Math.PI / 180);
  [y, z] = [y * Math.cos(a) - z * Math.sin(a), y * Math.sin(a) + z * Math.cos(a)];
  [x, z] = [x * Math.cos(b) + z * Math.sin(b), -x * Math.sin(b) + z * Math.cos(b)];
  return [x * Math.cos(c) - y * Math.sin(c), x * Math.sin(c) + y * Math.cos(c), z];
}

function servoWorldPoint(nodes, index, point, shaft = false) {
  const node = nodes[index];
  if (node.objectType === "Servo") {
    const parent = node.parent === null ? null : nodes[node.parent - 1];
    const shaftMounted = parent?.objectType === "U Bracket Long";
    // When the shaft is fixed to the parent, the body turns inversely around it.
    const poseAngle = node.continuous ? node.spinAngle : node.angle;
    const angle = shaftMounted ? (shaft ? 0 : 90 - poseAngle) : (shaft ? poseAngle - 90 : 0);
    point = rotateServoPoint(point, [0, angle, 0]);
  }
  point = rotateServoPoint(point, node.rotation).map((value, axis) => value + node.position[axis]);
  if (node.parent === null) return point;
  const parent = nodes[node.parent - 1];
  const parentShaftMounted = parent.objectType === "Servo" && parent.parent !== null &&
    nodes[parent.parent - 1].objectType === "U Bracket Long";
  // Servo children follow the parent's moving side; brackets retain their mount type.
  const attachToShaft = node.objectType === "U Bracket Long" ||
    (node.objectType === "Servo" && !parentShaftMounted);
  return servoWorldPoint(nodes, node.parent - 1, point, attachToShaft);
}

function previewWorldPoint(nodes, index, point, shaft = false) {
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

function drawServoPreview() {
  if (!servoPreview || !servoPreview.active) return;
  syncSetupCameraControls();
  updateUserCameraButtons();
  const { canvas, nodes, yaw, pitch, zoom } = servoPreview;
  const width = canvas.clientWidth, height = canvas.clientHeight;
  if (!width || !height) return;
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio);
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.scale(ratio, ratio);
  if (!webcamStream || webcamVideo.hidden) {
    ctx.fillStyle = "#0d1822";
    ctx.fillRect(0, 0, width, height);
  }
  // User-controlled floor target and fixed span; servo motion never reframes the camera.
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
  const faces = [], labels = [];
  function box(index, offset, dimensions, color, shaft) {
    const vertices = Array.from({ length: 8 }, (_, bits) => previewWorldPoint(nodes, index,
      dimensions.map((size, axis) => offset[axis] + ((bits >> axis) & 1 ? 0.5 : -0.5) * size), shaft));
    [[0, 1, 3, 2], [4, 6, 7, 5], [0, 4, 5, 1], [2, 3, 7, 6], [0, 2, 6, 4], [1, 5, 7, 3]].forEach(indices => {
      const points = projectPolygon(indices.map(i => vertices[i]));
      if (points.length < 3) return;
      faces.push({ points, depth: points.reduce((sum, p) => sum + p[2], 0) / 4, color, selected: servoPreview.editing && index === servoPreview.selected });
    });
  }
  function cylinder(index, offset, radius, height, color, shaft) {
    const segments = 16;
    const rings = [-0.5, 0.5].map(side => Array.from({ length: segments }, (_, i) => {
      const angle = i * Math.PI * 2 / segments;
      return previewWorldPoint(nodes, index,
        [offset[0] + Math.cos(angle) * radius, offset[1] + side * height,
          offset[2] + Math.sin(angle) * radius], shaft);
    }));
    const addFace = vertices => {
      const points = projectPolygon(vertices);
      if (points.length < 3) return;
      faces.push({ points,
      depth: points.reduce((sum, point) => sum + point[2], 0) / points.length,
      color, selected: servoPreview.editing && index === servoPreview.selected });
    };
    rings.forEach(addFace);
    for (let i = 0; i < segments; ++i) {
      const next = (i + 1) % segments;
      addFace([rings[0][i], rings[0][next], rings[1][next], rings[1][i]]);
    }
  }
  nodes.forEach((node, index) => {
    if (node.objectType === "Null") return;
    const drawModel = node.objectType === "U Bracket Short" ? drawUBracketShort :
      node.objectType === "U Bracket Long" ? drawUBracketLong :
      node.model === "micro" ? drawMicro9g : drawTD7120;
    const color = !node.ready ? "#59636d" : !node.outputEnabled ? "#b47c34" : !node.enabled ? "#477caf" : "#269f89";
    drawModel({
      box: (...args) => box(index, ...args),
      cylinder: (...args) => cylinder(index, ...args),
      color,
      label: point => {
        if (!servoPreview.showLabels) return;
        const suffix = node.objectType === "Servo" ? " \u00b7 " + servoCommandText(node, node.angle) : "";
        labels.push({ point: project(previewWorldPoint(nodes, index, point)), text: node.name + suffix });
      }
    });
    if (node.objectType === "Servo" && node.continuous) {
      // A radial marker makes rotation visible on otherwise symmetric shaft wheels.
      box(index, [5, node.model === "micro" ? 7 : 5, 0], [6, 0.6, 1.5], "#ffe08a", true);
    }
  });
  if (previewPhysics) {
    previewPhysics.boxes().forEach(({ vertices, color }) => {
      [[0, 1, 3, 2], [4, 6, 7, 5], [0, 4, 5, 1], [2, 3, 7, 6], [0, 2, 6, 4], [1, 5, 7, 3]].forEach(indices => {
        const points = projectPolygon(indices.map(i => vertices[i]));
        if (points.length >= 3) faces.push({ points, color, depth: points.reduce((sum, point) => sum + point[2], 0) / points.length });
      });
    });
  }
  renderPreviewFaces(ctx, faces, canvas.width, canvas.height, ratio);
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
    if (node.objectType === "Null") drawSelectedPreviewAxes(ctx, nodes, index, project, true);
  });
  if (servoPreview.editing && nodes[servoPreview.selected]?.objectType !== "Null") {
    drawSelectedPreviewAxes(ctx, nodes, servoPreview.selected, project);
  }
}

let editedServoName = null;
let editedServoIndex = -1;
const servoSettingsFields = [
  ["name", "Name", "text"], ["type", "Servo hardware type", "text"],
  ["address", "PCA9685 address (e.g. 0x41)", "text"],
  ["channel", "Hardware channel (0-15)", "number", 0, 15],
  ["startupAngle", "Startup command (0-180; continuous: 90 = stop)", "number", 0, 180],
  ["minPulseMicroseconds", "Minimum pulse (microseconds)", "number", 500, 2500],
  ["maxPulseMicroseconds", "Maximum pulse (microseconds)", "number", 500, 2500],
  ["minAngle", "Minimum angle", "number", 0, 180],
  ["maxAngle", "Maximum angle", "number", 0],
  ["initialMotionMode", "Initial motion mode", ["immediate", "smooth"]],
  ["continuous", "Continuous 360-degree servo", "checkbox"],
  ["enabled", "Enabled", "checkbox"], ["reversed", "Reversed", "checkbox"],
  ["model", "3D model", ["standard", "micro"]], ["parent", "Parent component", "parent"],
  ...["position", "rotation"].flatMap(field => ["x", "y", "z"].map(axis =>
    [field + "." + axis, (field === "position" ? "Position " : "Rotation ") + axis.toUpperCase() +
      (field === "position" ? " (mm)" : " (degrees)"), "number"]))
];

function openServoSettings(channel) {
  if (!controllerConfiguration) return;
  const config = servoPreview ? previewConfigurationSnapshot() : controllerConfiguration;
  const servos = config.components.filter(component => (component.objectType ?? "Servo") === "Servo");
  const servo = servos[channel - 1];
  if (!servo) return;
  editedServoIndex = config.components.indexOf(servo);
  editedServoName = servo.name;
  const fields = document.getElementById("servoSettingsFields");
  fields.replaceChildren();
  const groups = [
    ["Servo", ["name", "type", "enabled"]],
    ["Hardware output", ["address", "channel"]],
    ["Motion", ["startupAngle", "initialMotionMode", "continuous", "reversed"]],
    ["Pulse range", ["minPulseMicroseconds", "maxPulseMicroseconds"]],
    ["Angle range", ["minAngle", "maxAngle"]],
    ["3D model and attachment", ["model", "parent"]],
    ["Position (mm)", ["position.x", "position.y", "position.z"]],
    ["Rotation (degrees)", ["rotation.x", "rotation.y", "rotation.z"]]
  ];
  const fieldGroups = new Map();
  groups.forEach(([title, keys]) => {
    const group = makeElement("fieldset", "servo-settings-group");
    group.append(makeElement("legend", "", title));
    const inputs = makeElement("div", "servo-settings-group-inputs");
    group.append(inputs);
    fields.append(group);
    keys.forEach(key => fieldGroups.set(key, inputs));
  });
  servoSettingsFields.forEach(([key, text, type, min, max]) => {
    const label = makeElement("label", "", text);
    const input = makeElement(Array.isArray(type) || type === "parent" ? "select" : "input");
    input.name = key;
    if (Array.isArray(type) || type === "parent") {
      const values = type === "parent" ? ["", ...config.components.filter(c => c !== servo).map(c => c.name)] : type;
      values.forEach(value => {
        const option = makeElement("option", "", value || "None (root)");
        option.value = value; input.append(option);
      });
    } else {
      input.type = type;
      if (type === "number") { input.step = key.includes(".") ? "any" : "1"; }
      if (min !== undefined) input.min = String(min);
      if (max !== undefined) input.max = String(max);
      input.required = type !== "checkbox" && key !== "type";
      if (key === "name") input.maxLength = 31;
    }
    const value = key.split(".").reduce((current, part) => current?.[part], servo);
    if (type === "checkbox") input.checked = value === true;
    else input.value = value ?? (key.includes(".") ? 0 : key === "initialMotionMode" ? "immediate" : key === "model" ? "standard" : "");
    if (type === "checkbox") label.classList.add("servo-settings-checkbox");
    label.append(input); fieldGroups.get(key).append(label);
  });
  setText("servoSettingsTitle", "Settings: " + servo.name);
  setText("servoSettingsStatus", "");
  document.getElementById("servoSettingsForm").hidden = false;
  selectTab(2);
  document.getElementById("servoSettingsTab").focus();
}

function editedServoConfiguration(form) {
  const config = servoPreview ? previewConfigurationSnapshot() : JSON.parse(JSON.stringify(controllerConfiguration));
  const original = config.components[editedServoIndex];
  const servo = JSON.parse(JSON.stringify(original));
  servoSettingsFields.forEach(([key, text, type]) => {
    const input = form.elements.namedItem(key);
    const value = type === "checkbox" ? input.checked : type === "number" ? Number(input.value) : input.value;
    const parts = key.split(".");
    if (parts.length === 2) { servo[parts[0]] ||= {}; servo[parts[0]][parts[1]] = value; }
    else servo[key] = key === "parent" && value === "" ? null : value;
  });
  if (!servo.name.trim()) throw new Error("Name must not be empty.");
  if (!/^0x[0-9a-f]+$/i.test(servo.address) || Number(servo.address) < 0x40 || Number(servo.address) > 0x77) throw new Error("Address must be hexadecimal between 0x40 and 0x77.");
  if (servo.minPulseMicroseconds >= servo.maxPulseMicroseconds) throw new Error("Minimum pulse must be less than maximum pulse.");
  if (servo.minAngle > servo.maxAngle) throw new Error("Minimum angle must not exceed maximum angle.");
  config.components[editedServoIndex] = servo;
  config.components.forEach(component => { if (component.parent === original.name) component.parent = servo.name; });
  const names = new Map(), outputs = new Set();
  config.components.forEach(component => {
    if (names.has(component.name)) throw new Error("Component names must be unique.");
    names.set(component.name, component);
    if ((component.objectType ?? "Servo") === "Servo") {
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

document.getElementById("servoSettingsBack").addEventListener("click", () => selectTab(1));
document.getElementById("servoSettingsForm").addEventListener("submit", async event => {
  event.preventDefault();
  const form = event.currentTarget;
  if (controllerRebooting || !form.reportValidity()) return;
  const button = document.getElementById("servoSettingsSave");
  if (button.disabled) return;
  try {
    const { config, servo } = editedServoConfiguration(form);
    button.disabled = true;
    setText("servoSettingsStatus", "Saving...");
    if (localConfigServer) {
      setText("servoSettingsStatus", await saveLocalConfiguration(config));
      if (servoPreview) servoPreview.savedNames = config.components.map(component => component.name);
    } else if (offlineSimulation) {
      const url = URL.createObjectURL(new Blob([JSON.stringify(config, null, 2) + "\n"], { type: "application/json" }));
      const link = makeElement("a"); link.href = url; link.download = "config.json";
      document.body.append(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setText("servoSettingsStatus", "Edited config downloaded. Replace data/config.json with this file; the controller was not changed.");
    } else {
      const response = await fetch("/api/config/servo", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ originalName: editedServoName, servo, camera: config.camera }) });
      const result = await response.text();
      if (!response.ok) throw new Error(result || "HTTP " + response.status);
      setText("servoSettingsStatus", "Saved. Restart the controller and reload this page to apply the new settings.");
    }
    controllerConfiguration = config;
    if (servoPreview) servoPreview.configuration = config;
    editedServoName = servo.name;
    try { localStorage.setItem("servoPreviewConfig", JSON.stringify(config)); } catch (_) { /* Storage may be disabled. */ }
  } catch (error) {
    setText("servoSettingsStatus", "Save failed: " + error.message);
  } finally { button.disabled = false; }
});

async function rebootController() {
  if (controllerRebooting || offlineSimulation) return;
  const button = document.getElementById("rebootButton");
  stopSweep();
  stopSequence();
  controllerRebooting = true;
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
    button.disabled = offlineSimulation;
    button.textContent = "Reboot";
    setServoPlaybackLock(false);
    [sweepButton, sweepAllButton, centerButton].forEach(item => { item.disabled = false; });
    syncMasterPower();
    updateSequencerControls();
  }
}
document.getElementById("rebootButton").addEventListener("click", rebootController);

start();
