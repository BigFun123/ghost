// Versioned, inspectable task reward. Privileged geometry stays outside observations.
(function (scope) {
  const weights=Object.freeze({timePerSecond:-0.05,firstDetection:0.25,holdPotential:1,alignmentPotential:4,
    actualTravelPerDegree:-0.002,commandTravelPerDegree:-0.001,limitAttempt:-0.05,success:10,invalid:-5});
  const empty=()=>({time:0,detection:0,hold:0,alignment:0,movement:0,limit:0,success:0,invalid:0});
  const sum=terms=>Object.values(terms).reduce((total,value)=>total+value,0);
  const bounded=value=>Math.max(0,Math.min(1,Number.isFinite(value)?value:0));
  function create({targetIndex,holdSeconds}) {
    if(!Number.isInteger(targetIndex)||!Number.isFinite(holdSeconds)||holdSeconds<=0)throw new Error('Invalid reward task.');
    let terms=empty(),totals=empty(),seenTarget=false,previousHold=0,previousAlignment=0,finished=false;
    function add(term,value){terms[term]+=value;totals[term]+=value;}
    function snapshot(){return {version:2,reward:sum(terms),terms:{...terms},episodeReward:sum(totals),episodeTerms:{...totals}};}
    return {
      reset(alignment=0){terms=empty();totals=empty();seenTarget=false;previousHold=0;previousAlignment=bounded(alignment);finished=false;return snapshot();},
      beginAction({commandTravel=0,limitFraction=0}={}) {
        if(finished)throw new Error('Reset reward state before a new episode.');
        if(!Number.isFinite(commandTravel)||commandTravel<0||!Number.isFinite(limitFraction)||limitFraction<0||limitFraction>1)throw new Error('Invalid action reward inputs.');
        terms=empty();add('movement',weights.commandTravelPerDegree*commandTravel);add('limit',weights.limitAttempt*limitFraction);
      },
      tick({reading,elapsedSeconds,actualTravel,heldSeconds,alignment,success=false,invalid=false}) {
        if(finished)throw new Error('Reward episode already ended.');
        if(![elapsedSeconds,actualTravel,heldSeconds].every(value=>Number.isFinite(value)&&value>=0))throw new Error('Invalid simulation reward inputs.');
        const targetHit=!invalid&&reading?.valid&&Number.isFinite(reading.distanceMm)&&reading.distanceMm>=0&&reading.hit?.kind==='component'&&reading.hit.index===targetIndex;
        add('time',weights.timePerSecond*elapsedSeconds);
        add('movement',weights.actualTravelPerDegree*actualTravel);
        if(targetHit&&!seenTarget){add('detection',weights.firstDetection);seenTarget=true;}
        const hold=targetHit?bounded(heldSeconds/holdSeconds):0;
        // Potential differences telescope: repeated acquisition/loss and aim oscillation cannot farm progress.
        add('hold',weights.holdPotential*(hold*hold-previousHold*previousHold));previousHold=hold;
        const potential=invalid?previousAlignment:bounded(alignment);
        add('alignment',weights.alignmentPotential*(potential-previousAlignment));previousAlignment=potential;
        if(invalid){add('invalid',weights.invalid);finished=true;}
        else if(success&&targetHit&&hold>=1){add('success',weights.success);finished=true;}
      },
      snapshot
    };
  }
  scope.GhostLearningReward={create,weights,version:2};
  if(typeof module!=='undefined'&&module.exports)module.exports=scope.GhostLearningReward;
})(globalThis);
