// Cooperative local evaluation runner. No hardware API, policy training or DOM dependencies.
(function(scope){
  const median=values=>{if(!values.length)return null;const sorted=[...values].sort((a,b)=>a-b),middle=Math.floor(sorted.length/2);return sorted.length%2?sorted[middle]:(sorted[middle-1]+sorted[middle])/2;};
  // Diagnostics inspect ground truth only after the controller chooses its action.
  function createMetrics(targetIndex,initial){
    let previous=initial,jointTravelDegrees=0,falseTargetDetections=0,falseHoldAttempts=0,holdingWrong=false;
    const wrong=result=>!!result.observation.sensor.valid&&!!result.info.hit&&!(result.info.hit.kind==='component'&&result.info.hit.index===targetIndex);
    let seeingWrong=wrong(initial);if(seeingWrong)falseTargetDetections++;
    return {
      step(action,next){
        const before=previous.observation.jointAnglesDegrees,after=next.observation.jointAnglesDegrees;
        if(Object.prototype.hasOwnProperty.call(next.info,'episodeJointTravelDegrees'))jointTravelDegrees=Number.isFinite(next.info.episodeJointTravelDegrees)?next.info.episodeJointTravelDegrees:null;
        else if(!Array.isArray(before)||!Array.isArray(after)||before.length!==after.length||!before.every(Number.isFinite)||!after.every(Number.isFinite))jointTravelDegrees=null;
        else if(jointTravelDegrees!==null)jointTravelDegrees+=after.reduce((sum,angle,i)=>sum+Math.abs(angle-before[i]),0);
        const hold=action===0&&wrong(previous);if(hold&&!holdingWrong)falseHoldAttempts++;holdingWrong=hold;
        const detection=wrong(next);if(detection&&!seeingWrong)falseTargetDetections++;seeingWrong=detection;previous=next;
      },
      snapshot(){return {jointTravelDegrees,falseTargetDetections,falseHoldAttempts,initialJointAnglesDegrees:initial.observation.jointAnglesDegrees?[...initial.observation.jointAnglesDegrees]:null};}
    };
  }
  function summarize(episodes){
    const successes=episodes.filter(episode=>episode.reason==='success');
    return {episodes:episodes.length,successes:successes.length,successRate:episodes.length?successes.length/episodes.length:0,
      medianAcquisitionSeconds:median(successes.map(episode=>episode.seconds)),meanReward:episodes.length?episodes.reduce((sum,episode)=>sum+episode.reward,0)/episodes.length:0,
      timeouts:episodes.filter(episode=>episode.reason==='time-limit').length,invalidStates:episodes.filter(episode=>episode.reason==='invalid-state').length,
      falseLockAttempts:episodes.every(episode=>Number.isFinite(episode.falseLockAttempts))?episodes.reduce((sum,episode)=>sum+episode.falseLockAttempts,0):null,
      falseHoldAttempts:episodes.every(episode=>Number.isFinite(episode.falseHoldAttempts))?episodes.reduce((sum,episode)=>sum+episode.falseHoldAttempts,0):null,
      falseTargetDetections:episodes.every(episode=>Number.isFinite(episode.falseTargetDetections))?episodes.reduce((sum,episode)=>sum+episode.falseTargetDetections,0):null,
      meanJointTravelDegrees:episodes.length&&episodes.every(episode=>Number.isFinite(episode.jointTravelDegrees))?episodes.reduce((sum,episode)=>sum+episode.jointTravelDegrees,0)/episodes.length:null,
      timeoutRate:episodes.length?episodes.filter(episode=>episode.reason==='time-limit').length/episodes.length:null};
  }
  async function run({count,makeCase,createEnvironment,onFrame=()=>{},onEpisode=()=>{},shouldStop=()=>false,yieldControl=()=>new Promise(resolve=>setTimeout(resolve,0))}){
    if(!Number.isInteger(count)||count<1||count>50)throw new Error('Evaluate between 1 and 50 episodes.');
    const episodes=[];
    for(let index=0;index<count;index++){
      if(shouldStop())return {cancelled:true,episodes,summary:summarize(episodes)};
      await yieldControl();if(shouldStop())return {cancelled:true,episodes,summary:summarize(episodes)};
      const scenario=makeCase(index),environment=createEnvironment(scenario);let falseLockAttempts=0;
      try{
        let result=environment.reset(scenario.seed,scenario.resetOptions);
        const metrics=createMetrics(scenario.task.targetIndex,result);
        const controller=scope.GhostRasterBaseline.create({joints:scenario.task.joints,holdSeconds:scenario.task.holdSeconds});
        onFrame({index,scenario,result,phase:'reset',snapshot:environment.snapshot(),controller:controller.status()});
        const maxActions=Math.ceil(scenario.task.episodeSeconds/.05)+1;
        for(let step=0;step<maxActions;step++){
          if(shouldStop())return {cancelled:true,episodes,summary:summarize(episodes)};
          const action=controller.act(result.observation),state=controller.status();
          if(state.event==='lock-start'&&!(result.info.hit?.kind==='component'&&result.info.hit.index===scenario.task.targetIndex))falseLockAttempts++;
          result=environment.step(action);metrics.step(action,result);
          if(step%4===0||result.terminated||result.truncated)onFrame({index,scenario,result,snapshot:environment.snapshot(),controller:state});
          if(result.terminated||result.truncated){
            const episode={id:scenario.id,seed:scenario.seed,reason:result.info.reason,seconds:result.info.simulationSeconds,reward:result.info.episodeReward,
              ...metrics.snapshot(),lockAttempts:state.lockAttempts,falseLockAttempts,scanExhausted:state.exhausted,targetWorld:[...scenario.task.targetWorld]};
            episodes.push(episode);onEpisode(episode,summarize(episodes));break;
          }
          await yieldControl();
          if(step===maxActions-1)throw new Error('Environment did not terminate within its configured action budget.');
        }
      }finally{environment.dispose();}
    }
    return {cancelled:false,episodes,summary:summarize(episodes)};
  }
  scope.GhostBaselineEvaluation={run,summarize,createMetrics};
  if(typeof module!=='undefined'&&module.exports)module.exports=scope.GhostBaselineEvaluation;
})(globalThis);
