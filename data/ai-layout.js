// Presentation only: quick controls invoke the existing buttons and mirror their state.
(function(){
  const panel=document.getElementById('aiLearningPanel');if(!panel)return;
  const sectionHelp={
    '01 / MISSION':'Choose the sensor, target and pan/tilt joints, then validate or initialize an isolated simulation. Episode configuration sets the backend, seed, target hold duration and time limit. Initialization clears the live policy; save useful weights first.',
    '02 / EPISODE CONTROL':'Use this section to manually verify that actions achieve the expected result: the joints move correctly, the sensor finds the target, and holding it completes the episode. Each Step runs real simulated physics for 50 ms and updates sensor readings and rewards; it is not just a visual preview. Hold keeps joint commands unchanged but time still advances. If the sensor is already aimed at the target, select Hold and click Step repeatedly to verify target holding. Each click adds 50 ms; for a 0.5-second hold, allow about 10 steps. When the required hold is reached, the episode completes and Step grays out. Click Reset in Episode Control (or the header controls) to start a fresh episode and enable Step again; Reset returns to the seeded starting pose, so aim at the target again if necessary. Manual steps are not used for training and never change policy weights. Only Train policy and the training phases of Full Auto Train update weights. Step becomes disabled after acquisition, timeout or an invalid state; Reset starts another episode.',
    '03 / REFERENCE SCAN':'Run a programmed raster search as a reference, without neural-network training. It searches from the current pose, covering its starting tilt row first, then the middle and extremes before filling finer gaps. Similar continuous background returns do not trigger repeated holds. Small targets can still be missed before the episode time limit. Select the stage, seed split and episode count to compare success, acquisition time and movement.',
    '04 / POLICY OPTIMIZATION':'Train or load the shared PPO policy. Stage controls target and start variation; parallel worlds contribute experience to one network. Warm starts teach holding; progression moves toward ordinary starts. Full Auto repeats training, monitoring and policy tests, then final qualification when eligible. Stop retains weights for saving.',
    '06 / EVENT STREAM':'Read initialization errors, episode outcomes, training updates and evaluation messages. Clear removes only these messages; it does not discard the policy or reset training.',
    'Simulation twin':'Watch isolated training robots, sensor rays and target locations. Drag to orbit, scroll to zoom, or recenter. Warm floor tiles indicate each world\'s most recent completed episode succeeded. Alignment counts robots whose latest completed episode succeeded, matching the warm floors; it is not a held-out evaluation score. The convergence number is the latest monitoring acquisition percentage, not a probability of convergence. Use the header controls without scrolling.',
    '05 / TEST POLICY':'Run one episode with frozen weights from the starting pan/tilt angles entered here. Use -5/+5 or Random angles to change the start within joint limits. These inputs do not affect training. Watch actions and acquisition; Stop test cancels the episode without changing weights.',
    'PPO OPTIMIZATION':'Inspect sample counts, optimizer updates, action entropy and losses. These numbers describe learning activity, not proof of useful behavior. Use held-out monitoring and final qualification to assess the resulting policy.',
    'BASELINE EVALUATION':'Review raster-reference success rates, timeouts, acquisition times and travel. Compare learned-policy results on matching cases; successful-only median times do not include failures.',
    'REWARD TELEMETRY':'Inspect the reward and penalties from the latest displayed simulation step and episode. Detection, holding, movement, joint limits and success contribute to learning. High reward alone does not prove target acquisition or convergence.',
    'Policy weight surface':'View a selected network connection matrix as a 3D surface. Height and color show signed weights; Last update change magnifies differences between snapshots. Drag or use arrow keys to rotate. Training changes weights; tests keep them frozen. A changing surface does not by itself mean better performance.',
    'Policy test progress':'Compare completed tests with the same starting pose and seed. Curves show return over repeated tests; acquisition markers are the main outcome. Stopped tests are excluded. This small test history is not a convergence measurement.',
    'Convergence evidence':'Review held-out monitoring checkpoints. Three distinct training checkpoints must meet quality and stability requirements before separate final qualification. A 100% acquisition rate alone is not convergence. Loaded or restored evidence is stale until fresh evaluation.'
  };
  let helpSerial=0;
  function addSectionHelp(header,title){
    const text=sectionHelp[title];if(!text)return;
    const host=header.matches('h3')?header.closest('.ai-weight-panel,.ai-test-progress,.ai-monitor-history'):header.parentElement;
    host.classList.add('ai-help-owner');
    const help=document.createElement('button');help.type='button';help.className='ai-section-help';help.textContent='?';help.setAttribute('aria-label','Help for '+title);header.append(help);
    const contents=[];
    function wrap(paragraph,anchor){
      const line=document.createElement('div');line.className='ai-inline-help'+(anchor?' ai-header-help':'');
      const content=document.createElement('div');content.className='ai-help-content';content.id='aiInlineHelp'+(++helpSerial);content.hidden=true;
      if(anchor)anchor.after(line);else paragraph.parentNode.insertBefore(line,paragraph);
      line.append(content);content.append(paragraph);contents.push(content);
    }
    const introductory=document.createElement('p');introductory.textContent=text;
    const anchor=header.matches('h3')&&header.parentElement.matches('.ai-card-heading')?header.parentElement:header;
    wrap(introductory,anchor);
    // Keep each existing explanation where it was; live output and status remain visible.
    for(const paragraph of host.querySelectorAll('p.ai-description,p.ai-footnote:not([id]):not([role]),p.ai-weight-note')){
      if(paragraph.closest('.ai-help-owner')===host&&!paragraph.closest('.ai-inline-help'))wrap(paragraph);
    }
    help.setAttribute('aria-controls',contents.map(content=>content.id).join(' '));
    function setHelp(open){
      for(const content of contents){content.hidden=!open;content.parentElement.classList.toggle('is-open',open);}
      help.setAttribute('aria-expanded',String(open));help.title=(open?'Hide':'Show')+' section help';
    }
    setHelp(false);help.addEventListener('click',()=>setHelp(help.getAttribute('aria-expanded')!=='true'));
    return setHelp;
  }
  for(const heading of panel.querySelectorAll('.ai-weight-heading h3,.ai-test-progress h3,.ai-monitor-history h3'))addSectionHelp(heading,heading.textContent.trim());

  for(const id of ['aiTrainingStage','aiBaselineStage']){
    const select=document.getElementById(id);
    const describe=()=>{const text=select.selectedOptions[0]?.title??'';select.title=text;select.setAttribute('aria-description',text);};
    select.addEventListener('change',describe);describe();
  }
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
  const selectMirrors=[];
  for(const [id,label] of [['aiTrainingStage','Training stage'],['aiTrainingEnvironments','Parallel environments']]){
    const target=document.getElementById(id),field=document.createElement('label'),select=document.createElement('select');
    field.className='ai-quick-select';field.textContent=label;select.id=id+'Quick';select.setAttribute('aria-label','Quick '+label.toLowerCase());
    for(const option of target.options)select.append(option.cloneNode(true));
    select.value=target.value;field.append(select);actions.append(field);selectMirrors.push({target,select});
    select.addEventListener('change',()=>{if(target.disabled){sync();return;}target.value=select.value;target.dispatchEvent(new Event('change',{bubbles:true}));sync();});
    target.addEventListener('change',sync);
  }
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
    const setHelp=addSectionHelp(header,title);
    const key='ghost.ai.section.'+title.toLowerCase().replace(/[^a-z0-9]+/g,'-');
    const body=document.createElement('div');body.className='ai-section-body';body.id='aiSectionBody'+sections.length;
    for(const child of Array.from(section.childNodes))if(child!==header&&!child.classList?.contains('ai-header-help'))body.append(child);
    section.append(body);section.classList.add('ai-collapsible');
    const toggle=document.createElement('button');toggle.type='button';toggle.className='ai-section-toggle';toggle.setAttribute('aria-controls',body.id);header.append(toggle);
    function setCollapsed(collapsed){
      if(collapsed)setHelp?.(false);
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
  const headerActions=document.createElement('div');headerActions.className='ai-header-actions';
  headerActions.append(toggles,telemetryHeader.querySelector('.ai-section-toggle'));
  telemetryHeader.append(headerActions,bar);
  function sync(){
    for(const {target,select} of selectMirrors){select.value=target.value;select.disabled=target.disabled;select.title=target.title;}
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
  for(const {target} of selectMirrors)observer.observe(target,{attributes:true,attributeFilter:['disabled','title']});
  for(const {target} of mirrors)observer.observe(target,{attributes:true,attributeFilter:['disabled'],childList:true,subtree:true,characterData:true});
  for(const id of ['aiPolicyState','aiLearningStatus','aiTrainingProgress','aiTestStatus','aiAutoProgress'])observer.observe(document.getElementById(id),{childList:true,subtree:true,characterData:true});
  sync();
})();
