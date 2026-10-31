const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');
test('large 16-world scenes fit without spread-argument overflow or mutating physics snapshots',()=>{
 const labels=[],elements=new Map();let rendered=0,meshBuilds=0;
 const ctx=new Proxy({createRadialGradient:()=>({addColorStop(){}}),fillText:text=>labels.push(text)},{get:(target,key)=>target[key]??(()=>{})});
 const canvas={clientWidth:800,clientHeight:500,getContext:()=>ctx,addEventListener(){}};
 elements.set('aiWeightSurface',null);
 elements.set('aiLearningScene',canvas);elements.set('aiLearningPanel',{hidden:false});
 const context={document:{getElementById(id){if(!elements.has(id))elements.set(id,{addEventListener(){}});return elements.get(id);}},componentRegistry:{draw(node,paint){meshBuilds++;if(node.objectType==='Servo')for(let i=0;i<512;i++)paint.box([0,i*.01,0],[20,20,20],'#7895a8',false);else paint.cylinder([0,0,0],5,10,'#ff0000',false);}},renderPreviewFaces(ctx,faces){rendered=faces.length;},ResizeObserver:class{observe(){}}};
 vm.createContext(context);vm.runInContext(fs.readFileSync('data/ai-view.js','utf8'),context);
 const pose=()=>({body:{origin:[0,0,0],axes:[[1,0,0],[0,1,0],[0,0,1]]},shaft:{origin:[0,0,0],axes:[[1,0,0],[0,1,0],[0,0,1]]}});
 const single={nodes:[{name:'Servo',objectType:'Servo',position:[0,0,0]},{name:'Target',objectType:'Target',position:[0,0,20]}],poses:[pose(),pose()],targetIndex:1},before=JSON.stringify(single);
 assert.doesNotThrow(()=>context.GhostLearningView.show({...single,replicas:Array(16).fill(single),mode:'training',policyRunning:true}));
 assert.equal(JSON.stringify(single),before);assert(rendered>49000);assert.equal(labels.filter(label=>/^E\d\d$/.test(label)).length,16);assert.match(elements.get('aiLearningViewMode').textContent,/16 WORLDS/);assert.equal(meshBuilds,1,'identical robot geometry is compiled once');
 const moved=JSON.parse(before);moved.poses[0].body.origin[0]=10;context.GhostLearningView.show({...moved,replicas:Array(16).fill(moved),mode:'training',policyRunning:true});assert.equal(meshBuilds,1,'pose updates reuse local mesh geometry');
 for(const count of [64,256]){assert.doesNotThrow(()=>context.GhostLearningView.show({...single,replicas:Array(count).fill(single),mode:'training',policyRunning:true}));assert.equal(rendered,count*(6+8),'large grids collapse robot geometry to bounds');assert.match(elements.get('aiLearningViewMode').textContent,new RegExp(count+' WORLDS'));}
});
