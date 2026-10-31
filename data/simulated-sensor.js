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
  function buildScene({nodes,worldPoint,registry,props=[],local=false}) {
    const surfaces=[],spheres=[];
    nodes.forEach((node,index)=>{
      const hit={kind:"component",index,name:node.name,objectType:node.objectType};
      // Matches the 10 mm Target model, which deliberately has no physics collider.
      if (node.objectType === "Target") {
        spheres.push({center:worldPoint(nodes,index,[0,0,0]),radius:5,index,hit}); return;
      }
      const face=(vertices,shaft)=>surfaces.push({index,hit,...(local?{shaft:!!shaft}:{}),vertices:vertices.map(point=>worldPoint(nodes,index,point,shaft))});
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
  // Compile fixed local geometry once. Each read transforms the ray, not every mesh vertex.
  // Recreate when dimensions/topology change; articulated poses may change on every read.
  function prepareScene({nodes,registry}){
    const scene=buildScene({nodes,registry,worldPoint:(items,index,point)=>[...point],local:true}),map=new Map();
    for(const surface of scene.surfaces){
      const key=surface.index*2+(surface.shaft?1:0);let group=map.get(key);
      if(!group){group={index:surface.index,shaft:surface.shaft,hit:surface.hit,triangles:[],low:[Infinity,Infinity,Infinity],high:[-Infinity,-Infinity,-Infinity]};map.set(key,group);}
      for(const vertex of surface.vertices)for(let axis=0;axis<3;axis++){group.low[axis]=Math.min(group.low[axis],vertex[axis]);group.high[axis]=Math.max(group.high[axis],vertex[axis]);}
      const a=surface.vertices[0];for(let i=1;i+1<surface.vertices.length;i++){const b=surface.vertices[i],c=surface.vertices[i+1];group.triangles.push([...a,b[0]-a[0],b[1]-a[1],b[2]-a[2],c[0]-a[0],c[1]-a[1],c[2]-a[2]]);}
    }
    const groups=[...map.values()];
    const bounds=(origin,direction,low,high,maximum)=>{
      let near=0,far=maximum;
      for(let axis=0;axis<3;axis++){
        if(Math.abs(direction[axis])<1e-12){if(origin[axis]<low[axis]-1e-6||origin[axis]>high[axis]+1e-6)return false;}
        else{let a=(low[axis]-1e-6-origin[axis])/direction[axis],b=(high[axis]+1e-6-origin[axis])/direction[axis];if(a>b)[a,b]=[b,a];near=Math.max(near,a);far=Math.min(far,b);if(near>far)return false;}
      }return true;
    };
    return {read({index,worldPoint,limit=2000}){
      const ray=sensorRay(nodes,index,worldPoint),invalid={valid:false,distanceMm:null,hit:null,point:null};
      if(!ray||!Number.isFinite(limit)||limit<0)return {...invalid,...ray,reason:'invalid-ray'};
      let distance=ray.origin[1]<-.0001?0:ray.direction[1]<-.000001?Math.max(0,-ray.origin[1]/ray.direction[1]):Infinity,hit=Number.isFinite(distance)?{kind:'floor'}:null;
      const localRay=(nodeIndex,shaft)=>{
        const origin=worldPoint(nodes,nodeIndex,[0,0,0],shaft),axes=[0,1,2].map(axis=>subtract(worldPoint(nodes,nodeIndex,[0,1,2].map(i=>i===axis?1:0),shaft),origin));
        // Non-rigid/custom transforms use the general reference path.
        if(axes.some((axis,i)=>axes.some((other,j)=>Math.abs(dot(axis,other)-(i===j?1:0))>1e-6)))return null;
        const delta=subtract(ray.origin,origin);return {origin:axes.map(axis=>dot(delta,axis)),direction:axes.map(axis=>dot(ray.direction,axis))};
      };
      for(const group of groups){
        if(group.index===index)continue;const local=localRay(group.index,group.shaft);
        if(!local)return read({nodes,index,worldPoint,registry,limit});
        const o=local.origin,d=local.direction;if(!bounds(o,d,group.low,group.high,Math.min(distance,limit)))continue;
        for(const t of group.triangles){
          const px=d[1]*t[8]-d[2]*t[7],py=d[2]*t[6]-d[0]*t[8],pz=d[0]*t[7]-d[1]*t[6],det=t[3]*px+t[4]*py+t[5]*pz;
          if(Math.abs(det)<.000001)continue;
          const ox=o[0]-t[0],oy=o[1]-t[1],oz=o[2]-t[2],u=(ox*px+oy*py+oz*pz)/det;if(u<0||u>1)continue;
          const qx=oy*t[5]-oz*t[4],qy=oz*t[3]-ox*t[5],qz=ox*t[4]-oy*t[3],v=(d[0]*qx+d[1]*qy+d[2]*qz)/det;if(v<0||u+v>1)continue;
          const value=(t[6]*qx+t[7]*qy+t[8]*qz)/det;if(value>=0&&value<distance){distance=value;hit=group.hit;}
        }
      }
      // Meshes/floor are processed first, preserving the reference tie-breaking rule.
      for(const sphere of scene.spheres){
        if(sphere.index===index)continue;const local=localRay(sphere.index,false);if(!local)return read({nodes,index,worldPoint,registry,limit});
        const offset=subtract(sphere.center,local.origin),along=dot(offset,local.direction),squared=dot(offset,offset),a=dot(local.direction,local.direction),radiusSquared=sphere.radius*sphere.radius;
        const discriminant=along*along-a*(squared-radiusSquared);if(discriminant<0)continue;
        const value=squared<=radiusSquared?0:(along-Math.sqrt(discriminant))/a;
        if(value>=0&&value<distance-1e-6){distance=value;hit=sphere.hit;}
      }
      if(distance>limit||!hit)return {...invalid,...ray,reason:'no-hit'};
      return {valid:true,distanceMm:distance,hit,...ray,point:ray.origin.map((v,i)=>v+ray.direction[i]*distance)};
    }};
  }
  // Policy observations intentionally contain no privileged component identity.
  function observation(reading) {return {valid:reading.valid,distanceMm:reading.valid?reading.distanceMm:null};}
  scope.GhostSensor={sensorRay,buildScene,raycast,read,prepareScene,observation};
  if(typeof module!=="undefined"&&module.exports) module.exports=scope.GhostSensor;
})(globalThis);
