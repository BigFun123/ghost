// Kinematic setup checks only. Never mutates the preview or commands hardware.
(function (scope) {
  const dot = (a, b) => a.reduce((sum, value, i) => sum + value * b[i], 0);
  const sub = (a, b) => a.map((value, i) => value - b[i]);
  const unit = a => { const size = Math.hypot(...a); return a.map(value => value / size); };
  function ancestry(nodes, index) {
    const result = [], seen = new Set();
    for (let cursor = index; cursor !== null;) {
      if (!Number.isInteger(cursor) || !nodes[cursor] || seen.has(cursor)) throw new Error("Invalid or cyclic component hierarchy.");
      seen.add(cursor); result.push(cursor);
      cursor = nodes[cursor].parent === null ? null : nodes[cursor].parent - 1;
    }
    return result;
  }
  function validate({ nodes, configuration, sensorIndex, targetIndex, panIndex, tiltIndex, worldPoint, registry, holdSeconds = 0.5, episodeSeconds = 10, diagnoseLimits = true }) {
    if (!(holdSeconds > 0 && holdSeconds <= episodeSeconds && episodeSeconds <= 60)) throw new Error("Use a positive hold time no longer than the episode (maximum 60 seconds).");
    const selected = [sensorIndex, targetIndex, panIndex, tiltIndex];
    if (selected.some(index => !Number.isInteger(index) || !nodes[index]) || new Set(selected).size !== 4) throw new Error("Select a sensor, target and two distinct joints.");
    if (nodes[sensorIndex].objectType !== "VL53L0X V2 Time of Flight Sensor" || nodes[targetIndex].objectType !== "Target") throw new Error("Select a VL53L0X sensor and a Target component.");
    const chain = ancestry(nodes, sensorIndex), targetChain = ancestry(nodes, targetIndex);
    const jointChain = chain.filter(index => nodes[index].objectType === "Servo");
    if (jointChain.length !== 2 || jointChain[0] !== tiltIndex || jointChain[1] !== panIndex) throw new Error("Select the outer servo as pan and its inner sensor-carrying servo as tilt; the sensor chain must have exactly two servos.");
    if (targetChain.some(index => registry.hasCapability(nodes[index], "actuator"))) throw new Error("The target must not be attached to a moving joint. Parent it to Scene or the fixed robot base.");
    const rootIndex = chain.at(-1);
    if (!registry.hasCapability(nodes[rootIndex], "root")) throw new Error("The pan-tilt rig must belong to a Robot base.");
    const joints = [panIndex, tiltIndex].map(index => {
      const node = nodes[index], config = configuration.components.find(component => component.name === node.name) ?? node;
      if (node.continuous || node.enabled === false) throw new Error(node.name + " must be an enabled positional servo.");
      const min = Math.max(0, node.minAngle ?? 0), max = Math.min(180, node.maxAngle ?? 180);
      const startup = config.startupAngle ?? 90;
      if (![min,max,startup].every(Number.isFinite) || max <= min || startup < min || startup > max) throw new Error(node.name + " has invalid angle limits or startup angle (supported range 0-180 degrees).");
      return { index, name: node.name, min, max, startup, reversedSlider: config.reversed === true };
    });
    const copy = JSON.parse(JSON.stringify(nodes));
    const target = worldPoint(copy, targetIndex, [0,0,0]);
    if (!target.every(Number.isFinite) || target[1] < 5) throw new Error("Raise the target: its centre must be at least 5 mm above the floor so the whole 10 mm ball is visible.");
    const ray = () => GhostSensor.sensorRay(copy,sensorIndex,worldPoint);
    const pose = angles => { joints.forEach((joint, i) => {copy[joint.index].angle = angles[i];}); return ray(); };
    // Check that each selected joint changes the sensing direction, without assuming axis names.
    const mid = joints.map(joint => (joint.min + joint.max) / 2);
    const baseRay = pose(mid), effects = joints.map((joint, i) => {
      const moved = [...mid]; moved[i] += Math.min(1,(joint.max-joint.min)/4);
      return Math.hypot(...sub(pose(moved).direction,baseRay.direction));
    });
    if (effects.some(effect => !Number.isFinite(effect) || effect < 0.00001)) throw new Error("A selected joint does not change the sensor direction. Check shaft parenting and mount rotation.");
    const score = angles => {
      const { origin, direction } = pose(angles), delta = sub(target,origin);
      return dot(unit(delta),direction);
    };
    const candidates = [];
    const samples = joints.map(joint => { const count = Math.ceil((joint.max-joint.min)/10); return Array.from({length:count+1},(_,i)=>joint.min+(joint.max-joint.min)*i/count); });
    for (const pan of samples[0]) for (const tilt of samples[1]) candidates.push({ angles:[pan,tilt], score:score([pan,tilt]) });
    candidates.sort((a,b)=>b.score-a.score);
    let solution = null, blocked = false, outOfRange = false;
    for (const candidate of candidates.slice(0,12)) {
      let angles = candidate.angles, best = candidate.score;
      for (let step = 5; step >= 0.019; step /= 2) {
        for (let iteration = 0; iteration < 24; iteration++) {
          let next = angles, nextScore = best;
          for (const dp of [-step,0,step]) for (const dt of [-step,0,step]) {
            const trial = angles.map((angle,i)=>Math.max(joints[i].min,Math.min(joints[i].max,angle+[dp,dt][i])));
            const value = score(trial);
            if (value > nextScore) {next=trial;nextScore=value;}
          }
          if (next === angles) break;
          angles=next;best=nextScore;
        }
      }
      const { origin, direction } = pose(angles), delta = sub(target,origin), along = dot(delta,direction);
      const perpendicularSquared = Math.max(0,dot(delta,delta)-along*along);
      if (along <= 0 || perpendicularSquared > 25) continue;
      const distance = along - Math.sqrt(25-perpendicularSquared);
      if (distance < 0) continue;
      if (distance > 2000) {outOfRange=true;continue;}
      const reading = GhostSensor.read({nodes:copy,index:sensorIndex,worldPoint,registry});
      if (!reading.valid || reading.hit?.kind !== "component" || reading.hit.index !== targetIndex) {blocked=true;continue;}
      solution = { angles, distanceMm:reading.distanceMm }; break;
    }
    if(!solution&&diagnoseLimits&&joints.some(joint=>joint.min>0||joint.max<180)){
      // Diagnose a limit mismatch on a copy; never widen the actual rig limits.
      const expanded=JSON.parse(JSON.stringify(nodes));
      joints.forEach(joint=>{expanded[joint.index].minAngle=0;expanded[joint.index].maxAngle=180;});
      let alternative=null;
      try{alternative=validate({nodes:expanded,configuration,sensorIndex,targetIndex,panIndex,tiltIndex,worldPoint,registry,holdSeconds,episodeSeconds,diagnoseLimits:false});}catch{/* The ordinary visibility error below remains appropriate. */}
      if(alternative){
        const violations=joints.map((joint,i)=>({joint,angle:alternative.solution.angles[i]})).filter(({joint,angle})=>angle<joint.min||angle>joint.max);
        if(violations.length)throw new Error('Target is outside the configured joint limits: '+violations.map(({joint,angle})=>joint.name+' needs about '+angle.toFixed(1)+' degrees (allowed '+joint.min+'–'+joint.max+')').join('; ')+'. Move the target into reach or review the intended joint limits. Limits were not changed.');
      }
    }
    if (!solution) throw new Error(blocked ? "Target aiming poses are occluded by the floor or another component. Move the target or clear its sightline." : outOfRange ? "Target is outside the 2000 mm simulated sensor range." : "No visible target pose found in the bounded joint search. Check placement, joint limits and mounting.");
    return { sensorIndex,targetIndex,rootIndex,joints,targetWorld:[...target],targetRadiusMm:5,fixedBase:true,holdSeconds,episodeSeconds,solution,
      notes: "Kinematic visibility only; Rapier motor settling and timed hold are evaluated separately in the isolated environment." };
  }
  scope.GhostLearningTask = { validate, ancestry };
  if (typeof module !== "undefined" && module.exports) module.exports=scope.GhostLearningTask;
})(globalThis);
