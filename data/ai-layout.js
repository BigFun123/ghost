// Presentation only: quick controls invoke the existing buttons and mirror their state.
(function(){
  const panel=document.getElementById('aiLearningPanel');if(!panel)return;
  const bar=document.createElement('div');bar.className='ai-quick-bar';bar.setAttribute('role','region');bar.setAttribute('aria-label','Learning session controls');
  const actions=document.createElement('div');actions.className='ai-quick-actions';bar.append(actions);
  const controls=[['aiLearningInitialize','Initialize'],['aiTrainingAuto','Auto train'],['aiTrainingStart','Train'],['aiTrainingPause',null],['aiTrainingStop',null],
    ['aiTrainingEvaluate','Evaluate'],['aiTrainingQualify','Qualify'],['aiTestRun','Test'],['aiTestStop','Stop test'],['aiTrainingSave','Save'],['aiTrainingLoad','Load'],['aiLearningStop','Stop session'],
    ['aiLearningValidate','Validate',true],['aiLearningStep','Step',true],['aiLearningReset','Reset',true],['aiLearningReadSensor','Read sensor',true],
    ['aiBaselineRun','Raster scan',true],['aiBaselineCancel','Cancel scan',true],['aiTrainingDiscard','Discard policy',true],['aiLearningFrame','Recenter',true],['aiLearningClear','Clear log',true]];
  const secondary=document.createElement('div');secondary.className='ai-quick-actions ai-quick-secondary';bar.append(secondary);
  const policyName=document.getElementById('aiPolicyName'),quickName=document.createElement('input'),nameLabel=document.createElement('label');
  nameLabel.className='ai-policy-name ai-policy-name-quick';nameLabel.textContent='Policy file name';quickName.type='text';quickName.maxLength=69;quickName.value=policyName.value;quickName.placeholder='Policy file name';quickName.setAttribute('aria-label','Quick policy file name');nameLabel.append(quickName);
  policyName.addEventListener('input',()=>{quickName.value=policyName.value;});quickName.addEventListener('input',()=>{policyName.value=quickName.value;});
  const mirrors=[];
  for(const [id,label,isSecondary] of controls){
    if(id==='aiTrainingSave')actions.append(nameLabel);
    const target=document.getElementById(id),button=document.createElement('button');button.type='button';
    button.className='ai-quick-button';if(['aiTrainingAuto','aiTrainingStart','aiTestRun'].includes(id))button.classList.add('ai-primary');
    if(['aiTrainingStop','aiTestStop','aiLearningStop'].includes(id))button.classList.add('ai-stop');
    button.addEventListener('click',()=>{if(!target.disabled)target.click();});(isSecondary?secondary:actions).append(button);mirrors.push({target,button,label});
  }
  const bottom=document.createElement('div');bottom.className='ai-quick-bottom';
  const status=document.createElement('output');status.id='aiQuickStatus';status.setAttribute('aria-live','polite');bottom.append(status);
  const toggles=document.createElement('div');toggles.className='ai-quick-toggles';bottom.append(toggles);bar.append(bottom);
  const telemetryHeader=panel.querySelector('.ai-simulation .ai-view-header');
  const sections=[];
  for(const section of panel.querySelectorAll('.ai-card,.ai-simulation,.ai-ppo-results,.ai-baseline-results,.ai-reward-card')){
    const header=Array.from(section.children).find(child=>child.matches('.ai-card-heading,.ai-view-header'));if(!header)continue;
    const title=(header.querySelector('h2')??header.querySelector('.ai-eyebrow')).textContent.trim();
    const key='ghost.ai.section.'+title.toLowerCase().replace(/[^a-z0-9]+/g,'-');
    const body=document.createElement('div');body.className='ai-section-body';body.id='aiSectionBody'+sections.length;
    for(const child of Array.from(section.childNodes))if(child!==header)body.append(child);
    section.append(body);section.classList.add('ai-collapsible');
    const toggle=document.createElement('button');toggle.type='button';toggle.className='ai-section-toggle';toggle.setAttribute('aria-controls',body.id);header.append(toggle);
    function setCollapsed(collapsed){
      body.hidden=collapsed;section.classList.toggle('ai-section-collapsed',collapsed);
      toggle.textContent=collapsed?'+':'−';toggle.setAttribute('aria-expanded',String(!collapsed));
      toggle.setAttribute('aria-label',(collapsed?'Expand ':'Collapse ')+title);toggle.title=(collapsed?'Expand ':'Collapse ')+title;
      try{localStorage.setItem(key,collapsed?'collapsed':'expanded');}catch{/* Storage may be unavailable. */}
    }
    let collapsed=false;try{collapsed=localStorage.getItem(key)==='collapsed';}catch{/* Default open. */}
    setCollapsed(collapsed);toggle.addEventListener('click',()=>setCollapsed(!body.hidden));sections.push({setCollapsed});
  }
  for(const [label,collapsed] of [['Collapse all',true],['Expand all',false]]){
    const button=document.createElement('button');button.type='button';button.textContent=label;
    button.addEventListener('click',()=>sections.forEach(section=>section.setCollapsed(collapsed)));toggles.append(button);
  }
  const weights=panel.querySelector('.ai-weight-panel'),spatial=panel.querySelector('.ai-spatial-split');
  if(weights&&spatial){
    weights.id='aiWeightPanel';
    const toggle=document.createElement('button');toggle.type='button';toggle.setAttribute('aria-controls',weights.id);
    let visible=true;try{visible=localStorage.getItem('ghost.ai.weights-visible')!=='hidden';}catch{/* Default visible. */}
    function showWeights(show){
      visible=show;weights.hidden=!show;spatial.classList.toggle('ai-weights-hidden',!show);
      toggle.textContent=show?'Hide weights':'Show weights';toggle.setAttribute('aria-expanded',String(show));
      globalThis.GhostLearningView?.draw();globalThis.GhostWeightSurface?.draw();
    }
    toggle.addEventListener('click',()=>{showWeights(!visible);try{localStorage.setItem('ghost.ai.weights-visible',visible?'visible':'hidden');}catch{/* Storage may be unavailable. */}});
    toggles.insertBefore(toggle,toggles.lastElementChild);showWeights(visible);
  }
  telemetryHeader.append(bar);
  function sync(){
    quickName.disabled=policyName.disabled;if(quickName.value!==policyName.value)quickName.value=policyName.value;
    for(const {target,button,label} of mirrors){
      button.disabled=target.disabled;
      const text=label??target.textContent.trim();if(button.textContent!==text)button.textContent=text;
      button.setAttribute('aria-label','Quick: '+target.textContent.trim());button.title=target.textContent.trim();
    }
    const state=document.getElementById('aiPolicyState').textContent;
    const source=document.getElementById(state==='TESTING'?'aiTestStatus':['TRAINING','PAUSED','EVALUATING','COMPARING'].includes(state)?'aiTrainingProgress':'aiLearningStatus');
    const auto=document.getElementById('aiAutoProgress').textContent;
    const text=state+' · '+(/^Batch \d+\//.test(auto)?auto+' · ':'')+source.textContent;if(status.textContent!==text)status.textContent=text;
  }
  const observer=new MutationObserver(sync);
  observer.observe(policyName,{attributes:true,attributeFilter:['disabled']});
  for(const {target} of mirrors)observer.observe(target,{attributes:true,attributeFilter:['disabled'],childList:true,subtree:true,characterData:true});
  for(const id of ['aiPolicyState','aiLearningStatus','aiTrainingProgress','aiTestStatus','aiAutoProgress'])observer.observe(document.getElementById(id),{childList:true,subtree:true,characterData:true});
  sync();
})();
