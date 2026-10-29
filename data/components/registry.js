// Model files register their own geometry and editor metadata before app.js loads.
const componentRegistry = (() => {
  const definitions = [];
  const resolve = node => definitions.find(definition => definition.objectType === (node.objectType ?? "Servo") &&
    (definition.model === undefined || definition.model === (node.model ?? "standard")));
  return {
    register(definition) {
      if (!definition.objectType || typeof definition.draw !== "function") throw new Error("A component requires an objectType and draw function.");
      if (definitions.some(saved => saved.objectType === definition.objectType && saved.model === definition.model)) throw new Error("Duplicate component model.");
      definitions.push(Object.freeze({ selectable: true, ...definition,
        defaults: { shopProductId: null, ...definition.defaults } }));
    },
    resolve,
    validateSequenceStates(states) {
      if (states === undefined) return;
      if (!Array.isArray(states) || states.length > 60) throw new Error("Invalid component sequence states");
      const names = new Set();
      for (const state of states) {
        if (!state || typeof state.name !== "string" || !state.name.trim() || state.name.length > 63 || names.has(state.name)) throw new Error("Invalid sequence component name");
        names.add(state.name);
        const definition = resolve(state);
        if (!definition?.captureSequenceState) throw new Error("Invalid sequence component type");
        for (const key of Object.keys(definition.captureSequenceState(definition.defaults))) {
          const rule = definition.numericSettings[key], value = state[key];
          if (!Number.isFinite(value) || value < rule.min || value > rule.max) throw new Error("Invalid sequence component position");
        }
      }
    },
    settings(node) {
      const definition = resolve(node);
      const settings = {};
      for (const [key, rule] of Object.entries(definition?.numericSettings ?? {})) {
        const value = node[key] ?? rule.default;
        if (!Number.isFinite(value) || value < rule.min || value > rule.max) throw new Error("Invalid component setting: " + key);
        settings[key] = value;
      }
      definition?.validate?.({ ...node, ...settings });
      return settings;
    },
    getPhysics(node) {
      const physics = resolve(node)?.getPhysics?.(node);
      if (!physics || typeof physics.real !== "boolean" || !Number.isFinite(physics.massGrams) ||
          (physics.real ? physics.massGrams <= 0 : physics.massGrams !== 0)) {
        throw new Error("Invalid physics defaults for " + (node.name ?? node.objectType));
      }
      if (node.massGrams !== undefined && (!Number.isFinite(node.massGrams) || node.massGrams <= 0)) {
        throw new Error("Mass must be greater than zero.");
      }
      return { real: physics.real, massGrams: physics.real ? node.massGrams ?? physics.massGrams : 0 };
    },
    // Capabilities describe editor roles; hooks describe local mechanics. Keep
    // model names and attachment rules in the registering component files.
    hasCapability(node, capability) { return resolve(node)?.capabilities?.includes(capability) ?? false; },
    withCapability(capability) { return definitions.find(definition => definition.capabilities?.includes(capability)); },
    attachment(nodes, index) {
      const node = nodes[index];
      const parent = node.parent == null ? null : nodes[node.parent - 1];
      const hasShaft = target => nodes.some(child => child.parent === nodes.indexOf(target) + 1 && this.hasCapability(child, "servoShaft"));
      const fixedSide = hasShaft(node) ? "body" : resolve(node)?.fixedSide?.({ node, parent, registry: this }) ?? "body";
      const parentSide = parent && this.hasCapability(parent, "actuator") ?
        (hasShaft(parent) ? (this.hasCapability(node, "servoShaft") ? "shaft" : "body") :
          (resolve(node)?.parentSide?.({ node, parent, nodes, registry: this }) ?? "body")) : "body";
      return { fixedSide, parentSide };
    },
    localPoseRotation(nodes, index, shaft) {
      const node = nodes[index];
      return resolve(node)?.localPoseRotation?.({ node, shaft, ...this.attachment(nodes, index) }) ?? [0, 0, 0];
    },
    childMountPoint(parent, point) {
      const offset = resolve(parent)?.childMountOffset?.(parent) ?? [0, 0, 0];
      return point.map((value, axis) => value + offset[axis]);
    },
    getPower(node) {
      const min = node.minPowerWatts, max = node.maxPowerWatts;
      if (Number.isFinite(min) && Number.isFinite(max) && min >= 0 && max >= min) {
        return { min, max, source: 'config' };
      }
      const defaults = resolve(node)?.getPower?.(node);
      if (!defaults || !Number.isFinite(defaults.min) || !Number.isFinite(defaults.max) ||
          defaults.min < 0 || defaults.max < defaults.min) {
        throw new Error('Invalid power defaults for ' + (node.name ?? node.objectType ?? 'Servo'));
      }
      const voltage = node.powerVoltageVolts ?? defaults.voltage;
      const idle = node.idleCurrentAmps ?? defaults.idleCurrentAmps;
      const running = node.runningCurrentAmps ?? defaults.runningCurrentAmps;
      const peak = node.peakCurrentAmps ?? defaults.peakCurrentAmps;
      if (Number.isFinite(voltage) && voltage > 0 && Number.isFinite(idle) && Number.isFinite(peak)) {
        if (idle < 0 || peak < idle || (running != null && (!Number.isFinite(running) || running < idle || running > peak))) {
          throw new Error('Current must satisfy idle <= running <= peak.');
        }
        const overridden = ['powerVoltageVolts', 'idleCurrentAmps', 'runningCurrentAmps', 'peakCurrentAmps'].some(key => node[key] != null);
        return { min: voltage * idle, running: voltage * (running ?? peak), max: voltage * peak,
          source: overridden ? 'electrical' : 'model' };
      }
      return { min: defaults.min, running: defaults.running, max: defaults.max, source: 'model' };
    },
    types: () => [...new Set(definitions.map(definition => definition.objectType))],
    hasType: type => definitions.some(definition => definition.objectType === type),
    choices: () => definitions.filter(definition => definition.selectable).sort((a, b) => (a.order ?? 100) - (b.order ?? 100)),
    choice: value => definitions.find(definition => definition.selectable && (definition.choice ?? definition.objectType) === value),
    models: type => definitions.filter(definition => definition.objectType === type && definition.model !== undefined).map(definition => definition.model),
    draw(node, context) {
      const definition = resolve(node);
      if (!definition) throw new Error("Unknown component model: " + node.objectType);
      definition.draw({ ...context, node });
    },
    metrics(context) {
      return context.nodes.flatMap((node, index) => resolve(node)?.readMetrics?.({ ...context, node, index }) ?? []);
    },
    drawOverlays(context) {
      context.nodes.forEach((node, index) => resolve(node)?.drawOverlay?.({ ...context, node, index }));
    }
  };
})();
