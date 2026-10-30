// DOM-free centre-ray sensor model. Scene coordinates and returned ranges are mm.
(function (scope) {
  const subtract = (a,b) => a.map((value,i)=>value-b[i]);
  const dot = (a,b) => a.reduce((sum,value,i)=>sum+value*b[i],0);
  const cross = (a,b) => [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
  const finiteVector = vector => Array.isArray(vector) && vector.length === 3 && vector.every(Number.isFinite);
  function sensorRay(nodes,index,worldPoint) {
    const origin=worldPoint(nodes,index,[0,2,3.1]);
    const forward=worldPoint(nodes,index,[0,2,4.1]);
    if (!finiteVector(origin) || !finiteVector(forward)) return null;
    const vector=subtract(forward,origin),length=Math.hypot(...vector);
    return length > 1e-9 ? {origin,direction:vector.map(value=>value/length)} : null;
  }
  function buildScene({nodes,worldPoint,registry,props=[]}) {
    const surfaces=[],spheres=[];
    nodes.forEach((node,index)=>{
      const hit={kind:"component",index,name:node.name,objectType:node.objectType};
      // Matches the 10 mm Target model, which deliberately has no physics collider.
      if (node.objectType === "Target") {
        spheres.push({center:worldPoint(nodes,index,[0,0,0]),radius:5,index,hit}); return;
      }
      const face=(vertices,shaft)=>surfaces.push({index,hit,vertices:vertices.map(point=>worldPoint(nodes,index,point,shaft))});
      registry.draw(node,{purpose:"sensing",color:"#888",label(){},
        box(offset,size,color,shaft) {
          const vertices=Array.from({length:8},(_,bits)=>offset.map((value,axis)=>value+((bits>>axis&1)-0.5)*size[axis]));
          for (const indices of [[0,1,3,2],[4,5,7,6],[0,1,5,4],[2,3,7,6],[0,2,6,4],[1,3,7,5]]) face(indices.map(i=>vertices[i]),shaft);
        },
        cylinder(offset,radius,height,color,shaft) {
          const rings=[-1,1].map(sign=>Array.from({length:24},(_,i)=>[offset[0]+radius*Math.cos(i*Math.PI/12),offset[1]+sign*height/2,offset[2]+radius*Math.sin(i*Math.PI/12)]));
          rings.forEach(ring=>face(ring,shaft));
          for(let i=0;i<24;i++){const next=(i+1)%24;face([rings[0][i],rings[0][next],rings[1][next],rings[1][i]],shaft);}
        }
      });
    });
    props.forEach(({vertices},index)=>{
      for (const indices of [[0,1,3,2],[4,5,7,6],[0,1,5,4],[2,3,7,6],[0,2,6,4],[1,3,7,5]]) surfaces.push({index:null,hit:{kind:"prop",index},vertices:indices.map(i=>vertices[i])});
    });
    return {surfaces,spheres};
  }
  function raycast({origin,direction,surfaces=[],spheres=[],sensorIndex,limit=2000}) {
    const invalid={valid:false,distanceMm:null,hit:null,point:null};
    if (!finiteVector(origin) || !finiteVector(direction) || !Number.isFinite(limit) || limit<0) return {...invalid,reason:"invalid-ray"};
    const length=Math.hypot(...direction);
    if(length<1e-9) return {...invalid,reason:"invalid-ray"};
    direction=direction.map(value=>value/length);
    let distance=origin[1]<-0.0001 ? 0 : direction[1]<-0.000001 ? Math.max(0,-origin[1]/direction[1]) : Infinity;
    let hit=Number.isFinite(distance)?{kind:"floor"}:null;
    for(const surface of surfaces) {
      if(sensorIndex !== undefined && surface.index===sensorIndex) continue;
      const vertices=surface.vertices;
      for(let i=1;i+1<vertices.length;i++) {
        const edge1=subtract(vertices[i],vertices[0]),edge2=subtract(vertices[i+1],vertices[0]);
        const p=cross(direction,edge2),determinant=dot(edge1,p);
        if(Math.abs(determinant)<0.000001) continue;
        const offset=subtract(origin,vertices[0]),u=dot(offset,p)/determinant;
        if(u<0||u>1) continue;
        const q=cross(offset,edge1),v=dot(direction,q)/determinant;
        if(v<0||u+v>1) continue;
        const value=dot(edge2,q)/determinant;
        if(value>=0&&value<distance) {distance=value;hit=surface.hit??{kind:surface.index==null?"prop":"component",index:surface.index};}
      }
    }
    for(const sphere of spheres) {
      if(sensorIndex !== undefined && sphere.index===sensorIndex) continue;
      const offset=subtract(sphere.center,origin),along=dot(offset,direction),squared=dot(offset,offset),radiusSquared=sphere.radius*sphere.radius;
      const discriminant=radiusSquared-Math.max(0,squared-along*along);
      if(discriminant<0) continue;
      const value=squared<=radiusSquared?0:along-Math.sqrt(discriminant);
      // Prefer a blocking surface/floor at a tie so it cannot count as target acquisition.
      if(value>=0&&value<distance-1e-6) {distance=value;hit=sphere.hit??{kind:"component",index:sphere.index};}
    }
    if(distance>limit||!hit) return {...invalid,reason:"no-hit"};
    return {valid:true,distanceMm:distance,hit,origin:[...origin],direction,point:origin.map((value,i)=>value+direction[i]*distance)};
  }
  function read({nodes,index,worldPoint,scene,registry,props,limit=2000}) {
    const ray=sensorRay(nodes,index,worldPoint);
    if(!ray) return {valid:false,distanceMm:null,hit:null,point:null,reason:"invalid-ray"};
    const result=raycast({...ray,...(scene??buildScene({nodes,worldPoint,registry,props})),sensorIndex:index,limit});
    return {...result,...ray};
  }
  // Policy observations intentionally contain no privileged component identity.
  function observation(reading) {return {valid:reading.valid,distanceMm:reading.valid?reading.distanceMm:null};}
  scope.GhostSensor={sensorRay,buildScene,raycast,read,observation};
  if(typeof module!=="undefined"&&module.exports) module.exports=scope.GhostSensor;
})(globalThis);
