// Simulation setup and output surface for the future learning trainer.
(function () {
  const output = document.getElementById("aiLearningOutput");
  let initializedScene = null;
  let task = null, selectionScene = null;
  let environment = null, generation = 0;
  let environmentOptions=null,baselineRun=null,runSnapshot=null;
  let policy=null,trainingRun=null,trainedUpdates=0,learningWorker=null,policyIO=false,autoRun=null,initializing=false,convergenceState=null;
  function log(message) {
    const entry = document.createElement("span");
    entry.textContent = "[" + new Date().toLocaleTimeString() + "] " + message + "\n";
    output.append(entry);
    while (output.childElementCount > 200) output.firstElementChild.remove();
    output.scrollTop = output.scrollHeight;
  }
  function scene() {
    const nodes = typeof servoPreview !== "undefined" ? servoPreview?.nodes ?? [] : [];
    return {
      nodes,
      sensors: nodes.filter(node => node.objectType === "VL53L0X V2 Time of Flight Sensor"),
      targets: nodes.filter(node => node.objectType === "Target"),
      robot: typeof currentRobotName !== "undefined" && currentRobotName || "Current robot",
      offline: typeof offlineSimulation !== "undefined" && offlineSimulation,
      fingerprint: JSON.stringify(nodes.map(node => [node.name, node.objectType, node.parent, node.position, node.rotation, node.minAngle, node.maxAngle, node.continuous, node.enabled])) + JSON.stringify(servoPreview?.configuration?.components)
    };
  }
  function refresh() {
    const current = scene();
    updateSelections(current);
    setText("aiLearningRobot", current.nodes.length ? current.robot : "No robot loaded");
    setText("aiLearningSensor", (document.getElementById("aiLearningSensorSelect").value === "" ? null : current.nodes[Number(document.getElementById("aiLearningSensorSelect").value)])?.name ?? "None found");
    setText("aiLearningTarget", (document.getElementById("aiLearningTargetSelect").value === "" ? null : current.nodes[Number(document.getElementById("aiLearningTargetSelect").value)])?.name ?? "None found");
    if (initializedScene && (!current.offline || initializedScene !== current.fingerprint)) {
      stopEnvironment();
      setText("aiLearningStatus", "Setup changed; initialize again");
      log("Simulation setup changed. Initialize again before learning.");
    }
    updateLearningView(current);
    return current;
  }
  async function initializeEnvironment(autoOwner=null) {
    if(initializing||trainingRun||baselineRun||policyIO||(autoRun&&autoRun!==autoOwner))return;
    initializing=true;
    const button = document.getElementById("aiLearningInitialize");
    const backend = document.getElementById("aiLearningBackend");
    button.disabled = backend.disabled = true;
    document.getElementById("aiLearningValidate").disabled = true;
    for (const input of selectionInputs()) input.disabled = true;
    stopEnvironment(autoOwner);
    const current = refresh();
    const revision = generation;
    try {
      if (!current.offline) throw new Error("Enable Offline simulation in the Servo tab first.");
      if (!current.nodes.length) throw new Error("Load the PanTilt robot first.");
      const checkedTask = validateTask(current);
      setText("aiLearningStatus", "Initializing TensorFlow.js...");
      setText("aiLearningRuntime", "Loading and testing...");
      learningWorker=GhostLearningWorker.create({onFatal:message=>{stopEnvironment();setText("aiLearningRuntime","Worker failed; initialize again");log(message);}});
      const componentFiles=Array.from(document.querySelectorAll?.('script[src^="./components/"]')??[],script=>script.getAttribute('src').slice(2));
      const runtime = await learningWorker.request('init',{nodes:JSON.parse(JSON.stringify(current.nodes)),task:checkedTask,componentFiles,backend:backend.value},(event,message)=>{if(event==='log'&&revision===generation)log(message);});
      setText("aiLearningRuntime", runtime.version + " / " + runtime.backend + " / Web Worker");
      const latest = scene();
      if (!latest.offline || latest.nodes !== current.nodes || latest.fingerprint !== current.fingerprint) throw new Error("Scene or mode changed during initialization. Initialize again.");
      if (revision !== generation) throw new Error("Initialization was cancelled by a scene or mode change.");
      const RAPIER = await GhostPhysics.load();
      const finalScene = scene();
      if (revision !== generation || !finalScene.offline || finalScene.nodes !== current.nodes || finalScene.fingerprint !== current.fingerprint) throw new Error("Scene or mode changed while loading physics. Initialize again.");
      environmentOptions={RAPIER,nodes:JSON.parse(JSON.stringify(current.nodes)),task:JSON.parse(JSON.stringify(checkedTask)),registry:componentRegistry,
        worldPoint:servoWorldPoint,rotatePoint:rotateServoPoint,physicsNodes:collectPreviewPhysicsNodes,physicsShapes:collectPreviewPhysicsShapes};
      environment = GhostLearningEnvironment.create(environmentOptions);
      const initial = environment.reset(episodeSeed());
      task = checkedTask;
      task.joints.forEach((joint,i)=>{const input=document.getElementById(i?'aiTestTilt':'aiTestPan');input.min=joint.min;input.max=joint.max;input.value=joint.startup;});
      initializedScene = current.fingerprint;
      updateEnvironmentControls();
      reportEnvironment(initial);
      setText("aiTrainingProgress","Ready. Train a new policy or evaluate retained weights.");
      setText("aiBaselineProgress","Ready. Choose a curriculum stage and seed split.");
      setText("aiLearningStatus", "Isolated environment and training worker ready");
      log("Setup initialized: " + current.robot + ".");
      log("Joints: " + task.joints.map(node => node.name).join(" -> ") + ".");
      log("Sensor: " + current.nodes[task.sensorIndex].name + "; target: " + current.nodes[task.targetIndex].name + ".");
      log("Environment ready: fixed base, stationary target, 120 Hz physics and 20 Hz actions. Policy training has not started.");
    } catch (error) {
      stopEnvironment();
      setText("aiLearningStatus", "Setup needs attention: " + error.message);
      log(error.message);
      setText("aiLearningRuntime", "Initialization incomplete; retry when ready");
    } finally {
      initializing=false;
      button.disabled = backend.disabled = false;
      document.getElementById("aiLearningValidate").disabled = false;
      for (const input of selectionInputs()) input.disabled = false;
      updateEnvironmentControls();
    }
  }
  document.getElementById("aiLearningInitialize").addEventListener("click",()=>initializeEnvironment());
  function selectionInputs() {
    return ["SensorSelect", "TargetSelect", "PanSelect", "TiltSelect", "Hold", "Episode"].map(id => document.getElementById("aiLearning" + id));
  }
  function updateSelections(current) {
    const identity = JSON.stringify(current.nodes.map(node => [node.name,node.objectType,node.parent]));
    if (selectionScene === identity) return;
    selectionScene = identity;
    const fill = (suffix, matches, preferred) => {
      const select = document.getElementById("aiLearning" + suffix), previous = select.value;
      select.replaceChildren();
      for (const {node,index} of matches) {
        const option = document.createElement("option"); option.value = String(index); option.textContent = node.name; select.append(option);
      }
      const choice = matches.find(item => String(item.index) === previous) ?? matches.find(item => item.index === preferred) ?? matches[0];
      select.value = choice ? String(choice.index) : "";
    };
    const entries = current.nodes.map((node,index)=>({node,index}));
    fill("SensorSelect",entries.filter(item=>item.node.objectType === "VL53L0X V2 Time of Flight Sensor"));
    fill("TargetSelect",entries.filter(item=>item.node.objectType === "Target"));
    let chain = [];
    const sensor = document.getElementById("aiLearningSensorSelect").value;
    if (sensor !== "") {
      try { chain = GhostLearningTask.ancestry(current.nodes,Number(sensor)).filter(index=>current.nodes[index].objectType === "Servo"); }
      catch { /* Validation reports an invalid hierarchy when requested. */ }
    }
    const joints=entries.filter(item=>item.node.objectType === "Servo");
    fill("PanSelect",joints,chain[1]);fill("TiltSelect",joints,chain[0]);
    stopEnvironment();
    setText("aiLearningStatus", "Select the rig, then validate or initialize");
  }
  function validateTask(current) {
    if (!current.offline) throw new Error("Enable Offline simulation in the Servo tab first.");
    const index = suffix => {
      const value = document.getElementById("aiLearning"+suffix).value;
      return value === "" ? -1 : Number(value);
    };
    const checked = GhostLearningTask.validate({ nodes:current.nodes, configuration:servoPreview.configuration,
      sensorIndex:index("SensorSelect"),targetIndex:index("TargetSelect"),panIndex:index("PanSelect"),tiltIndex:index("TiltSelect"),
      holdSeconds:Number(document.getElementById("aiLearningHold").value),episodeSeconds:Number(document.getElementById("aiLearningEpisode").value),
      worldPoint:servoWorldPoint,registry:componentRegistry });
    log("Rig validated on a copy; training base will be fixed and target stationary.");
    for (const joint of checked.joints) log(joint.name+": "+joint.min+".."+joint.max+" degrees; startup "+joint.startup+"; slider reversal "+(joint.reversedSlider?"on":"off")+" (display direction only).");
    log("Visible aiming pose: "+checked.solution.angles.map(angle=>angle.toFixed(2)).join(" / ")+" degrees; target return "+checked.solution.distanceMm.toFixed(1)+" mm.");
    log("Success rule: nearest return on selected target for "+checked.holdSeconds+" simulated seconds; episode limit "+checked.episodeSeconds+" seconds.");
    log(checked.notes);
    return checked;
  }
  for (const input of selectionInputs()) input.addEventListener("change", () => {
    stopEnvironment();
    refresh();
    setText("aiLearningStatus", "Selection changed; validate or initialize again");
  });
  document.getElementById("aiLearningValidate").addEventListener("click", () => {
    stopEnvironment();
    try { validateTask(refresh()); setText("aiLearningStatus", "Kinematic rig check passed; initialize runtime next"); }
    catch(error) { setText("aiLearningStatus", "Setup needs attention: " + error.message); log(error.message); }
  });
  document.getElementById("aiLearningReadSensor").addEventListener("click", () => {
    const current = refresh();
    if (!current.offline) { log("Enable Offline simulation to sample the simulated sensor."); return; }
    const value = document.getElementById("aiLearningSensorSelect").value;
    if (value === "") { log("Select a distance sensor first."); return; }
    const reading = runSnapshot?.reading ?? (environment ? environment.snapshot().reading : createPreviewSensorSampler()(Number(value)));
    log(reading.valid ? "Sensor return: " + reading.distanceMm.toFixed(1) + " mm; hit " + (reading.hit.name ?? reading.hit.kind) + "." : "Sensor return: no valid hit (" + reading.reason + ").");
  });
  function updateLearningView(current = scene()) {
    if (!globalThis.GhostLearningView) return;
    if (runSnapshot) { GhostLearningView.show(runSnapshot); return; }
    if (environment) { GhostLearningView.show(environment.snapshot()); return; }
    const nodes=current.nodes;
    const poses=nodes.map((node,index)=>Object.fromEntries([false,true].map(shaft=>{
      const origin=servoWorldPoint(nodes,index,[0,0,0],shaft);
      const axes=[0,1,2].map(axis=>servoWorldPoint(nodes,index,[0,1,2].map(i=>i===axis?1:0),shaft).map((value,i)=>value-origin[i]));
      return [shaft?'shaft':'body',{origin,axes}];
    })));
    const sensorValue=document.getElementById("aiLearningSensorSelect").value;
    const targetValue=document.getElementById("aiLearningTargetSelect").value;
    const sensorIndex=sensorValue===""?-1:Number(sensorValue),targetIndex=targetValue===""?-1:Number(targetValue);
    const reading=sensorIndex<0?null:GhostSensor.read({nodes,index:sensorIndex,worldPoint:servoWorldPoint,registry:componentRegistry});
    GhostLearningView.show({nodes,poses,reading,sensorIndex,targetIndex,mode:'configured'});
  }
  function updateEnvironmentControls() {
    const busy=!!baselineRun||!!trainingRun||policyIO||!!autoRun||initializing;
    document.getElementById('aiTrainingAuto').disabled=busy;
    document.getElementById('aiAutoBatches').disabled=busy;
    document.getElementById('aiAutoEarlyStop').disabled=busy;
    document.getElementById('aiTrainingQualify').disabled=busy||!convergenceState?.converged;
    document.getElementById('aiTrainingRestoreBest').disabled=busy||!convergenceState?.rows?.some(row=>row.complete);
    document.getElementById('aiLearningInitialize').disabled=busy;
    if(autoRun){document.getElementById('aiLearningBackend').disabled=true;for(const input of selectionInputs())input.disabled=true;}
    document.getElementById("aiTestRun").disabled=!environment||!policy||busy;
    document.getElementById("aiTestStop").disabled=trainingRun?.kind!=='test'||trainingRun.cancelled;
    for(const id of ['Pan','Tilt'])document.getElementById('aiTest'+id).disabled=!environment||busy;
    for (const id of ["Reset", "Step", "Stop"]) document.getElementById("aiLearning" + id).disabled = (!environment&&!autoRun) || (id!=="Stop"&&busy);
    document.getElementById("aiBaselineRun").disabled=!environment||busy;
    document.getElementById("aiBaselineCancel").disabled=!baselineRun;
    for(const id of ["Stage","Split","Count"])document.getElementById("aiBaseline"+id).disabled=busy;
    document.getElementById("aiTrainingBridge").disabled=busy||!document.getElementById("aiTrainingWarm").checked;
    document.getElementById("aiTrainingStart").disabled=!environment||busy;
    document.getElementById("aiTrainingPause").disabled=!trainingRun||!trainingRun.started||trainingRun.controlPending||trainingRun.cancelled||trainingRun.kind!=='train';
    document.getElementById("aiTrainingStop").disabled=autoRun?autoRun.cancelled:(!trainingRun||trainingRun.kind==='test');
    document.getElementById("aiTrainingStop").textContent=autoRun?"Stop auto train":['evaluate','monitor','qualify'].includes(trainingRun?.kind)?"Stop evaluation":"Stop training";
    document.getElementById("aiTrainingSave").disabled=!environment||!policy||busy;
    document.getElementById("aiTrainingLoad").disabled=!environment||busy;
    for(const id of ["Evaluate","Discard"])document.getElementById("aiTraining"+id).disabled=!environment||!policy||busy;
    for(const id of ["Stage","Seed","Updates","Rollout","Warm"])document.getElementById("aiTraining"+id).disabled=busy||(id==="Seed"&&!!policy);
  }
  document.getElementById("aiTrainingWarm").addEventListener("change",updateEnvironmentControls);
  function showConvergence(state){
    convergenceState=state;
    const value=state?.rate==null?'—':Math.round(state.rate*100)+'%';
    setText('aiConvergenceValue',value);
    document.getElementById('aiConvergenceValue').setAttribute?.('aria-label','Latest monitoring acquisition rate '+value+'; not probability of convergence');
    setText('aiConvergenceStatus',state?state.status+' / '+state.windows+'/3 checkpoints'+(state.finalBank?' / final '+(state.finalQualified?'passed':'failed or incomplete'):''):'Not measured');
    const rows=state?.rows??[],last=rows.filter(row=>row.complete).at(-1)??rows.at(-1),summary=last?.summary;
    setText('aiConvergenceDetail',summary?last.stageId+' / '+last.bank+' / '+summary.successes+'/'+summary.n+' acquired / Wilson 95% interval '+summary.interval.map(v=>(v*100).toFixed(1)+'%').join(' – ')+' / '+(last.complete?'complete checkpoint':'partial or restored; excluded from convergence'):'No monitoring checkpoints yet.');
    const list=document.getElementById('aiConvergenceHistory');list.replaceChildren();
    for(const row of rows.slice(-10).reverse()){
      const stat=row.summary,item=document.createElement('li');
      item.textContent='Update '+row.updates+' / '+row.steps+' training steps / '+row.stageId+' / '+stat.successes+'/'+stat.n+' acquired / CI '+stat.interval.map(v=>(v*100).toFixed(1)+'%').join('–')+' / median time '+(stat.seconds==null?'—':stat.seconds.toFixed(2)+' s')+' / travel '+(stat.travel==null?'—':stat.travel.toFixed(1)+'°')+' / return '+Number(stat.reward).toFixed(3)+' / false returns '+stat.falseReturns+' / false holds '+stat.falseHolds+' / timeouts '+stat.timeouts+' / invalid '+stat.invalid+(row.complete?'':' / excluded');list.append(item);
    }
  }
  document.getElementById('aiTrainingStage').addEventListener('change',()=>{if(convergenceState)showConvergence({...convergenceState,status:'Stale',converged:false});updateEnvironmentControls();});
  function clearPolicyMetrics() {
    globalThis.GhostTestProgress?.clear();showConvergence(null);
    setText("aiCurriculumProgress","Progressive starts advance on training success; this is not convergence.");
    setText('aiTestStatus','Train or load a policy, then run a test.');setText('aiTestAction','No policy action yet.');
    for(const id of ["Steps","Updates","Entropy","ValueLoss"])setText("aiPPO"+id,"—");
    setText("aiPPOTrainingSummary","No optimizer updates yet.");setText("aiPPOEvaluation","Held-out learned-policy evaluation has not run.");setText("aiPPOComparison","Evaluate a policy to compare PPO and raster on identical held-out seeds.");
  }
  function stopEnvironment(autoOwner=null) {
    if(autoRun&&autoRun!==autoOwner){autoRun.cancelled=true;setText('aiAutoProgress','Auto training cancelled: session stopped or setup changed.');}
    generation++;
    setText("aiTestStatus","Initialize the environment, then train or load a policy to test it.");
    setText("aiTestAction","No policy action yet.");
    if(trainingRun)trainingRun.cancelled=true;
    learningWorker?.dispose();learningWorker=null;policy=null;trainedUpdates=0;clearPolicyMetrics();
    setText("aiPolicyState","NO POLICY");setText("aiTrainingProgress","Initialize the environment before training.");
    if(baselineRun){baselineRun.cancelled=true;baselineRun.environment?.dispose();}
    runSnapshot=null;environmentOptions=null;
    setText("aiBaselineProgress","Initialize the environment to evaluate.");
    const wasRunning = !!environment;
    environment?.dispose(); environment = null; task = null; initializedScene = null;
    updateEnvironmentControls();
    setText("aiLearningEnvironment", "Initialize an isolated environment to begin.");
    for (const id of ["Time", "Range", "Hold", "Angles"]) setText("aiMetric"+id, "—");
    for (const id of ["Total", "Step", "Time", "Detection", "Hold", "Alignment", "Movement", "Limit", "Success", "Invalid"]) setText("aiReward"+id, "—");
    updateLearningView();
    if (wasRunning) {
      setText("aiLearningStatus", "Environment stopped; initialize again");
      log("Isolated simulation disposed. Initialize again to create a new environment.");
    }
  }
  function episodeSeed() {
    const seed = Number(document.getElementById("aiLearningSeed").value);
    if (!Number.isInteger(seed)) throw new Error("Episode seed must be an integer.");
    return seed;
  }
  function reportEnvironment(result, quiet = false) {
    const {observation,info}=result;
    const range=observation.sensor.valid?observation.sensor.distanceMm.toFixed(1)+" mm":"no hit";
    const text=info.simulationSeconds.toFixed(3)+" s; angles "+observation.jointAnglesDegrees.map(value=>value.toFixed(2)).join(" / ")+" degrees; sensor "+range+"; hold "+info.holdSeconds.toFixed(3)+" s";
    setText("aiLearningEnvironment",text);
    setText("aiMetricTime",info.simulationSeconds.toFixed(2));
    setText("aiMetricRange",observation.sensor.valid?observation.sensor.distanceMm.toFixed(1):"NO HIT");
    setText("aiMetricHold",info.holdSeconds.toFixed(2));
    setText("aiMetricAngles",observation.jointAnglesDegrees.map(value=>value.toFixed(1)).join(" / "));
    setText("aiMetricObservation",(observation.policyVector?.length ?? 29)+" values / 4-frame history");
    const terms=info.rewardTerms??{};
    const signed=value=>(value>=0?"+":"")+value.toFixed(4);
    setText("aiRewardTotal",signed(info.episodeReward??0));
    setText("aiRewardStep",signed(result.reward??0));
    for(const [key,value] of Object.entries(terms))setText("aiReward"+key[0].toUpperCase()+key.slice(1),signed(value));
    if(!quiet&&info.reason)setText("aiLearningStatus",info.reason==='success'?"Target acquired / episode complete":info.reason==='time-limit'?"Episode timeout / reset to try again":"Invalid simulation state / reset required");
    else if(!quiet)setText("aiLearningStatus",policy?"Manual environment ready; learned policy retained":"Isolated environment and training worker ready");
    updateLearningView();
    if(!quiet)log(text+(info.reason?"; "+info.reason:""));
    if(!quiet&&info.physicsTicks>0&&info.rewardTerms)log("Reward "+signed(result.reward)+" / episode "+signed(info.episodeReward)+" | "+Object.entries(terms).map(([key,value])=>key+" "+signed(value)).join("; "));
    document.getElementById("aiLearningStep").disabled=!!baselineRun||!!trainingRun||result.terminated||result.truncated;
  }
  function useEnvironment(action) {
    refresh();
    if (!environment) { log("Initialize the learning setup before stepping or resetting."); return; }
    if(baselineRun||trainingRun){log("Stop the active run before using manual episode controls.");return;}
    runSnapshot=null;
    try {reportEnvironment(action(environment));}
    catch(error){stopEnvironment();setText("aiLearningStatus","Environment stopped");log(error.message);}
  }
  document.getElementById("aiLearningReset").addEventListener("click",()=>useEnvironment(env=>env.reset(episodeSeed())));
  document.getElementById("aiLearningStep").addEventListener("click",()=>useEnvironment(env=>env.step(Number(document.getElementById("aiLearningAction").value))));
  document.getElementById("aiLearningStop").addEventListener("click",()=>{stopEnvironment();setText("aiLearningStatus","Environment stopped");});
  function displayBaselineSummary(summary,label) {
    setText("aiBaselineSuccess",summary.episodes?Math.round(summary.successRate*100)+"%":"—");
    setText("aiBaselineTime",summary.medianAcquisitionSeconds===null?"—":summary.medianAcquisitionSeconds.toFixed(2)+" s");
    setText("aiBaselineReward",summary.meanReward.toFixed(3));
    setText("aiBaselineFalseLocks",String(summary.falseLockAttempts));
    setText("aiBaselineSummary",label+" · "+summary.successes+"/"+summary.episodes+" acquired · "+summary.timeouts+" timeouts · "+summary.invalidStates+" invalid states. Median uses successful episodes only.");
  }
  document.getElementById("aiBaselineCancel").addEventListener("click",()=>{
    if(baselineRun){baselineRun.cancelled=true;setText("aiBaselineProgress","Cancelling evaluation...");}
  });
  document.getElementById("aiBaselineRun").addEventListener("click",async()=>{
    refresh();if(!environment||!environmentOptions||baselineRun||trainingRun)return;
    const options=environmentOptions,revision=generation;
    const stageId=document.getElementById("aiBaselineStage").value,split=document.getElementById("aiBaselineSplit").value,count=Number(document.getElementById("aiBaselineCount").value);
    let latestSummary=GhostBaselineEvaluation.summarize([]);
    const run={cancelled:false,environment:null};baselineRun=run;runSnapshot=null;updateEnvironmentControls();
    document.getElementById("aiBaselineEpisodes").replaceChildren();
    displayBaselineSummary(latestSummary,stageId+" / "+split);
    setText("aiLearningStatus","Evaluating sensor-only raster baseline...");
    log("Raster settings: "+stageId+" / "+split+" / "+count+" episode(s) / "+options.task.episodeSeconds+" s limit / "+options.task.holdSeconds+" s hold / 2-degree rows.");
    const current=()=>{
      if(run.cancelled||revision!==generation)return false;
      const latest=scene();if(!latest.offline||latest.fingerprint!==initializedScene){stopEnvironment();setText("aiLearningStatus","Setup changed; initialize again");return false;}return true;
    };
    try{
      const result=await GhostBaselineEvaluation.run({count,
        shouldStop:()=>!current(),
        makeCase:index=>GhostLearningCurriculum.makeCase({stageId,split,index,nodes:options.nodes,task:options.task,registry:componentRegistry,worldPoint:servoWorldPoint}),
        createEnvironment:scenario=>{run.environment=GhostLearningEnvironment.create({...options,task:scenario.task});return run.environment;},
        onFrame:frame=>{
          if(!current())return;
          if(frame.phase==='reset')log('Raster reset seed '+frame.scenario.seed+': actual '+frame.result.observation.jointAnglesDegrees.map(angle=>angle.toFixed(2)).join(' / ')+' degrees; raster will home to the lower limits next.');
          runSnapshot={...frame.snapshot,mode:'baseline',baselinePhase:frame.controller?.phase,baselineRunning:true};reportEnvironment(frame.result,true);
          setText("aiBaselineProgress","Episode "+(frame.index+1)+"/"+count+" · seed "+frame.scenario.seed+" · "+frame.result.info.simulationSeconds.toFixed(2)+" simulated s");
        },
        onEpisode:(episode,summary)=>{
          if(!current())return;
          const item=document.createElement("li");item.textContent="Seed "+episode.seed+" / "+episode.reason+" / "+episode.seconds.toFixed(2)+" s / return "+episode.reward.toFixed(3)+" / false locks "+episode.falseLockAttempts;
          latestSummary=summary;
          document.getElementById("aiBaselineEpisodes").append(item);displayBaselineSummary(summary,stageId+" / "+split);log("Raster "+item.textContent);
        }
      });
      if(revision===generation){
        displayBaselineSummary(result.summary,stageId+" / "+split+(result.cancelled?" / partial":""));
        setText("aiBaselineProgress",result.cancelled?"Evaluation cancelled; showing completed episodes only.":"Evaluation complete. No policy was trained.");
        setText("aiLearningStatus",result.cancelled?"Raster evaluation cancelled":"Raster evaluation complete; policy training pending");
      }
    }catch(error){if(revision===generation){displayBaselineSummary(latestSummary,stageId+" / "+split+" / failed, partial");setText("aiBaselineProgress","Evaluation failed: "+error.message);setText("aiLearningStatus","Raster evaluation failed; review the output");log(error.message);}}
    finally{
      run.environment?.dispose();
      if(baselineRun===run)baselineRun=null;
      if(runSnapshot){runSnapshot.baselineRunning=false;updateLearningView();}
      updateEnvironmentControls();
    }
  });
  document.getElementById("aiTrainingPause").addEventListener("click",async()=>{
    const run=trainingRun;if(!run||!run.started||run.kind!=="train"||run.controlPending||run.cancelled)return;
    const revision=generation;run.controlPending=true;updateEnvironmentControls();
    try{
      const state=await learningWorker.request(run.paused?'resume':'pause');
      if(revision!==generation||run.cancelled||trainingRun!==run)return;
      run.paused=state.paused;
      document.getElementById("aiTrainingPause").textContent=run.paused?"Resume":"Pause";
      setText("aiPolicyState",run.paused?"PAUSED":"TRAINING");
      if(runSnapshot){runSnapshot.policyPaused=run.paused;updateLearningView();}
      setText("aiTrainingProgress",run.paused?"Worker paused. Policy and rollout state retained.":"Worker training resumed.");
    }catch(error){if(revision===generation)log(error.message);}
    finally{run.controlPending=false;updateEnvironmentControls();}
  });
  document.getElementById("aiTrainingStop").addEventListener("click",()=>{
    if(autoRun)autoRun.cancelled=true;
    if(!trainingRun){updateEnvironmentControls();return;}trainingRun.cancelled=true;trainingRun.paused=false;updateEnvironmentControls();
    setText("aiTrainingProgress","Stopping worker; current policy will be retained.");
    learningWorker?.request('stop').catch(error=>log(error.message));
  });
  document.getElementById("aiTrainingDiscard").addEventListener("click",async()=>{
    if(trainingRun||baselineRun||policyIO||!learningWorker)return;
    const revision=generation;policyIO=true;updateEnvironmentControls();
    try{await learningWorker.request('discard');if(revision!==generation)return;policy=null;trainedUpdates=0;clearPolicyMetrics();setText("aiPolicyState","NO POLICY");setText("aiTrainingProgress","Policy discarded. The next run creates fresh weights.");}
    catch(error){if(revision===generation)log(error.message);}
    finally{policyIO=false;updateEnvironmentControls();}
  });
  async function savePolicy(autoOwner=null,best=false){
    refresh();if((autoRun&&autoRun!==autoOwner)||!environment||!policy||trainingRun||baselineRun||policyIO)return;
    const revision=generation;policyIO=true;updateEnvironmentControls();
    try{
      const record=await learningWorker.request('save',{best});if(revision!==generation)return;
      if(typeof localConfigServer!=='undefined'&&localConfigServer){
        const capability=await fetch('/api/devserver');
        if(!capability.ok||!(await capability.json()).trainingPolicyStorage)throw new Error('Restart the devserver to enable policy saves to training/.');
        if(revision!==generation)return;
        const name=scene().robot.replace(/[^A-Za-z0-9_-]/g,'_').slice(0,64)||'robot';
        const response=await fetch('/api/training/policies',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,policy:record})});
        if(!response.ok)throw new Error(await response.text());
        const saved=await response.json();if(revision!==generation)return;
        setText('aiPolicyFileStatus','Saved to '+saved.path);log('Policy saved locally: '+saved.path+'. Loading restores weights; optimizer and rollout state restart.');return true;
      }
      const url=URL.createObjectURL(new Blob([JSON.stringify(record)],{type:'application/json'})),link=document.createElement('a');
      link.href=url;link.download=scene().robot.replace(/[^A-Za-z0-9_-]/g,'_')+'-ppo-policy.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
      setText("aiPolicyFileStatus","Policy exported locally with compatibility data and available evaluation results.");log("Policy exported. Loading restores weights; Adam, sampling and rollout state restart.");return true;
    }catch(error){if(revision===generation)setText("aiPolicyFileStatus","Save failed: "+error.message);}
    finally{policyIO=false;updateEnvironmentControls();}
  }
  document.getElementById("aiTrainingSave").addEventListener("click",()=>savePolicy());
  document.getElementById("aiTrainingLoad").addEventListener("click",()=>document.getElementById("aiPolicyFile").click());
  document.getElementById("aiPolicyFile").addEventListener("change",async event=>{
    const file=event.target.files?.[0];event.target.value='';refresh();
    if(!file||!environment||trainingRun||baselineRun||policyIO)return;
    const revision=generation;policyIO=true;updateEnvironmentControls();
    try{
      if(file.size>2*1024*1024)throw new Error('Policy file exceeds 2 MB.');
      const record=JSON.parse(await file.text());if(revision!==generation)return;
      const restored=await learningWorker.request('load',{record});if(revision!==generation)return;
      policy=restored;trainedUpdates=restored.completedUpdates;clearPolicyMetrics();showConvergence(restored.convergence??null);setText("aiPPOUpdates",String(trainedUpdates));
      document.getElementById("aiTrainingSeed").value=String(policy.schema.seed);setText("aiPolicyState","POLICY READY");
      setText("aiTestStatus","Policy loaded. Choose a starting pose and run a test.");
      setText("aiTrainingProgress","Policy loaded into worker. Evaluate on ordinary held-out starts.");
      setText("aiPolicyFileStatus","Compatible weights restored. Optimizer, sampling and rollout state restarted.");log("Compatible policy loaded; prior policy replaced. Run a fresh held-out evaluation.");
    }catch(error){if(revision===generation){setText("aiPolicyFileStatus","Load rejected: "+error.message+" Current policy retained.");log("Policy load rejected: "+error.message);}}
    finally{policyIO=false;updateEnvironmentControls();}
  });
  async function runPolicyTest(autoOwner=null){
    refresh();if((autoRun&&autoRun!==autoOwner)||!environmentOptions||!policy||trainingRun||baselineRun||policyIO||!learningWorker)return;
    const revision=generation,worker=learningWorker,run={kind:'test',cancelled:false,started:true};trainingRun=run;runSnapshot=null;updateEnvironmentControls();
    const current=()=>{if(revision!==generation||run.cancelled)return false;const latest=scene();if(!latest.offline||latest.fingerprint!==initializedScene){stopEnvironment();return false;}return true;};
    try{
      setText('aiPolicyState','TESTING');setText('aiTestStatus','Running frozen policy at approximately real-time speed...');setText('aiTestAction','Waiting for the first action...');
      const angles=['Pan','Tilt'].map(id=>Number(document.getElementById('aiTest'+id).value)),seed=episodeSeed();
      if(['Pan','Tilt'].some(id=>document.getElementById('aiTest'+id).value.trim()===''))throw new Error('Enter both starting angles.');
      const outcome=await worker.request('test',{angles,seed},(event,frame)=>{
        if(event!=='frame'||!current())return;
        runSnapshot={...frame.snapshot,mode:'policy-test',policyRunning:true};reportEnvironment(frame.result,true);
        setText('aiTestAction',frame.phase==='reset'?'Initial pose; no policy action yet.':'Latest action: '+GhostLearningPolicy.actions[frame.action].name+' / '+frame.result.info.simulationSeconds.toFixed(2)+' s / Hold '+frame.actionCounts[0]+', movement actions '+frame.actionCounts.slice(1).reduce((sum,count)=>sum+count,0));
      });
      if(revision!==generation)return;
      const episode=outcome.episodes[0];
      globalThis.GhostTestProgress?.record({angles,seed,updates:trainedUpdates,episode,cancelled:outcome.cancelled});
      if(episode){const counts=episode.actionCounts;setText('aiTestAction','Actions: Hold '+counts[0]+', Pan - '+counts[1]+', Pan + '+counts[2]+', Tilt - '+counts[3]+', Tilt + '+counts[4]+(episode.clippedActionCount?' / '+episode.clippedActionCount+' actions clipped by joint limits.':'')+(counts.slice(1).every(count=>count===0)?'. The policy chose Hold throughout; it has not demonstrated search.':''));}
      const text=outcome.cancelled?'Test stopped; policy retained.':episode.reason+' / '+episode.seconds.toFixed(2)+' s / return '+episode.reward.toFixed(3)+' / travel '+(episode.jointTravelDegrees===null?'unavailable':episode.jointTravelDegrees.toFixed(1)+' deg');
      setText('aiTestStatus',text);log('Policy test: '+text);setText('aiLearningStatus','Policy test finished; weights unchanged');
      return outcome;
    }catch(error){if(revision===generation){setText('aiTestStatus','Test failed: '+error.message);log(error.message);}}
    finally{
      if(trainingRun===run)trainingRun=null;
      if(revision===generation){setText('aiPolicyState',policy?'POLICY READY':'NO POLICY');if(runSnapshot){runSnapshot.policyRunning=false;updateLearningView();}}
      updateEnvironmentControls();
    }
  }
  document.getElementById('aiTestRun').addEventListener('click',()=>runPolicyTest());
  document.getElementById('aiTestStop').addEventListener('click',()=>{
    if(trainingRun?.kind!=='test')return;if(autoRun)autoRun.cancelled=true;const revision=generation;trainingRun.cancelled=true;updateEnvironmentControls();setText('aiTestStatus','Stopping test; policy will be retained.');
    learningWorker.request('stop').catch(error=>{if(revision===generation)log(error.message);});
  });
  async function startPolicyRun(kind,autoOwner=null) {
    refresh();if((autoRun&&autoRun!==autoOwner)||!environmentOptions||baselineRun||trainingRun||policyIO||!learningWorker)return;
    const revision=generation,stageId=document.getElementById("aiTrainingStage").value;
    const worker=learningWorker;
    const run={kind,cancelled:false,paused:false,started:false};trainingRun=run;runSnapshot=null;updateEnvironmentControls();
    const current=()=>{
      if(run.cancelled||revision!==generation)return false;
      const latest=scene();if(!latest.offline||latest.fingerprint!==initializedScene){stopEnvironment();setText("aiLearningStatus","Setup changed; initialize again");return false;}return true;
    };
    const onFrame=frame=>{if(!current())return;if(frame.phase==='reset')log('PPO reset seed '+frame.scenario.seed+': commanded '+frame.result.info.commands.map(angle=>angle.toFixed(2)).join(' / ')+' degrees; actual '+frame.result.observation.jointAnglesDegrees.map(angle=>angle.toFixed(2)).join(' / ')+' degrees. No homing or policy action has run.');else if(kind==='evaluate'&&frame.phase==='first-action')log('PPO first action: '+GhostLearningPolicy.actions[frame.action].name);runSnapshot={...frame.snapshot,mode:kind==='train'?'training':'policy-eval',policyRunning:true};reportEnvironment(frame.result,true);};
    try {
      if(kind==='train') {
        if(convergenceState)showConvergence({...convergenceState,status:'Stale',converged:false});
        const seed=Number(document.getElementById("aiTrainingSeed").value),updates=Number(document.getElementById("aiTrainingUpdates").value),rolloutSteps=Number(document.getElementById("aiTrainingRollout").value),warm=document.getElementById("aiTrainingWarm").checked,progressive=warm&&document.getElementById("aiTrainingBridge").checked;
        const readyPolicy=await worker.request('create',{seed});if(revision!==generation)return;policy=readyPolicy;
        if(!current())return;run.started=true;setText('aiTestStatus','Training changes the policy; run a fresh test afterward.');setText('aiTestAction','No policy action yet.');setText("aiPPOEvaluation","New training run; evaluate the resulting weights on held-out starts.");setText("aiPPOComparison","Comparison pending for the resulting weights.");updateEnvironmentControls();
        setText("aiPolicyState","TRAINING");setText("aiLearningStatus","PPO training running in isolated simulation");setText("aiTrainingProgress","Collecting on-policy rollouts...");
        log("PPO: "+stageId+" / "+(progressive?"progressive acquisition starts":warm?"near-target holding starts":"ordinary starts")+" / "+updates+" updates x "+rolloutSteps+" steps; "+JSON.stringify(policy.settings));
        const onEpisode=episode=>{if(current()&&episode.curriculum){const c=episode.curriculum;setText("aiCurriculumProgress","Acquisition stage "+(c.level+1)+"/"+c.levels+" / "+Math.round(c.fraction*100)+"% toward ordinary starts / "+c.successes+" successes in "+c.episodes+" recent frozen training-case probes.");}if(current())log("PPO episode seed "+episode.seed+": "+episode.reason+"; return "+episode.reward.toFixed(3));};
        const onUpdate=metrics=>{

            if(!current())return;trainedUpdates=metrics.completedUpdates;
            if(metrics.curriculum){const c=metrics.curriculum;setText("aiCurriculumProgress","Acquisition stage "+(c.level+1)+"/"+c.levels+" / "+Math.round(c.fraction*100)+"% toward ordinary starts / "+c.successes+" successes in "+c.episodes+" recent frozen training-case probes.");}
            setText("aiPPOSteps",String(metrics.steps));setText("aiPPOUpdates",String(trainedUpdates));setText("aiPPOEntropy",metrics.entropy.toFixed(3));setText("aiPPOValueLoss",metrics.valueLoss.toFixed(4));
            const text=metrics.steps+" steps / "+metrics.episodes+" episodes / "+metrics.successes+" training successes / "+metrics.stepsPerSecond.toFixed(1)+" steps/s / policy loss "+metrics.policyLoss.toFixed(4)+" / KL "+metrics.approxKL.toFixed(5);
            setText("aiPPOTrainingSummary",text);setText("aiTrainingProgress","Update "+metrics.updates+"/"+updates+" complete.");log("PPO update "+trainedUpdates+": "+text);
        };
        const outcome=await worker.request('train',{stageId,updates,rolloutSteps,warm,progressive},(event,data)=>{if(event==='frame')onFrame(data);else if(event==='episode')onEpisode(data);else if(event==='update')onUpdate(data);else if(event==='convergence'&&current())showConvergence(data);else if(event==='curriculum-check'&&current())setText('aiTrainingProgress',data);});
        if(revision===generation){policy=outcome.policy;trainedUpdates=policy.completedUpdates;setText("aiPPOUpdates",String(trainedUpdates));}
        if(revision===generation){setText("aiTrainingProgress",outcome.cancelled?"Training stopped; current policy retained.":"Training run complete. Evaluate on held-out starts before judging performance.");setText("aiLearningStatus","Policy retained; evaluate ordinary held-out starts");log("PPO run "+(outcome.cancelled?"stopped":"complete")+": "+outcome.steps+" sampled steps, "+outcome.updates+" complete updates.");}
        return outcome;
      }else{
        if(!policy)throw new Error("Train a policy before evaluation.");
        const monitored=kind==='monitor'||kind==='qualify',count=monitored?50:Number(document.getElementById("aiBaselineCount").value);setText("aiPolicyState","EVALUATING");setText("aiLearningStatus","Evaluating frozen PPO policy");setText("aiTrainingProgress","Evaluating frozen policy on ordinary held-out starts...");
        run.started=true;setText("aiPPOComparison",kind==='monitor'?"Monitoring 50 clean-v1 cases; no training weights change.":"Running PPO, then raster on the identical held-out cases...");updateEnvironmentControls();
        const outcome=await worker.request(monitored?kind:'evaluate',{stageId,count},(event,data)=>{if(event==='frame')onFrame(data);else if(event==='convergence'&&current())showConvergence(data);else if(event==='phase'&&current()){setText("aiTrainingProgress",data);setText("aiPolicyState",String(data).toLowerCase().includes('raster')?"COMPARING":"EVALUATING");}else if(event==='baseline-frame'&&current()){if(data.phase==='reset')log('Raster reset seed '+data.scenario.seed+': actual '+data.result.observation.jointAnglesDegrees.map(angle=>angle.toFixed(2)).join(' / ')+' degrees. Raster next homes to the lower joint limits; this counts toward the episode.');runSnapshot={...data.snapshot,mode:'baseline',baselinePhase:data.controller?.phase,baselineRunning:true};reportEnvironment(data.result,true);}});
        if(revision===generation){
          if(outcome.convergence)showConvergence(outcome.convergence);
          const successes=outcome.episodes.filter(episode=>episode.reason==='success'),rate=outcome.episodes.length?Math.round(100*successes.length/outcome.episodes.length):0;
          const stats=GhostBaselineEvaluation.summarize(outcome.episodes);
          const text=stageId+" / "+(monitored?kind+" clean-v1":"ordinary held-out starts")+" / "+successes.length+"/"+outcome.episodes.length+" acquired ("+rate+"%) / mean return "+stats.meanReward.toFixed(3)+" / median acquisition "+(stats.medianAcquisitionSeconds===null?"—":stats.medianAcquisitionSeconds.toFixed(2)+" s")+" / travel "+(stats.meanJointTravelDegrees===null?"unavailable":stats.meanJointTravelDegrees.toFixed(1)+" deg/episode")+" / false returns "+stats.falseTargetDetections+" / false holds "+stats.falseHoldAttempts+" / timeouts "+stats.timeouts+(outcome.cancelled?" / partial":"");
          if(outcome.baseline){
            displayBaselineSummary(outcome.baseline.summary,stageId+" / paired held-out comparison"+(outcome.comparisonComplete?"":" / incomplete"));
            const reference=outcome.baseline.summary;
            const list=document.getElementById("aiBaselineEpisodes");list.replaceChildren();
            for(const episode of outcome.baseline.episodes){const item=document.createElement('li');item.textContent="Seed "+episode.seed+": "+episode.reason+" / "+episode.seconds.toFixed(2)+" s / return "+episode.reward.toFixed(3);list.append(item);}
            setText("aiPPOComparison",(outcome.comparisonComplete?"Same-seed comparison":"Incomplete comparison")+": PPO "+stats.successes+"/"+stats.episodes+" vs raster "+reference.successes+"/"+reference.episodes+" successes; mean travel "+(stats.meanJointTravelDegrees===null?"unavailable":stats.meanJointTravelDegrees.toFixed(1))+" vs "+(reference.meanJointTravelDegrees===null?"unavailable":reference.meanJointTravelDegrees.toFixed(1))+" deg; false returns "+stats.falseTargetDetections+" vs "+reference.falseTargetDetections+".");
          }else setText("aiPPOComparison",kind==='monitor'?"Monitoring uses a fixed clean-v1 bank. Paired raster comparison runs on the separate final qualification bank.":"Comparison incomplete: PPO stopped before the paired raster run.");
          for(const episode of outcome.episodes)log("PPO held-out seed "+episode.seed+": "+episode.reason+" / "+episode.seconds.toFixed(2)+" s / return "+episode.reward.toFixed(3));
          setText("aiPPOEvaluation",text+(kind==='qualify'?(outcome.qualified?" / FINAL QUALIFICATION PASSED":" / FINAL QUALIFICATION FAILED or incomplete"):""));setText("aiTrainingProgress",outcome.cancelled?"Policy evaluation cancelled.":"Held-out policy evaluation complete. No weights were updated.");setText("aiLearningStatus","Held-out policy evaluation finished; policy retained");log("PPO evaluation: "+text);
        }
        return outcome;
      }
    }catch(error){if(revision===generation){setText("aiTrainingProgress","Policy run failed: "+error.message);if(kind==='evaluate')setText("aiPPOComparison","Comparison failed; no completed pair is available. "+error.message);log(error.message);}}
    finally{
      if(trainingRun===run)trainingRun=null;
      if(revision===generation){setText("aiPolicyState",policy?"POLICY READY":"NO POLICY");document.getElementById("aiTrainingPause").textContent="Pause";if(runSnapshot){runSnapshot.policyRunning=false;runSnapshot.policyPaused=false;runSnapshot.baselineRunning=false;updateLearningView();}}
      updateEnvironmentControls();
    }
  }
  document.getElementById('aiTrainingAuto').addEventListener('click',async()=>{
    if(autoRun||trainingRun||baselineRun||policyIO)return;
    const maxBatches=Number(document.getElementById('aiAutoBatches').value);
    if(!Number.isSafeInteger(maxBatches)||maxBatches<1||maxBatches>500){setText('aiAutoProgress','Choose an auto batch limit from 1 to 500.');return;}
    refresh();
    const owner={cancelled:false};autoRun=owner;updateEnvironmentControls();
    let revision=null;
    try{
      if(!environment){setText('aiAutoProgress','Initializing isolated simulation...');await initializeEnvironment(owner);}
      if(owner.cancelled||!environment||!learningWorker){setText('aiAutoProgress','Auto training stopped. Review setup status before retrying.');return;}
      revision=generation;
      document.getElementById('aiTrainingWarm').checked=true;document.getElementById('aiTrainingBridge').checked=true;
      task.joints.forEach((joint,i)=>{document.getElementById(i?'aiTestTilt':'aiTestPan').value=joint.startup;});
      log('Full Auto: selected stage '+document.getElementById('aiTrainingStage').value+'; up to '+maxBatches+' batches; progressive starts; 50 monitoring cases and startup test after each batch; fresh final bank only after stability.');
      const result=await GhostAutoTraining.run({maxBatches,
        train:()=>startPolicyRun('train',owner),evaluate:()=>startPolicyRun('monitor',owner),test:()=>runPolicyTest(owner),qualify:()=>startPolicyRun('qualify',owner),earlyStop:document.getElementById('aiAutoEarlyStop').checked,
        shouldStop:()=>owner.cancelled||revision!==generation,
        onProgress:state=>{if(revision===generation)setText('aiAutoProgress','Batch '+state.batch+'/'+state.maxBatches+' / '+state.phase+' / qualification '+state.streak+'/3'+(state.successes===undefined?'':' / '+state.successes+'/50 monitoring acquisitions'));}
      });
      if(revision!==generation)return;
      const text=result.reason==='qualified'?'Qualification passed: stable monitoring plus the separate 50-case final bank and raster comparison.':result.reason==='limit'?'Batch limit reached. Policy has NOT passed qualification. Saving best monitored weights.':result.reason==='qualification-failed'?'Final qualification failed. Auto training ended; review results before further experiments.':'Auto training stopped; current policy retained.';
      setText('aiAutoProgress',text);setText('aiLearningStatus',text);log(text);
      if(result.reason!=='stopped'&&policy&&!owner.cancelled){const saved=await savePolicy(owner,result.reason!=='qualified');if(revision===generation)setText('aiAutoProgress',text.replace('Saving best monitored weights.',saved?'Best monitored checkpoint saved.':'Check save status; checkpoint save failed.'));}
    }catch(error){if(revision===null||revision===generation){setText('aiAutoProgress','Auto training failed: '+error.message);log(error.message);}}
    finally{
      if(autoRun===owner)autoRun=null;
      if(!trainingRun){document.getElementById('aiLearningBackend').disabled=false;for(const input of selectionInputs())input.disabled=false;}
      updateEnvironmentControls();
    }
  });
  document.getElementById("aiTrainingStart").addEventListener("click",()=>startPolicyRun('train'));
  document.getElementById("aiTrainingEvaluate").addEventListener("click",()=>startPolicyRun('monitor'));
  document.getElementById('aiTrainingQualify').addEventListener('click',()=>startPolicyRun('qualify'));
  document.getElementById('aiTrainingRestoreBest').addEventListener('click',async()=>{
    if(autoRun||trainingRun||baselineRun||policyIO||!learningWorker)return;
    const revision=generation;policyIO=true;updateEnvironmentControls();
    try{const restored=await learningWorker.request('restore-best');if(revision!==generation)return;policy=restored;trainedUpdates=restored.completedUpdates;clearPolicyMetrics();showConvergence(restored.convergence);setText('aiPPOUpdates',String(trainedUpdates));setText('aiTrainingProgress','Best monitored weights restored. Optimizer restarts; collect fresh monitoring evidence.');}
    catch(error){if(revision===generation)log(error.message);}
    finally{policyIO=false;updateEnvironmentControls();}
  });
  globalThis.addEventListener?.("beforeunload",stopEnvironment);
  document.getElementById("aiLearningClear").addEventListener("click", () => output.replaceChildren());
  globalThis.GhostLearning = { refresh, log, stopEnvironment, getTask() { refresh(); return task ? JSON.parse(JSON.stringify(task)) : null; } };
  log("AI Learning ready. Load the PanTilt robot in Offline simulation, then initialize its setup.");
  refresh();
})();
