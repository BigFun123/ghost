// Component-owned panels share lifecycle and scene data without app model dispatch.
const componentPanels = (() => {
  const panels = new Map();
  const cameraVisibility = new WeakMap();
  let latestContext;
  const controls = () => [...panels.values()].flat().filter(view => view.control);
  const mixer = {
    hasSolo: () => Boolean(latestContext?.servoSolo) || controls().some(view => view.control.solo),
    changed: () => latestContext?.mixChanged?.()
  };
  function createCameraPanel({ kind, model, location, node, openSettings } = {}) {
    if (!cameraVisibility.has(node)) cameraVisibility.set(node, { visible: true });
    const visibility = cameraVisibility.get(node);
    const element = document.createElement("section");
    let eye;
    if (location === "mixer") {
      eye = document.createElement("button");
      eye.type = "button"; eye.className = "mix-button servo-power camera-power";
      eye.textContent = "\u23fb";
      eye.addEventListener("click", () => { visibility.visible = !visibility.visible; latestContext?.redraw?.(); });
      const settings = document.createElement("button");
      settings.type = "button"; settings.className = "servo-settings-button"; settings.textContent = "\u2699";
      settings.title = "Camera setup"; settings.setAttribute("aria-label", "Camera configuration");
      settings.addEventListener("click", () => openSettings?.());
      element.append(eye, settings);
    }
    if (location === "mixer" && kind) {
      const category = document.createElement("span");
      category.className = "channel-number"; category.textContent = kind;
      element.append(category);
    }
    const heading = document.createElement("h2");
    const canvas = document.createElement("canvas");
    canvas.width = 240; canvas.height = 180;
    const caption = document.createElement("small");
    caption.textContent = "Simulated scene · +Z forward";
    element.append(heading, canvas, caption);
    return { element, update({ node, index, nodes, surfaces, worldPoint, shared }) {
      heading.textContent = location === "mixer" ? model ?? node.name : node.name;
      heading.title = node.name;
      element.hidden = location === "scene" && !visibility.visible;
      element.classList.toggle("camera-collapsed", location === "mixer" && !visibility.visible);
      canvas.hidden = caption.hidden = !visibility.visible;
      if (eye) {
        eye.setAttribute("aria-expanded", String(visibility.visible));
        eye.setAttribute("aria-pressed", String(visibility.visible));
        eye.setAttribute("aria-label", (visibility.visible ? "Switch off " : "Switch on ") + node.name + " camera preview");
        eye.title = visibility.visible ? "Switch off camera preview" : "Switch on camera preview";
      }
      canvas.setAttribute("aria-label", node.name + " simulated camera view");
      if (!visibility.visible || !surfaces) return;
      if (shared.cameraCanvas) canvas.getContext("2d").drawImage(shared.cameraCanvas, 0, 0);
      else {
        renderComponentCamera(canvas, componentRegistry.resolve(node).getCamera(node),
          { index, nodes, surfaces, worldPoint });
        shared.cameraCanvas = canvas;
      }
    } };
  }
  return {
    captureSequence() {
      return (latestContext?.nodes ?? []).flatMap(node => {
        const state = componentRegistry.resolve(node)?.captureSequenceState?.(node);
        return state ? [{ name: node.name, objectType: node.objectType, ...state }] : [];
      });
    },
    playSequence(states = [], options = {}) {
      componentRegistry.validateSequenceStates(states);
      const moves = states.map(state => {
        const node = latestContext?.nodes.find(node => node.name === state.name && node.objectType === state.objectType);
        if (!node || !componentRegistry.resolve(node)?.captureSequenceState) throw new Error("Sequence component is unavailable: " + state.name);
        componentRegistry.settings({ ...node, ...state });
        return { state, views: panels.get(node) ?? [] };
      });
      moves.forEach(({ state, views }) => views.forEach(view => view.playSequenceState?.(state, options)));
    },
    motionEnds: () => controls().map(view => view.motionEnd?.() ?? 0),
    stopSequence() { controls().forEach(view => view.stopSequence?.()); },
    resetMotionModes() { controls().forEach(view => view.resetMotionMode?.()); },
    hasSolo: () => controls().some(view => view.control.solo),
    powerStates: () => controls().map(view => view.control.outputEnabled),
    setPower(enabled) { controls().forEach(view => view.setPower?.(enabled)); },
    update(context) {
    latestContext = context;
    const { nodes } = context;
    for (const [node, views] of panels) {
      if (!nodes.includes(node)) { views.forEach(view => { view.dispose?.(); view.element.remove(); }); panels.delete(node); }
    }
    nodes.forEach((node, index) => {
      const definition = componentRegistry.resolve(node);
      if (!definition?.createPanel) return;
      if (!panels.has(node)) {
        const views = [];
        for (const [host, className, location] of [
          [document.querySelector(".mixer"), "channel-strip component-panel", "mixer"],
          [document.getElementById("componentSceneViews"), "component-scene-view", "scene"]
        ]) {
          if (!host || !(definition.panelLocations ?? ["mixer", "scene"]).includes(location)) continue;
          const view = definition.createPanel({ createCameraPanel, node, mixer, location,
            openSettings: () => latestContext?.openSettings?.(node), change: () => latestContext?.change?.(node) });
          view.element.className = className;
          host.append(view.element); views.push(view);
        }
        panels.set(node, views);
      }
      const views = panels.get(node);
      const shared = {};
      views.forEach(view => view.update({ ...context, node, index, shared }));
    });
  } };
})();
