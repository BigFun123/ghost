// Simulation-only worker: no controller requests, DOM or physical servo command path.
importScripts('./ai-rig.js','./physics.js','./simulated-sensor.js','./ai-task.js','./ai-policy.js','./ai-reward.js','./ai-environment.js',
  './ai-baseline.js','./ai-curriculum.js','./ai-evaluation.js','./ai-ppo.js','./ai-training.js','./ai-acquisition.js','./ai-runtime.js','./ai-policy-file.js','./ai-convergence.js');
(function(){
  let options=null,context=null,agent=null,active=null,initializing=false,completedUpdates=0,lastEvaluation=null,lastTraining=null,acquisition=null,acquisitionStage=null,monitor=GhostConvergence.create(),revision=0,best=null,trainingSteps=0,finalBankRuns=0;
  const emit=(id,event,data)=>postMessage({id,event,data});
  const status=()=>agent?{schema:agent.schema,settings:agent.settings,completedUpdates,...agent.inspect()}:null;
  const idle=()=>{if(!options)throw new Error('Initialize the worker first.');if(active)throw new Error('Stop training/evaluation before changing policy data.');};
  async function initialize(payload,id){
    if(initializing||options)throw new Error('Worker already initialized.');initializing=true;
    const files=payload.componentFiles;
    if(!Array.isArray(files)||files.length<2||files.length>100||files[0]!=='components/registry.js'||files.some(file=>typeof file!=='string'||!/^components\/[A-Za-z0-9_-]+\.js$/.test(file)))throw new Error('Invalid local component script list.');
    importScripts(...files.map(file=>'./'+file));
    importScripts('./vendor/tensorflow-4.22.0/tf.min.js');
    if(tf.version.tfjs!=='4.22.0')throw new Error('Unexpected TensorFlow.js version.');
    const preference=payload.backend||'auto';if(!['auto','webgl','cpu'].includes(preference))throw new Error('Unsupported training backend.');
    let selected=false;
    for(const backend of preference==='auto'?['webgl','cpu']:[preference]){
      try{
        if(!await tf.setBackend(backend))throw new Error('Backend unavailable.');await tf.ready();
        await GhostTensorFlow.smokeTest(tf);selected=true;break;
      }catch(error){emit(id,'log',backend+' unavailable in worker: '+error.message);}
    }
    if(!selected)throw new Error('No supported TensorFlow.js training backend in this worker. Select CPU and initialize again.');
    const rig=GhostRig.forRegistry(componentRegistry),RAPIER=await GhostPhysics.load();
    options={RAPIER,nodes:payload.nodes,task:payload.task,registry:componentRegistry,...rig};
    context=GhostPolicyFile.compatibility(options);
    return {version:tf.version.tfjs,backend:tf.getBackend(),execution:'Web Worker'};
  }
  async function run(type,payload,id){
    idle();if(!agent)throw new Error('Create or load a policy first.');
    const state={paused:false,cancelled:false};active=state;let lastFrame=-Infinity,controlTicks=0;
    const checkpoint=async()=>{if(type!=='test'&&!state.paused&&++controlTicks%8!==0)return;do{await new Promise(resolve=>setTimeout(resolve,state.paused?30:type==='test'?50:0));}while(state.paused&&!state.cancelled);};
    const stageId=payload.stageId;
    const makeCase=(index,split,warm)=>GhostPPOTraining.prepareCase(GhostLearningCurriculum.makeCase({stageId,split,index:index%GhostLearningCurriculum.seeds[split].length,...options}),warm);
    const onFrame=frame=>{const now=Date.now();if(frame.phase==='reset'||frame.phase==='first-action'||now-lastFrame>=100||frame.result.terminated||frame.result.truncated){lastFrame=now;emit(id,'frame',frame);}};
    const shared={agent,onFrame,shouldStop:()=>state.cancelled,yieldControl:checkpoint,createEnvironment:scenario=>GhostLearningEnvironment.create({...options,task:scenario.task})};
    try{
      if(type==='train'){
        lastEvaluation=null;revision++;monitor.stale();emit(id,'convergence',monitor.state());
        if(payload.progressive&&(!acquisition||acquisitionStage!==stageId)){acquisition=GhostAcquisition.create();acquisitionStage=stageId;}
        const trainingCase=index=>{const scenario=makeCase(index,'training',payload.progressive?false:payload.warm);return payload.progressive?acquisition.prepare(scenario):scenario;};
        const outcome=await GhostPPOTraining.train({...shared,updates:payload.updates,rolloutSteps:payload.rolloutSteps,makeCase:trainingCase,
          onEpisode:episode=>{emit(id,'episode',{...episode,curriculum:payload.progressive?acquisition.status():null});},onUpdate:async metrics=>{
            completedUpdates++;
            if(payload.progressive&&!state.cancelled){
              emit(id,'curriculum-check','Checking acquisition with frozen training-case probes...');
              const level=acquisition.status().level;
              const probes=Array.from({length:5},(_,i)=>{
                const scenario=trainingCase(i),initial=scenario.resetOptions.initialAngles??scenario.task.joints.map(joint=>joint.startup);
                const travel=initial.reduce((sum,angle,j)=>sum+Math.abs(angle-scenario.task.solution.angles[j]),0)+(scenario.resetOptions.initialAngles?0:2*(scenario.resetOptions.jitterDegrees??0));
                const budget=Math.max(2,scenario.task.holdSeconds+travel/40+.5);
                return {...scenario,task:{...scenario.task,episodeSeconds:Math.min(scenario.task.episodeSeconds,budget)}};
              });
              const checked=await GhostPPOTraining.evaluate({...shared,onFrame:()=>{},count:5,makeCase:i=>probes[i]});
              if(!checked.cancelled)for(const episode of checked.episodes){acquisition.record(episode.reason==='success');if(acquisition.status().level!==level)break;}
            }
            lastTraining={stageId,warm:payload.warm,progressive:!!payload.progressive,curriculum:payload.progressive?acquisition.status():null,...metrics,completedUpdates};emit(id,'update',lastTraining);
          }});
        trainingSteps+=outcome.steps;return {...outcome,policy:status()};
      }
      if(type==='test'){
        if(!Number.isSafeInteger(payload.seed)||!Array.isArray(payload.angles)||payload.angles.length!==2||payload.angles.some((angle,i)=>!Number.isFinite(angle)||angle<options.task.joints[i].min||angle>options.task.joints[i].max))throw new Error('Choose a whole-number seed and start angles within the joint limits.');
        const scenario={id:'policy-test',seed:payload.seed,task:options.task,resetOptions:{initialAngles:payload.angles,jitterDegrees:0}};
        const outcome=await GhostPPOTraining.evaluate({...shared,count:1,makeCase:()=>scenario});
        return {...outcome,policy:status()};
      }
      if(type==='monitor'||type==='qualify'){
        const split=type==='monitor'?'monitoring':'qualification';
        if(type==='monitor'&&lastEvaluation?.split==='monitoring'&&lastEvaluation.stageId===stageId&&lastEvaluation.revision===revision&&!lastEvaluation.cancelled&&lastEvaluation.episodes.length===50){emit(id,'convergence',monitor.state());return {...lastEvaluation,convergence:monitor.state(),policy:status()};}
        if(type==='qualify'&&(!monitor.state().converged||monitor.state().rows.at(-1)?.stageId!==stageId))throw new Error('Pass monitoring stability before final qualification.');
        const finalRound=type==='qualify'?++finalBankRuns:0,bankId=GhostConvergence.bank+(finalRound?'-final-'+finalRound:'-monitor');
        const bankCase=index=>type==='qualify'?GhostLearningCurriculum.makeCase({stageId,split,index,...options,seedOverride:1000003+finalRound*100003+index*103}):makeCase(index,split,false);
        let caseNumber=0;
        const outcome=await GhostPPOTraining.evaluate({...shared,count:50,makeCase:bankCase,onFrame:frame=>{if(frame.phase==='reset')emit(id,'phase',(type==='monitor'?'Monitoring':'Final qualification')+' '+(++caseNumber)+'/50 / '+bankId);onFrame(frame);}});
        const summary=GhostConvergence.summarize(outcome.episodes);
        let baseline=null;
        if(type==='qualify'&&!outcome.cancelled){
          emit(id,'phase','Final-bank raster comparison...');
          baseline=await GhostBaselineEvaluation.run({count:50,makeCase:bankCase,createEnvironment:shared.createEnvironment,shouldStop:shared.shouldStop,yieldControl:checkpoint});
        }
        const complete=!outcome.cancelled&&outcome.episodes.length===50&&!baseline?.cancelled;
        let convergence=type==='monitor'?monitor.add({stageId,revision,updates:completedUpdates,steps:trainingSteps,...outcome}):monitor.state();
        const qualified=type==='qualify'&&complete&&GhostConvergence.quality(summary)&&!!baseline&&summary.successes>=baseline.summary.successes;
        if(type==='qualify')convergence={...convergence,finalBank:bankId,finalQualified:qualified};
        lastEvaluation={stageId,revision,bank:bankId,split,...outcome,cancelled:outcome.cancelled||!!baseline?.cancelled,summary,baseline,qualified,convergence};
        if(type==='monitor'&&complete){
          const rank=summary.rate*1000-summary.invalid*100-summary.falseHolds*10-(summary.seconds??options.task.episodeSeconds)*.01;
          if(!best||best.stageId!==stageId||rank>best.rank)best={rank,stageId,record:GhostPolicyFile.save({agent,context,training:{completedUpdates,trainingSteps,finalBankRuns,monitoring:monitor.export()},evaluation:lastEvaluation})};
        }
        emit(id,'convergence',convergence);
        return {...lastEvaluation,cancelled:outcome.cancelled||!!baseline?.cancelled,convergence,qualified,policy:status()};
      }
      const outcome=await GhostPPOTraining.evaluate({...shared,count:payload.count,makeCase:index=>makeCase(index,'evaluation',false)});
      const summary=GhostBaselineEvaluation.summarize(outcome.episodes);
      let baseline=null;
      if(!outcome.cancelled){
        emit(id,'phase','Comparing raster scan on the same held-out seeds...');
        baseline=await GhostBaselineEvaluation.run({count:payload.count,makeCase:index=>makeCase(index,'evaluation',false),
          createEnvironment:shared.createEnvironment,shouldStop:shared.shouldStop,yieldControl:checkpoint,
          onFrame:frame=>{const now=Date.now();if(frame.phase==='reset'||frame.phase==='first-action'||now-lastFrame>=100||frame.result.terminated||frame.result.truncated){lastFrame=now;emit(id,'baseline-frame',frame);}}});
      }
      lastEvaluation={stageId,split:'evaluation',warm:false,...outcome,cancelled:outcome.cancelled||!!baseline?.cancelled,summary,baseline,
        comparisonComplete:!outcome.cancelled&&!!baseline&&!baseline.cancelled&&baseline.episodes.length===outcome.episodes.length};
      return {...lastEvaluation,policy:status()};
    }finally{active=null;}
  }
  onmessage=async({data:{id,type,payload={}}})=>{
    try{
      let result;
      if(type==='init')result=await initialize(payload,id);
      else if(['pause','resume','stop'].includes(type)){
        if(active){active.paused=type==='pause';if(type==='stop')active.cancelled=true;}result={active:!!active,paused:!!active?.paused};
      }else if(['train','evaluate','test','monitor','qualify'].includes(type))result=await run(type,payload,id);
      else{
        idle();
        if(type==='create'){if(!agent)agent=GhostPPO.create({tf,seed:payload.seed});result=status();}
        else if(type==='discard'){agent?.dispose();agent=null;completedUpdates=0;lastTraining=lastEvaluation=null;acquisition=null;acquisitionStage=null;monitor.clear();best=null;revision++;trainingSteps=0;finalBankRuns=0;result=null;}
        else if(type==='save'){
          if(!agent)throw new Error('No policy to save.');
          result=payload.best&&best?best.record:GhostPolicyFile.save({agent,context,training:{completedUpdates,trainingSteps,finalBankRuns,optimizerSteps:agent.inspect().optimizerSteps,lastCompletedUpdate:lastTraining,monitoring:monitor.export()},evaluation:lastEvaluation});
        }else if(type==='restore-best'){
          if(!best)throw new Error('No monitored checkpoint is available.');
          const replacement=GhostPolicyFile.load({tf,record:best.record,context});agent.dispose();agent=replacement;completedUpdates=best.record.training.completedUpdates;trainingSteps=best.record.training.trainingSteps;revision++;monitor.restore(best.record.training.monitoring);acquisition=null;acquisitionStage=null;lastTraining=null;lastEvaluation=best.record.evaluation;result={...status(),convergence:monitor.state()};
        }else if(type==='load'){
          const replacement=GhostPolicyFile.load({tf,record:payload.record,context});
          agent?.dispose();agent=replacement;completedUpdates=Number.isSafeInteger(payload.record.training?.completedUpdates)&&payload.record.training.completedUpdates>=0?payload.record.training.completedUpdates:0;
          acquisition=null;acquisitionStage=null;lastTraining=null;lastEvaluation=payload.record.evaluation??null;revision++;trainingSteps=Number.isSafeInteger(payload.record.training?.trainingSteps)&&payload.record.training.trainingSteps>=0?payload.record.training.trainingSteps:0;finalBankRuns=Number.isSafeInteger(payload.record.training?.finalBankRuns)?Math.max(finalBankRuns,payload.record.training.finalBankRuns):finalBankRuns;best=null;monitor.restore(payload.record.training?.monitoring);result={...status(),convergence:monitor.state()};
        }else if(type==='predict'){if(!agent)throw new Error('No policy.');result={...agent.predict(payload.vector),action:agent.act(payload.vector,true).action};}
        else if(type==='inspect')result={policy:status(),tensors:tf.memory().numTensors,active:!!active};
        else throw new Error('Unknown learning worker command.');
      }
      postMessage({id,result});
    }catch(error){postMessage({id,error:error.message||String(error)});}
  };
})();
