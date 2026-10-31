// Cooperative PPO rollout runner. Only normalized observations enter the networks.
(function(scope){
  function prepareCase(scenario,warmStart=false){
    if(!warmStart)return scenario;
    const copy=JSON.parse(JSON.stringify(scenario));let state=(scenario.seed^0x7F4A7C15)>>>0;
    copy.resetOptions.initialAngles=copy.task.joints.map((joint,i)=>{
      state=(Math.imul(state,1664525)+1013904223)>>>0;
      return Math.max(joint.min,Math.min(joint.max,copy.task.solution.angles[i]+(state/4294967296*2-1)*.25));
    });
    copy.warmStart=true;return copy;
  }
  async function train({agent,updates,rolloutSteps=128,environmentCount=1,makeCase,createEnvironment,onFrame=()=>{},onEpisode=()=>{},onUpdate=()=>{},onPhase=()=>{},shouldSnapshot=null,shouldStop=()=>false,yieldControl=()=>new Promise(resolve=>setTimeout(resolve,0))}){
    if(!Number.isInteger(updates)||updates<1||updates>100||!Number.isInteger(rolloutSteps)||rolloutSteps<16||rolloutSteps>2048)throw new Error('Use 1-100 updates and 16-2048 steps per rollout.');
    if(!Number.isInteger(environmentCount)||environmentCount<1||environmentCount>256)throw new Error('Use 1-256 parallel environments.');
    if(environmentCount*rolloutSteps>131072)throw new Error('Use at most 131072 combined samples per update.');
    const slots=Array.from({length:environmentCount},()=>({environment:null,result:null,scenario:null,lastSnapshot:null,rows:[]}));
    let episodeIndex=0,steps=0,completedUpdates=0,successes=0,episodes=0;const start=Date.now(),clock=()=>scope.performance?.now?.()??Date.now(),profile={resetMs:0,environmentMs:0,inferenceMs:0,optimizerMs:0,snapshotMs:0};
    const summary=()=>({profile:{...profile},steps,updates:completedUpdates,episodes,successes,environmentCount,samplesPerUpdate:environmentCount*rolloutSteps,stepsPerSecond:steps/Math.max(.001,(Date.now()-start)/1000)});
    try{
      for(let update=0;update<updates;update++){
        onPhase('Collecting '+environmentCount+' worlds x '+rolloutSteps+' steps...');
        slots.forEach(slot=>{slot.rows=[];});
        for(let tick=0;tick<rolloutSteps;tick++){
          for(const slot of slots){
            await yieldControl();if(shouldStop())return {cancelled:true,...summary()};
            if(!slot.environment){const started=clock();slot.scenario=makeCase(episodeIndex++);slot.environment=createEnvironment(slot.scenario);slot.result=slot.environment.reset(slot.scenario.seed,slot.scenario.resetOptions);profile.resetMs+=clock()-started;}
          }
          let timed=clock();
          const vectors=slots.map(slot=>slot.result.observation.policyVector),samples=agent.actBatch?agent.actBatch(vectors):vectors.map(vector=>agent.act(vector));
          profile.inferenceMs+=clock()-timed;
          const next=[];let ended=false;
          for(let i=0;i<slots.length;i++){
            await yieldControl();if(shouldStop())return {cancelled:true,...summary()};
            timed=clock();next.push(slots[i].environment.step(samples[i].action));profile.environmentMs+=clock()-timed;steps++;
          }
          timed=clock();
          const continuing=next.map((result,index)=>({result,index})).filter(({result})=>!result.terminated);
          const nextVectors=continuing.map(({result})=>result.observation.policyVector),values=agent.valuesBatch?agent.valuesBatch(nextVectors):nextVectors.map(vector=>agent.value(vector));
          profile.inferenceMs+=clock()-timed;
          const bootstraps=Array(environmentCount).fill(0);continuing.forEach(({index},i)=>{bootstraps[index]=values[i];});
          for(let i=0;i<slots.length;i++){
            const slot=slots[i],result=next[i],sample=samples[i];
            slot.rows.push({observation:[...vectors[i]],action:sample.action,logProbability:sample.logProbability,value:sample.value,reward:result.reward,nextValue:bootstraps[i],terminated:result.terminated,truncated:result.truncated});
            slot.result=result;
            if(result.terminated||result.truncated){
              ended=true;episodes++;if(result.info.reason==='success')successes++;
              onEpisode({environmentIndex:i,seed:slot.scenario.seed,reason:result.info.reason,reward:result.info.episodeReward,...summary()});
              timed=clock();slot.lastSnapshot=slot.environment.snapshot();profile.snapshotMs+=clock()-timed;slot.environment.dispose();slot.environment=null;
            }
          }
          if(shouldSnapshot?shouldSnapshot():tick%8===0||ended||tick===rolloutSteps-1){
            timed=clock();
            const snapshots=slots.map(slot=>slot.environment?slot.environment.snapshot():slot.lastSnapshot),first=slots[0];
            profile.snapshotMs+=clock()-timed;
            onFrame({scenario:first.scenario,result:first.result,action:samples[0].action,snapshot:snapshots[0],replicas:environmentCount>1?snapshots:undefined,environmentCount,environmentIndex:0});
          }
        }
        // Concatenate time-ordered trajectories; traceEnd stops GAE crossing worlds without suppressing value bootstrap.
        for(const slot of slots)slot.rows.at(-1).traceEnd=true;
        onPhase('Optimizing '+(environmentCount*rolloutSteps)+' samples...');const optimizerStart=clock();
        const metrics=await agent.update(slots.flatMap(slot=>slot.rows),{shouldStop,yieldControl});if(metrics.cancelled)return {cancelled:true,...summary()};
        profile.optimizerMs+=clock()-optimizerStart;completedUpdates++;await onUpdate({...summary(),...metrics});
      }
      return {cancelled:false,...summary()};
    }finally{for(const slot of slots)slot.environment?.dispose();}
  }
  async function evaluate({agent,count,makeCase,createEnvironment,onFrame=()=>{},shouldStop=()=>false,yieldControl=()=>new Promise(resolve=>setTimeout(resolve,0))}){
    if(!Number.isInteger(count)||count<1||count>50)throw new Error('Evaluate 1-50 held-out episodes.');
    const episodes=[];
    for(let i=0;i<count;i++){
      await yieldControl();if(shouldStop())return {cancelled:true,episodes};
      const scenario=makeCase(i),environment=createEnvironment(scenario);
      try{
        let result=environment.reset(scenario.seed,scenario.resetOptions);
        onFrame({scenario,result,action:null,phase:'reset',snapshot:environment.snapshot()});
        const metrics=scope.GhostBaselineEvaluation.createMetrics(scenario.task.targetIndex,result),actionCounts=[0,0,0,0,0];let clippedActionCount=0;
        const limit=Math.ceil(scenario.task.episodeSeconds/.05)+1;
        for(let step=0;step<limit;step++){
          await yieldControl();if(shouldStop())return {cancelled:true,episodes};
          const action=agent.act(result.observation.policyVector,true).action;
          actionCounts[action]++;result=environment.step(action);metrics.step(action,result);if(result.info.rewardTerms?.limit<0)clippedActionCount++;
          if(step%4===0||result.terminated||result.truncated)onFrame({scenario,result,action,actionCounts:[...actionCounts],phase:step===0?'first-action':'step',snapshot:environment.snapshot()});
          if(result.terminated||result.truncated){episodes.push({...metrics.snapshot(),actionCounts,clippedActionCount,id:scenario.id,targetWorld:[...scenario.task.targetWorld],seed:scenario.seed,reason:result.info.reason,seconds:result.info.simulationSeconds,reward:result.info.episodeReward});break;}
          if(step===limit-1)throw new Error('Policy evaluation exceeded the environment action budget.');
        }
      }finally{environment.dispose();}
    }
    return {cancelled:false,episodes};
  }
  scope.GhostPPOTraining={train,evaluate,prepareCase};
  if(typeof module!=='undefined'&&module.exports)module.exports=scope.GhostPPOTraining;
})(globalThis);
