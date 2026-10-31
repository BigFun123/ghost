// Read-only 3D view of configured poses or immutable isolated-world snapshots.
(function (scope) {
  const canvas=document.getElementById('aiLearningScene');
  if(!canvas)return;
  const ctx=canvas.getContext('2d');
  let snapshot=null,faces=[],points=[],center=[0,0,0],radius=100,fitWidth=200,fitHeight=150,yaw=-0.65,pitch=0.42,zoom=1,sceneKey='',drag=null,gridKey='',gridSpacing=450;
  const sub=(a,b)=>a.map((value,i)=>value-b[i]);
  function world(index,point,shaft=false) {
    const pose=snapshot.poses[index][shaft?'shaft':'body'];
    return pose.origin.map((value,axis)=>value+point.reduce((sum,coordinate,i)=>sum+coordinate*pose.axes[i][axis],0));
  }
  const meshCache=new Map();
  function geometry() {
    faces=[];points=[];
    snapshot.nodes.forEach((node,index)=>{
      const ignored=new Set(['name','parent','position','rotation','angle','spinAngle','motion','outputEnabled','enabled']);
      const key=JSON.stringify([snapshot.gridCount>=64?'overview':!!snapshot.gridCount,Object.fromEntries(Object.entries(node).filter(([key])=>!ignored.has(key)))]);
      let mesh=meshCache.get(key);
      if(!mesh){
        mesh=[];const face=(vertices,color,shaft,outline=true)=>mesh.push({vertices,color,shaft:!!shaft,outline});
        if(snapshot.gridCount&&node.objectType==='Target'){
          const vertices=[[5,0,0],[-5,0,0],[0,5,0],[0,-5,0],[0,0,5],[0,0,-5]];
          for(const a of [0,1])for(const b of [2,3])for(const c of [4,5])face([vertices[a],vertices[b],vertices[c]],'#ff1717',false,false);
        }else componentRegistry.draw(node,{purpose:'render',color:'#7895a8',state:{ledRgb:[80,225,200]},label(){},
          box(offset,size,color,shaft){
            const vertices=Array.from({length:8},(_,bits)=>offset.map((v,i)=>v+((bits>>i&1)-0.5)*size[i]));
            [[0,1,3,2],[4,5,7,6],[0,1,5,4],[2,3,7,6],[0,2,6,4],[1,3,7,5]].forEach(ids=>face(ids.map(i=>vertices[i]),color,shaft));
          },
          cylinder(offset,r,h,color,shaft,options={}){
            const segments=snapshot.gridCount?8:16,rings=[-0.5,0.5].map(sign=>Array.from({length:segments},(_,i)=>[offset[0]+Math.cos(i*2*Math.PI/segments)*r,offset[1]+sign*h,offset[2]+Math.sin(i*2*Math.PI/segments)*r]));
            rings.forEach(ring=>face(ring,color,shaft,options.outline!==false));
            for(let i=0;i<segments;i++){const next=(i+1)%segments;face([rings[0][i],rings[0][next],rings[1][next],rings[1][i]],color,shaft,options.outline!==false);}
          }
        });
        if(snapshot.gridCount>=64&&node.objectType!=='Target'){
          const simplified=[];
          for(const shaft of [false,true]){
            const parts=mesh.filter(face=>face.shaft===shaft);if(!parts.length)continue;
            const low=[Infinity,Infinity,Infinity],high=[-Infinity,-Infinity,-Infinity];
            for(const face of parts)for(const vertex of face.vertices)for(let axis=0;axis<3;axis++){low[axis]=Math.min(low[axis],vertex[axis]);high[axis]=Math.max(high[axis],vertex[axis]);}
            const vertices=Array.from({length:8},(_,bits)=>low.map((v,i)=>(bits>>i&1)?high[i]:v));
            for(const ids of [[0,1,3,2],[4,5,7,6],[0,1,5,4],[2,3,7,6],[0,2,6,4],[1,3,7,5]])simplified.push({vertices:ids.map(i=>vertices[i]),color:parts[0].color,shaft,outline:true});
          }
          mesh=simplified;
        }
        if(meshCache.size>=128)meshCache.clear();meshCache.set(key,mesh);
      }
      for(const face of mesh){const vertices=face.vertices.map(point=>world(index,point,face.shaft));points.push(...vertices);faces.push({vertices,color:face.color,outline:face.outline});}
    });
  }
  function frame() {
    if(!points.length)return;
    const low=[Infinity,Infinity,Infinity],high=[-Infinity,-Infinity,-Infinity];
    for(const point of points)for(let i=0;i<3;i++){low[i]=Math.min(low[i],point[i]);high[i]=Math.max(high[i],point[i]);}
    center=low.map((value,i)=>(value+high[i])/2);radius=35;
    let left=Infinity,right=-Infinity,bottom=Infinity,top=-Infinity;
    for(const point of points){const [x,y,z]=sub(point,center);radius=Math.max(radius,Math.hypot(x,y,z));const a=x*Math.cos(yaw)-z*Math.sin(yaw),b=x*Math.sin(yaw)+z*Math.cos(yaw),v=y*Math.cos(pitch)-b*Math.sin(pitch);left=Math.min(left,a);right=Math.max(right,a);bottom=Math.min(bottom,v);top=Math.max(top,v);}
    fitWidth=Math.max(30,right-left);fitHeight=Math.max(30,top-bottom);zoom=1;draw();
  }
  function draw() {
    if(!ctx||!canvas.clientWidth||!canvas.clientHeight||document.getElementById('aiLearningPanel').hidden)return;
    const w=canvas.clientWidth,h=canvas.clientHeight,ratio=Math.min(scope.devicePixelRatio||1,1.5);
    canvas.width=Math.round(w*ratio);canvas.height=Math.round(h*ratio);ctx.scale(ratio,ratio);
    const background=ctx.createRadialGradient(w*.55,h*.4,0,w*.5,h*.5,w*.7);background.addColorStop(0,'#132b38');background.addColorStop(1,'#08121d');ctx.fillStyle=background;ctx.fillRect(0,0,w,h);
    const scale=Math.max(.1,Math.min((w-90)/fitWidth,(h-70)/fitHeight))*.85*zoom;
    const project=point=>{
      const [x,y,z]=sub(point,center),a=x*Math.cos(yaw)-z*Math.sin(yaw),b=x*Math.sin(yaw)+z*Math.cos(yaw);
      return [w/2+a*scale,h*.49-(y*Math.cos(pitch)-b*Math.sin(pitch))*scale,y*Math.sin(pitch)+b*Math.cos(pitch)];
    };
    const line=(a,b,color,width=1,dashes=[])=>{a=project(a);b=project(b);ctx.beginPath();ctx.strokeStyle=color;ctx.lineWidth=width;ctx.setLineDash(dashes);ctx.moveTo(a[0],a[1]);ctx.lineTo(b[0],b[1]);ctx.stroke();ctx.setLineDash([]);};
    const extent=Math.max(200,Math.ceil(radius/50)*100),grid=Math.max(10,Math.ceil(extent/400)*10);
    for(let value=-extent;value<=extent;value+=grid){const major=value%(grid*5)===0;line([value,0,-extent],[value,0,extent],major?'#2b4b5b':'#19323f',major?.7:.4);line([-extent,0,value],[extent,0,value],major?'#2b4b5b':'#19323f',major?.7:.4);}
    if(!snapshot)return;
    renderPreviewFaces(ctx,faces.map(face=>({points:face.vertices.map(project),color:face.color,outline:face.outline})),canvas.width,canvas.height,ratio);
    for(const reading of snapshot.readings??[snapshot.reading]){
    if(reading?.origin&&reading.direction){
      const end=reading.point??reading.origin.map((value,i)=>value+reading.direction[i]*(snapshot.gridCount?Math.min(2000,snapshot.gridSpacing*.45):2000));
      line(reading.origin,end,'#85f5dc',1.6,[3,5]);
      const p=project(reading.origin);ctx.fillStyle='#aaffee';ctx.beginPath();ctx.arc(p[0],p[1],snapshot.gridCount?1.5:3,0,Math.PI*2);ctx.fill();
      if(reading.valid){const p=project(end);ctx.strokeStyle='#b5ffdf';ctx.beginPath();ctx.arc(p[0],p[1],snapshot.gridCount?3:6,0,Math.PI*2);ctx.stroke();}
    }
    }
    for(const target of snapshot.targets??[snapshot.targetIndex]){
    if(Number.isInteger(target)&&snapshot.poses[target]){
      const p=project(snapshot.poses[target].body.origin);ctx.strokeStyle='#ff858c';ctx.lineWidth=1;ctx.beginPath();ctx.arc(p[0],p[1],snapshot.gridCount>=64?2:snapshot.gridCount?6:13,0,Math.PI*2);ctx.stroke();
      ctx.font='9px ui-monospace, Consolas, monospace';ctx.fillStyle='#ffabb0';if(!snapshot.gridCount)ctx.fillText('TARGET',p[0]+20,p[1]-8);
    }
    }
    for(const cell of snapshot.cells??[]){
      const [x,y,z]=cell.origin,half=snapshot.gridSpacing*.47;
      const corners=[[x-half,y,z-half],[x+half,y,z-half],[x+half,y,z+half],[x-half,y,z+half]];
      corners.forEach((point,index)=>line(point,corners[(index+1)%4],'#416575',.8));
      const point=project([x-half,y,z-half]);ctx.font='10px ui-monospace, Consolas, monospace';ctx.fillStyle='#a7e9dc';if(snapshot.gridCount<=64||zoom>=2||cell.index%16===0)ctx.fillText(cell.label,point[0]+4,point[1]-5);
    }
    // Quiet corner brackets anchor the view without a moving HUD.
    ctx.strokeStyle='#466879';ctx.lineWidth=1;for(const [x,y,sx,sy] of [[14,40,1,1],[w-14,40,-1,1],[14,h-14,1,-1],[w-14,h-14,-1,-1]]){ctx.beginPath();ctx.moveTo(x,y+sy*12);ctx.lineTo(x,y);ctx.lineTo(x+sx*12,y);ctx.stroke();}
  }
  function grid(next){
    const replicas=next.replicas;if(!Array.isArray(replicas)||replicas.length<2)return next;
    const count=replicas.length,columns=Math.ceil(Math.sqrt(count)),rows=Math.ceil(count/columns),key=count+'/'+next.gridStage+'/'+JSON.stringify(replicas[0].nodes.map(node=>[node.name,next.gridStage==='random-target'&&node.objectType==='Target'?null:node.position,node.rotation]));
    if(gridKey!==key){
      const origins=replicas.flatMap(replica=>replica.poses.map(pose=>pose.body.origin));
      const span=axis=>Math.max(...origins.map(p=>p[axis]))-Math.min(...origins.map(p=>p[axis]));
      gridSpacing=Math.max(next.gridStage==='random-target'?1200:350,span(0)+120,span(2)+120);gridKey=key;
    }
    const nodes=[],poses=[],readings=[],targets=[],cells=[];
    replicas.forEach((replica,index)=>{
      const offset=[(index%columns-(columns-1)/2)*gridSpacing,0,(Math.floor(index/columns)-(rows-1)/2)*gridSpacing],base=nodes.length;
      const shift=point=>point.map((v,i)=>v+offset[i]);
      nodes.push(...replica.nodes.map(node=>({...node,name:'E'+(index+1)+' / '+node.name,position:shift(node.position)})));
      poses.push(...replica.poses.map(pose=>Object.fromEntries(['body','shaft'].map(kind=>[kind,{...pose[kind],origin:shift(pose[kind].origin)}]))));
      if(replica.reading?.origin)readings.push({...replica.reading,origin:shift(replica.reading.origin),point:replica.reading.point?shift(replica.reading.point):null});
      if(Number.isInteger(replica.targetIndex))targets.push(base+replica.targetIndex);
      cells.push({index,origin:offset,label:'E'+String(index+1).padStart(2,'0')});
    });
    return {...next,nodes,poses,reading:null,targetIndex:null,readings,targets,cells,gridCount:count,gridSpacing};
  }
  function show(next) {
    next=next?.replicas?grid(next):next;
    canvas.parentElement?.classList?.toggle('ai-grid-viewport',!!next?.gridCount);
    snapshot=next;document.getElementById('aiLearningViewEmpty').hidden=!!next?.nodes.length;
    if(!next?.nodes.length){faces=[];points=[];draw();return;}
    geometry();const key=next.nodes.map(node=>node.name+':'+node.position.join(',')).join('|');
    if(sceneKey!==key){sceneKey=key;frame();}else draw();
    const baseline=next.mode==='baseline',policy=next.mode==='training'||next.mode==='policy-eval'||next.mode==='policy-test',isolated=next.mode==='isolated'||baseline||policy;
    document.getElementById('aiLearningViewMode').textContent=next.mode==='policy-test'?(next.policyRunning?'POLICY / TESTING':'POLICY / TEST FINISHED'):policy?(next.mode==='policy-eval'?(next.policyRunning?'POLICY / EVALUATION':'POLICY / READY'):next.policyPaused?'PPO / PAUSED':next.policyRunning?'PPO / TRAINING':'PPO / READY'):baseline?(next.baselineRunning?(['pan-home','tilt-home'].includes(next.baselinePhase)?'RASTER / HOMING':'RASTER / RUNNING'):'RASTER / FINISHED'):isolated?'ISOLATED / PAUSED':'RIG PREVIEW';
    if(next.gridCount)document.getElementById('aiLearningViewMode').textContent=(next.gridPreview?'GRID PREVIEW':next.policyPaused?'PPO / PAUSED':next.policyRunning?'PPO / TRAINING':'PPO / READY')+' / '+next.gridCount+' WORLDS';
    document.getElementById('aiLearningViewHint').textContent=next.gridCount?next.gridCount+' isolated worlds / telemetry E01 / '+(next.gridCount>=64?'overview geometry / ':'')+'display-only offsets / drag to orbit':isolated?'Actual physics pose · drag to orbit':'Configured pose · initialize for isolated physics';
  }
  canvas.addEventListener('pointerdown',event=>{drag=[event.clientX,event.clientY];canvas.setPointerCapture(event.pointerId);});
  canvas.addEventListener('pointermove',event=>{if(!drag)return;yaw+=(event.clientX-drag[0])*.008;pitch=Math.max(-1.3,Math.min(1.3,pitch+(event.clientY-drag[1])*.008));drag=[event.clientX,event.clientY];draw();});
  for(const type of ['pointerup','pointercancel','lostpointercapture'])canvas.addEventListener(type,()=>{drag=null;});
  canvas.addEventListener('wheel',event=>{event.preventDefault();zoom=Math.max(.2,Math.min(8,zoom*Math.exp(-event.deltaY*.001)));draw();},{passive:false});
  canvas.addEventListener('keydown',event=>{const keys=['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','+','=','-'];if(!keys.includes(event.key))return;event.preventDefault();if(event.key==='ArrowLeft')yaw-=.1;if(event.key==='ArrowRight')yaw+=.1;if(event.key==='ArrowUp')pitch=Math.min(1.3,pitch+.1);if(event.key==='ArrowDown')pitch=Math.max(-1.3,pitch-.1);if(['+','='].includes(event.key))zoom=Math.min(8,zoom*1.1);if(event.key==='-')zoom=Math.max(.2,zoom/1.1);draw();});
  document.getElementById('aiLearningFrame').addEventListener('click',()=>{yaw=-.65;pitch=.42;frame();});
  new ResizeObserver(()=>draw()).observe(canvas);
  scope.GhostLearningView={show,draw};
})(globalThis);

// A bounded, read-only view of real worker kernels, sampled between optimizer updates.
(function(scope){
  const canvas=document.getElementById('aiWeightSurface');if(!canvas)return;
  const ctx=canvas.getContext('2d'),layer=document.getElementById('aiWeightLayer'),mode=document.getElementById('aiWeightMode'),stats=document.getElementById('aiWeightStats'),empty=document.getElementById('aiWeightEmpty');
  let data=null,previous=null,changes=[],ranges=[],changeRanges=[],yaw=-.7,pitch=.65,drag=null,scheduled=false;
  function schedule(){if(scheduled)return;scheduled=true;requestAnimationFrame(()=>{scheduled=false;draw();});}
  function show(next){
    if(next&&(!Array.isArray(next.matrices)||!next.matrices.length||next.matrices.some(m=>m.shape?.length!==2||m.shape.some(n=>!Number.isInteger(n)||n<1||n>256)||m.values?.length!==m.shape[0]*m.shape[1]||!m.values.every(Number.isFinite))))return;
    previous=data;data=next;
    if(!next){previous=null;changes=[];ranges=[];changeRanges=[];layer.replaceChildren();layer.disabled=true;empty.hidden=false;stats.textContent='No policy weights yet.';schedule();return;}
    const reset=next.reset||!previous||next.optimizerSteps<previous.optimizerSteps||next.updates<previous.updates;
    if(reset){previous=null;ranges=[];changeRanges=[];}
    changes=next.matrices.map((m,i)=>{const old=previous?.matrices[i];return m.values.map((v,j)=>old&&old.shape.join(',')===m.shape.join(',')?v-old.values[j]:0);});
    const selected=layer.value;layer.replaceChildren();
    next.matrices.forEach((m,i)=>{const option=document.createElement('option');option.value=String(i);option.textContent=m.name+' / '+m.shape.join(' x ');layer.append(option);});
    layer.value=next.matrices[Number(selected)]?selected:'0';if(!layer.value)layer.value='0';layer.disabled=false;empty.hidden=true;schedule();
  }
  function draw(){
    if(!ctx||!canvas.clientWidth||!canvas.clientHeight||document.getElementById('aiLearningPanel').hidden)return;
    const w=canvas.clientWidth,h=canvas.clientHeight,dpr=Math.min(scope.devicePixelRatio||1,1.5);canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);ctx.scale(dpr,dpr);ctx.clearRect(0,0,w,h);
    if(!data)return;
    const index=Number(layer.value),matrix=data.matrices[index];if(!matrix)return;
    const delta=mode.value==='change',values=delta?changes[index]:matrix.values,[rows,cols]=matrix.shape;
    let min=Infinity,max=-Infinity,squares=0;for(const v of values){min=Math.min(min,v);max=Math.max(max,v);}for(const v of changes[index])squares+=v*v;
    const scales=delta?changeRanges:ranges,extent=scales[index]=Math.max(scales[index]??(delta?.005:.1),Math.abs(min),Math.abs(max));
    const scale=Math.min(w*.32,h*.43),cy=Math.cos(yaw),sy=Math.sin(yaw),cp=Math.cos(pitch),sp=Math.sin(pitch);
    const project=(x,y,z)=>{const depth=-x*sy+z*cy;return [w/2+(x*cy+z*sy)*scale,h*.55+(depth*sp-y*cp)*scale,depth*cp+y*sp];};
    const path=points=>{ctx.beginPath();points.forEach((p,i)=>i?ctx.lineTo(p[0],p[1]):ctx.moveTo(p[0],p[1]));ctx.closePath();};
    ctx.strokeStyle='#254253';ctx.lineWidth=.6;
    for(let i=0;i<=8;i++){const t=-1+i/4;for(const ends of [[[-1,0,t],[1,0,t]],[[t,0,-1],[t,0,1]]]){const a=project(...ends[0]),b=project(...ends[1]);ctx.beginPath();ctx.moveTo(a[0],a[1]);ctx.lineTo(b[0],b[1]);ctx.stroke();}}
    const columns=Math.max(2,cols),rowCount=Math.max(2,rows),faces=[];
    const vertex=(r,c)=>{const value=values[Math.min(r,rows-1)*cols+Math.min(c,cols-1)];return {p:project(-1+2*r/(rowCount-1),value/extent*.8,-1+2*c/(columns-1)),v:value};};
    for(let r=0;r<rowCount-1;r++)for(let c=0;c<columns-1;c++){const vertices=[vertex(r,c),vertex(r+1,c),vertex(r+1,c+1),vertex(r,c+1)];faces.push({vertices,depth:vertices.reduce((sum,v)=>sum+v.p[2],0)/4,value:vertices.reduce((sum,v)=>sum+v.v,0)/4});}
    faces.sort((a,b)=>a.depth-b.depth);
    for(const face of faces){const t=Math.min(1,Math.abs(face.value)/extent);ctx.fillStyle=face.value<0?'hsl(203 80% '+(25+t*36)+'%)':'hsl('+(42-t*17)+' 80% '+(24+t*38)+'%)';ctx.strokeStyle='#8bd9ef30';ctx.lineWidth=.4;path(face.vertices.map(v=>v.p));ctx.fill();ctx.stroke();}
    ctx.fillStyle='#9ab9cc';ctx.font='10px ui-monospace, Consolas, monospace';
    const label=(text,point)=>{const p=project(...point);ctx.fillText(text,Math.max(6,Math.min(w-100,p[0])),Math.max(12,Math.min(h-6,p[1])));};
    label('Rows: '+rows,[1,0,-1]);label('Columns: '+cols,[-1,0,1]);ctx.fillText('Z '+(delta?'delta ':'weight ')+'+/- '+extent.toFixed(4),12,18);
    const rms=Math.sqrt(squares/values.length),text='Update '+data.updates+' / optimizer '+data.optimizerSteps+' / min '+min.toFixed(5)+' / max '+max.toFixed(5)+' / change RMS '+rms.toExponential(2);
    stats.textContent=text;canvas.setAttribute('aria-label',matrix.name+', '+rows+' rows, '+cols+' columns. '+text+'. Drag or use arrow keys to rotate.');
  }
  layer.addEventListener('change',schedule);mode.addEventListener('change',schedule);
  canvas.addEventListener('pointerdown',e=>{drag=[e.clientX,e.clientY];canvas.setPointerCapture(e.pointerId);});
  canvas.addEventListener('pointermove',e=>{if(!drag)return;yaw+=(e.clientX-drag[0])*.008;pitch=Math.max(.15,Math.min(1.4,pitch+(e.clientY-drag[1])*.008));drag=[e.clientX,e.clientY];schedule();});
  for(const type of ['pointerup','pointercancel','lostpointercapture'])canvas.addEventListener(type,()=>{drag=null;});
  canvas.addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key))return;e.preventDefault();if(e.key==='ArrowLeft')yaw-=.1;if(e.key==='ArrowRight')yaw+=.1;if(e.key==='ArrowUp')pitch=Math.min(1.4,pitch+.1);if(e.key==='ArrowDown')pitch=Math.max(.15,pitch-.1);schedule();});
  new ResizeObserver(schedule).observe(canvas);new MutationObserver(schedule).observe(document.getElementById('aiLearningPanel'),{attributes:true,attributeFilter:['hidden']});
  scope.GhostWeightSurface={show,draw:schedule};
})(globalThis);
