// Read-only 3D view of configured poses or immutable isolated-world snapshots.
(function (scope) {
  const canvas=document.getElementById('aiLearningScene');
  if(!canvas)return;
  const ctx=canvas.getContext('2d');
  let snapshot=null,faces=[],points=[],center=[0,0,0],radius=100,fitWidth=200,fitHeight=150,yaw=-0.65,pitch=0.42,zoom=1,sceneKey='',drag=null;
  const sub=(a,b)=>a.map((value,i)=>value-b[i]);
  function world(index,point,shaft=false) {
    const pose=snapshot.poses[index][shaft?'shaft':'body'];
    return pose.origin.map((value,axis)=>value+point.reduce((sum,coordinate,i)=>sum+coordinate*pose.axes[i][axis],0));
  }
  function geometry() {
    faces=[];points=[];
    snapshot.nodes.forEach((node,index)=>{
      const face=(vertices,color,shaft,outline=true)=>{
        const verticesWorld=vertices.map(point=>world(index,point,shaft));points.push(...verticesWorld);
        faces.push({vertices:verticesWorld,color,outline});
      };
      componentRegistry.draw(node,{purpose:'render',color:'#7895a8',state:{ledRgb:[80,225,200]},label(){},
        box(offset,size,color,shaft){
          const vertices=Array.from({length:8},(_,bits)=>offset.map((v,i)=>v+((bits>>i&1)-0.5)*size[i]));
          [[0,1,3,2],[4,5,7,6],[0,1,5,4],[2,3,7,6],[0,2,6,4],[1,3,7,5]].forEach(ids=>face(ids.map(i=>vertices[i]),color,shaft));
        },
        cylinder(offset,r,h,color,shaft,options={}){
          const rings=[-0.5,0.5].map(sign=>Array.from({length:16},(_,i)=>[offset[0]+Math.cos(i*Math.PI/8)*r,offset[1]+sign*h,offset[2]+Math.sin(i*Math.PI/8)*r]));
          rings.forEach(ring=>face(ring,color,shaft,options.outline!==false));
          for(let i=0;i<16;i++){const next=(i+1)%16;face([rings[0][i],rings[0][next],rings[1][next],rings[1][i]],color,shaft,options.outline!==false);}
        }
      });
    });
  }
  function frame() {
    if(!points.length)return;
    const low=[0,1,2].map(axis=>Math.min(...points.map(p=>p[axis]))),high=[0,1,2].map(axis=>Math.max(...points.map(p=>p[axis])));
    center=low.map((value,i)=>(value+high[i])/2);
    radius=Math.max(35,...points.map(p=>Math.hypot(...sub(p,center))));
    const projected=points.map(point=>{const [x,y,z]=sub(point,center),a=x*Math.cos(yaw)-z*Math.sin(yaw),b=x*Math.sin(yaw)+z*Math.cos(yaw);return [a,y*Math.cos(pitch)-b*Math.sin(pitch)];});
    fitWidth=Math.max(30,Math.max(...projected.map(p=>p[0]))-Math.min(...projected.map(p=>p[0])));
    fitHeight=Math.max(30,Math.max(...projected.map(p=>p[1]))-Math.min(...projected.map(p=>p[1])));zoom=1;draw();
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
    const reading=snapshot.reading;
    if(reading?.origin&&reading.direction){
      const end=reading.point??reading.origin.map((value,i)=>value+reading.direction[i]*2000);
      line(reading.origin,end,'#85f5dc',1.6,[3,5]);
      const p=project(reading.origin);ctx.fillStyle='#aaffee';ctx.beginPath();ctx.arc(p[0],p[1],3,0,Math.PI*2);ctx.fill();
      if(reading.valid){const p=project(end);ctx.strokeStyle='#b5ffdf';ctx.beginPath();ctx.arc(p[0],p[1],6,0,Math.PI*2);ctx.stroke();}
    }
    const target=snapshot.targetIndex;
    if(Number.isInteger(target)&&snapshot.poses[target]){
      const p=project(snapshot.poses[target].body.origin);ctx.strokeStyle='#ff858c';ctx.lineWidth=1;ctx.beginPath();ctx.arc(p[0],p[1],13,0,Math.PI*2);ctx.stroke();
      ctx.font='9px ui-monospace, Consolas, monospace';ctx.fillStyle='#ffabb0';ctx.fillText('TARGET',p[0]+20,p[1]-8);
    }
    // Quiet corner brackets anchor the view without a moving HUD.
    ctx.strokeStyle='#466879';ctx.lineWidth=1;for(const [x,y,sx,sy] of [[14,40,1,1],[w-14,40,-1,1],[14,h-14,1,-1],[w-14,h-14,-1,-1]]){ctx.beginPath();ctx.moveTo(x,y+sy*12);ctx.lineTo(x,y);ctx.lineTo(x+sx*12,y);ctx.stroke();}
  }
  function show(next) {
    snapshot=next;document.getElementById('aiLearningViewEmpty').hidden=!!next?.nodes.length;
    if(!next?.nodes.length){faces=[];points=[];draw();return;}
    geometry();const key=next.nodes.map(node=>node.name+':'+node.position.join(',')).join('|');
    if(sceneKey!==key){sceneKey=key;frame();}else draw();
    const baseline=next.mode==='baseline',policy=next.mode==='training'||next.mode==='policy-eval'||next.mode==='policy-test',isolated=next.mode==='isolated'||baseline||policy;
    document.getElementById('aiLearningViewMode').textContent=next.mode==='policy-test'?(next.policyRunning?'POLICY / TESTING':'POLICY / TEST FINISHED'):policy?(next.mode==='policy-eval'?(next.policyRunning?'POLICY / EVALUATION':'POLICY / READY'):next.policyPaused?'PPO / PAUSED':next.policyRunning?'PPO / TRAINING':'PPO / READY'):baseline?(next.baselineRunning?(['pan-home','tilt-home'].includes(next.baselinePhase)?'RASTER / HOMING':'RASTER / RUNNING'):'RASTER / FINISHED'):isolated?'ISOLATED / PAUSED':'RIG PREVIEW';
    document.getElementById('aiLearningViewHint').textContent=isolated?'Actual physics pose · drag to orbit':'Configured pose · initialize for isolated physics';
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
