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
  async function train({agent,updates,rolloutSteps=128,makeCase,createEnvironment,onFrame=()=>{},onEpisode=()=>{},onUpdate=()=>{},shouldStop=()=>false,yieldControl=()=>new Promise(resolve=>setTimeout(resolve,0))}){
    if(!Number.isInteger(updates)||updates<1||updates>100||!Number.isInteger(rolloutSteps)||rolloutSteps<16||rolloutSteps>2048)throw new Error('Use 1-100 updates and 16-2048 steps per rollout.');
    let environment=null,result,scenario,episodeIndex=0,steps=0,completedUpdates=0,successes=0,episodes=0;
    const start=Date.now();
    const summary=()=>({steps,updates:completedUpdates,episodes,successes,stepsPerSecond:steps/Math.max(.001,(Date.now()-start)/1000)});
    try{
      for(let update=0;update<updates;update++){
        const rows=[];
        for(let index=0;index<rolloutSteps;index++){
          await yieldControl();if(shouldStop())return {cancelled:true,...summary()};
          if(!environment){scenario=makeCase(episodeIndex++);environment=createEnvironment(scenario);result=environment.reset(scenario.seed,scenario.resetOptions);}
          const vector=result.observation.policyVector,sample=agent.act(vector),next=environment.step(sample.action);
          rows.push({observation:[...vector],action:sample.action,logProbability:sample.logProbability,value:sample.value,reward:next.reward,
            nextValue:next.terminated?0:agent.value(next.observation.policyVector),terminated:next.terminated,truncated:next.truncated});
          steps++;result=next;
          if(steps%8===0||result.terminated||result.truncated)onFrame({scenario,result,action:sample.action,snapshot:environment.snapshot()});
          if(result.terminated||result.truncated){episodes++;if(result.info.reason==='success')successes++;onEpisode({seed:scenario.seed,reason:result.info.reason,reward:result.info.episodeReward,...summary()});environment.dispose();environment=null;}
        }
        const metrics=await agent.update(rows,{shouldStop,yieldControl});if(metrics.cancelled)return {cancelled:true,...summary()};
        completedUpdates++;await onUpdate({...summary(),...metrics});
      }
      return {cancelled:false,...summary()};
    }finally{environment?.dispose();}
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
