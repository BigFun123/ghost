// Bounded per-session history. Compare the same requested starting pose and seed.
(function(scope){
  function create(limit=100){
    let rows=[],serial=0;
    return {
      add({angles,seed,updates,episode,cancelled=false}){
        if(!Array.isArray(angles)||angles.length!==2||!angles.every(Number.isFinite)||!Number.isSafeInteger(seed)||!Number.isSafeInteger(updates)||updates<0)throw new Error('Invalid policy-test history input.');
        if(!cancelled&&(!episode||![episode.reward,episode.seconds].every(Number.isFinite)))throw new Error('A completed policy test needs a finite result.');
        const key=JSON.stringify([angles,seed]);
        rows.push({key,id:++serial,angles:[...angles],seed,updates,cancelled,reward:cancelled?null:episode.reward,seconds:cancelled?null:episode.seconds,reason:cancelled?'stopped':episode.reason});
        if(rows.length>limit)rows.shift();return key;
      },
      groups(){return [...new Map(rows.map(row=>[row.key,{key:row.key,label:row.angles.join('° / ')+'° · seed '+row.seed}])).values()];},
      series(key){return rows.filter(row=>row.key===key).map(row=>({...row,angles:[...row.angles]}));},
      summary(key){const all=rows.filter(row=>row.key===key),complete=all.filter(row=>!row.cancelled),recent=complete.slice(-5);return {completed:complete.length,stopped:all.length-complete.length,successes:recent.filter(row=>row.reason==='success').length,recent:recent.length,delta:complete.length>1?complete.at(-1).reward-complete[0].reward:null};},
      clear(){rows=[];serial=0;}
    };
  }
  scope.GhostTestHistory={create};
  if(typeof module!=='undefined'&&module.exports)module.exports=scope.GhostTestHistory;
  if(typeof document==='undefined')return;
  const svg=document.getElementById('aiTestProgressGraph');if(!svg)return;
  const history=create(),select=document.getElementById('aiTestHistoryPose'),detail=document.getElementById('aiTestHistoryDetail');
  const ns='http://www.w3.org/2000/svg';
  function element(name,attrs={},text){const node=document.createElementNS(ns,name);for(const [key,value] of Object.entries(attrs))node.setAttribute(key,String(value));if(text!==undefined)node.textContent=text;return node;}
  function draw(){
    svg.replaceChildren();const rows=history.series(select.value),complete=rows.filter(row=>!row.cancelled),summary=history.summary(select.value);
    const W=700,H=230,L=58,R=18,T=18,B=43,plotW=W-L-R,plotH=H-T-B;
    const title=element('title',{},'Policy-test return by run, for the same starting pose and seed');svg.append(title);
    svg.setAttribute('aria-label',complete.length?complete.length+' completed policy tests; return plotted by test number.':'No completed policy tests yet.');
    const values=complete.map(row=>row.reward),min=Math.min(0,...values),max=Math.max(1,...values),pad=(max-min)*.12,low=min-pad,high=max+pad;
    const x=index=>L+(rows.length<2?plotW/2:index/(rows.length-1)*plotW),y=value=>T+(high-value)/(high-low)*plotH;
    for(let i=0;i<5;i++){const value=low+(high-low)*i/4,yy=y(value);svg.append(element('line',{x1:L,y1:yy,x2:W-R,y2:yy,class:'ai-progress-grid'}),element('text',{x:L-9,y:yy+3,'text-anchor':'end',class:'ai-progress-axis'},value.toFixed(1)));}
    svg.append(element('text',{x:L,y:H-8,class:'ai-progress-axis'},'TEST NUMBER'),element('text',{x:4,y:12,class:'ai-progress-axis'},'RETURN'));
    let path='';rows.forEach((row,index)=>{if(!row.cancelled)path+=(path?' L ':'M ')+x(index)+' '+y(row.reward);});
    if(path)svg.append(element('path',{d:path,class:'ai-progress-line'}));
    rows.forEach((row,index)=>{
      const xx=x(index),yy=row.cancelled?T+plotH:y(row.reward),color=row.cancelled?'#8c9ca9':row.reason==='success'?'#85f5dc':row.reason==='invalid-state'?'#ff8198':'#eec57e';
      const point=element('circle',{cx:xx,cy:yy,r:row.cancelled?3:5,fill:color,tabindex:0,class:'ai-progress-point'});
      const text='Test '+row.id+' · '+row.updates+' training updates · '+(row.cancelled?'Stopped (excluded from scores)':row.reason+' · return '+row.reward.toFixed(3)+' · '+row.seconds.toFixed(2)+' s');
      point.append(element('title',{},text));point.setAttribute('aria-label',text);point.addEventListener('focus',()=>{detail.textContent=text;});point.addEventListener('pointerenter',()=>{detail.textContent=text;});svg.append(point);
      if(rows.length<=12||index===0||index===rows.length-1)svg.append(element('text',{x:xx,y:H-25,'text-anchor':'middle',class:'ai-progress-axis'},String(row.id)));
    });
    if(!complete.length)svg.append(element('text',{x:W/2,y:H/2,'text-anchor':'middle',class:'ai-progress-empty'},'Complete a policy test to start the graph.'));
    document.getElementById('aiTestHistorySummary').textContent=summary.completed+' completed · '+summary.stopped+' stopped (excluded) · last '+summary.recent+' completed: '+summary.successes+' acquired'+(summary.delta===null?'':' · return change '+(summary.delta>=0?'+':'')+summary.delta.toFixed(3));
    detail.textContent='Hover or focus a point for its outcome and training-update count.';
  }
  function refresh(key){
    const previous=key??select.value;select.replaceChildren();
    for(const group of history.groups()){const option=document.createElement('option');option.value=group.key;option.textContent=group.label;select.append(option);}
    select.disabled=!select.options.length;if([...select.options].some(option=>option.value===previous))select.value=previous;draw();
  }
  select.addEventListener('change',draw);
  document.getElementById('aiTestHistoryClear').addEventListener('click',()=>{history.clear();refresh();});
  scope.GhostTestProgress={record(input){refresh(history.add(input));},clear(){history.clear();refresh();}};
  refresh();
})(globalThis);
