// Bounded stage-scoped training with monitored early stopping and a separate final bank.
(function(scope){
  async function run({maxBatches,train,evaluate,test,qualify,earlyStop=true,shouldStop=()=>false,onProgress=()=>{}}){
    if(!Number.isSafeInteger(maxBatches)||maxBatches<1||maxBatches>500)throw new Error('Auto training needs a batch limit from 1 to 500.');
    const cancelled=result=>shouldStop()||result?.cancelled;
    for(let batch=1;batch<=maxBatches;batch++){
      if(shouldStop())return {reason:'stopped',batch:batch-1};
      onProgress({phase:'training',batch,maxBatches,streak:0});
      const trained=await train();if(cancelled(trained))return {reason:'stopped',batch};
      if(!trained)throw new Error('Training did not complete; review the training output.');
      onProgress({phase:'monitoring 50 cases',batch,maxBatches,streak:0});
      const evaluated=await evaluate();if(cancelled(evaluated))return {reason:'stopped',batch};
      if(!evaluated||evaluated.episodes?.length!==50||new Set(evaluated.episodes.map(row=>row.seed)).size!==50||!evaluated.convergence)throw new Error('Auto training requires all 50 distinct monitoring cases and convergence evidence.');
      onProgress({phase:'startup test',batch,maxBatches,streak:evaluated.convergence.passed??0});
      const tested=await test();if(cancelled(tested))return {reason:'stopped',batch};
      if(!tested||tested.episodes?.length!==1)throw new Error('Startup policy test did not complete.');
      onProgress({phase:evaluated.convergence.status,batch,maxBatches,streak:evaluated.convergence.passed??0,successes:evaluated.episodes.filter(row=>row.reason==='success').length});
      if(evaluated.convergence.converged&&tested.episodes[0].reason==='success'&&(earlyStop||batch===maxBatches)){
        onProgress({phase:'final qualification + raster / 50 separate cases',batch,maxBatches,streak:3});
        const final=await qualify();if(cancelled(final))return {reason:'stopped',batch};
        if(!final||final.episodes?.length!==50||new Set(final.episodes.map(row=>row.seed)).size!==50)throw new Error('Final qualification did not complete all 50 cases.');
        return {reason:final.qualified?'qualified':'qualification-failed',batch};
      }
    }
    return {reason:'limit',batch:maxBatches};
  }
  scope.GhostAutoTraining={run};
  if(typeof module!=='undefined'&&module.exports)module.exports=scope.GhostAutoTraining;
})(globalThis);
