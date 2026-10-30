// Stage-scoped monitoring, not a probability of global optimality.
(function(scope){
  const version=1,bank='clean-v1',count=50;
  const median=values=>{const a=values.slice().sort((a,b)=>a-b);return a.length?(a[Math.floor((a.length-1)/2)]+a[Math.floor(a.length/2)])/2:null;};
  function interval(successes,n){if(!n)return [0,1];const z=1.96,p=successes/n,d=1+z*z/n,c=(p+z*z/(2*n))/d,r=z*Math.sqrt(p*(1-p)/n+z*z/(4*n*n))/d;return [Math.max(0,c-r),Math.min(1,c+r)];}
  function summarize(episodes){
    const successful=episodes.filter(e=>e.reason==='success'),n=episodes.length;
    return {n,successes:successful.length,rate:n?successful.length/n:0,interval:interval(successful.length,n),
      seconds:median(successful.map(e=>e.seconds)),travel:median(successful.map(e=>e.jointTravelDegrees)),
      reward:n?episodes.reduce((sum,e)=>sum+e.reward,0)/n:0,
      invalid:episodes.filter(e=>e.reason==='invalid-state').length,timeouts:episodes.filter(e=>e.reason==='time-limit').length,
      falseReturns:episodes.reduce((sum,e)=>sum+(e.falseTargetDetections||0),0),falseHolds:episodes.reduce((sum,e)=>sum+(e.falseHoldAttempts||0),0)};
  }
  const quality=s=>s.n===count&&s.rate>=.9&&s.interval[0]>=.8&&!s.invalid&&!s.falseHolds&&s.seconds!==null&&s.travel!==null;
  function create(){
    let rows=[],stale=true,key=null;
    const state=()=>{
      const complete=rows.filter(row=>row.complete),last=complete.at(-1),recent=complete.slice(-3);
      if(!last)return {status:rows.length?'Stale / insufficient evidence':'Insufficient evidence',rate:null,windows:0,rows:rows.slice()};
      const stable=field=>{const values=recent.map(row=>row.summary[field]);return values.every(Number.isFinite)&&Math.max(...values)-Math.min(...values)<=.1*Math.max(field==='seconds'?.1:1,...values);};
      const passed=recent.filter(row=>quality(row.summary)).length;
      let status='Insufficient evidence';
      if(recent.length===3){
        const first=recent[0].summary,current=last.summary;
        if(passed===3&&Math.max(...recent.map(r=>r.summary.rate))-Math.min(...recent.map(r=>r.summary.rate))<=.05&&stable('seconds')&&stable('travel'))status='Converged (validation)';
        else if(current.rate<first.rate-.1||(current.seconds!==null&&first.seconds!==null&&current.seconds>first.seconds*1.2+.1))status='Regressing';
        else if(!quality(current)&&Math.max(...recent.map(r=>r.summary.rate))-Math.min(...recent.map(r=>r.summary.rate))<=.05)status='Plateaued below target';
        else status='Improving / unstable';
      }
      return {status:stale?'Stale':status,rate:last.summary.rate,windows:Math.min(3,complete.length),passed,converged:!stale&&status==='Converged (validation)',rows:rows.slice()};
    };
    return {
      clear(){rows=[];stale=true;key=null;},stale(){stale=true;return state();},state,
      add({stageId,revision,updates,steps=0,episodes,cancelled=false}){
        const next=stageId+'/'+bank;if(key!==next){rows=[];key=next;}
        const complete=!cancelled&&episodes.length===count&&new Set(episodes.map(e=>e.seed)).size===count&&episodes.every(e=>Number.isFinite(e.seconds)&&Number.isFinite(e.reward)&&Number.isFinite(e.jointTravelDegrees));
        if(complete&&rows.some(row=>row.revision===revision&&row.complete)){stale=false;return state();}
        if(complete)rows=rows.filter(row=>!row.complete||row.updates!==updates);
        rows.push({stageId,bank,revision,updates,steps,complete,summary:summarize(episodes),at:new Date().toISOString()});if(rows.length>30)rows.shift();
        stale=!complete;return state();
      },export(){return {version,bank,rows:JSON.parse(JSON.stringify(rows))};},
      restore(record){rows=record?.version===version&&record?.bank===bank&&Array.isArray(record.rows)?record.rows.slice(-30).filter(row=>row&&typeof row.stageId==='string'&&row.summary&&Number.isFinite(row.summary.rate)&&Array.isArray(row.summary.interval)&&row.summary.interval.length===2&&row.summary.interval.every(v=>Number.isFinite(v)&&v>=0&&v<=1)&&['n','successes','rate','reward','invalid','timeouts','falseReturns','falseHolds'].every(k=>Number.isFinite(row.summary[k]))&&['seconds','travel'].every(k=>row.summary[k]===null||Number.isFinite(row.summary[k]))).map(row=>({...row,complete:false})):[];key=null;stale=true;return state();}
    };
  }
  scope.GhostConvergence={version,bank,count,create,interval,summarize,quality};
  if(typeof module!=='undefined'&&module.exports)module.exports=scope.GhostConvergence;
})(globalThis);
