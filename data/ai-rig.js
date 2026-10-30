// Shared DOM-free mounting/geometry math for the preview and training worker.
(function(scope){
  function rotatePoint(point, rotation) {
    let [x, y, z] = point;
    const [a, b, c] = rotation.map(degrees => degrees * Math.PI / 180);
    [y, z] = [y * Math.cos(a) - z * Math.sin(a), y * Math.sin(a) + z * Math.cos(a)];
    [x, z] = [x * Math.cos(b) + z * Math.sin(b), -x * Math.sin(b) + z * Math.cos(b)];
    return [x * Math.cos(c) - y * Math.sin(c), x * Math.sin(c) + y * Math.cos(c), z];
  }

  const cache=new WeakMap();
  function forRegistry(registry){
    if(cache.has(registry))return cache.get(registry);
    function worldPoint(nodes, index, point, shaft = false) {
      const node = nodes[index];
      point = rotatePoint(point, registry.localPoseRotation(nodes, index, shaft));
      point = rotatePoint(point, registry.placementRotation(nodes, index, shaft)).map((value, axis) => value + node.position[axis]);
      if (node.parent === null) return point;
      const { parentSide } = registry.attachment(nodes, index);
      point = registry.childMountPoint(nodes[node.parent - 1], point);
      return worldPoint(nodes, node.parent - 1, point, parentSide === "shaft");
    }

    function physicsShapes(nodes) {
      const shapes = [];
      nodes.forEach((node, index) => {
        if (!registry.getPhysics(node).real) return;
        const add = (kind, offset, dimensions, shaft, radius, height) => {
          const origin = worldPoint(nodes, index, [0, 0, 0], shaft);
          const axes = [0, 1, 2].map(axis => worldPoint(nodes, index,
            [0, 1, 2].map(i => i === axis ? 1 : 0), shaft).map((value, i) => value - origin[i]));
          shapes.push({ kind, index, shaft: !!shaft, offset: [...offset], center: worldPoint(nodes, index, offset, shaft), axes, dimensions, radius, height });
        };
        registry.draw(node, { purpose: "physics", box: (offset, dimensions, color, shaft) => add("box", offset, dimensions, shaft),
          cylinder: (offset, radius, height, color, shaft) => add("cylinder", offset, null, shaft, radius, height),
          color: "#269f89", label() {} });
      });
      return shapes;
    }

    function physicsNodes(nodes) {
      return nodes.map((node, index) => {
        const pose = shaft => {
          const center = worldPoint(nodes, index, [0, 0, 0], shaft);
          const axes = [0, 1, 2].map(axis => worldPoint(nodes, index,
            [0, 1, 2].map(i => i === axis ? 1 : 0), shaft).map((value, i) => value - center[i]));
          return { center, axes };
        };
        const { fixedSide } = registry.attachment(nodes, index);
        let { parentSide } = registry.attachment(nodes, index);
        let parent = node.parent === null ? null : node.parent - 1;
        // Visual grouping nodes contribute no body, collider or mass. Weld through
        // them to the nearest physical ancestor, retaining its attachment side.
        while (parent !== null && !registry.getPhysics(nodes[parent]).real) {
          parentSide = registry.attachment(nodes, parent).parentSide;
          const ancestor = nodes[parent].parent;
          parent = ancestor === null ? null : ancestor - 1;
        }
        return { index, parent, parentSide,
          ...registry.getPhysics(node), servo: registry.hasCapability(node, "actuator"), null: registry.hasCapability(node, "constraints"), fixedSide,
          constraints: registry.hasCapability(node, "constraints") ? node.constraints : undefined,
          rotationConstraints: registry.hasCapability(node, "constraints") ? node.rotationConstraints : undefined,
          body: pose(false), shaft: pose(true), target: (node.angle - 90) * Math.PI / 180,
          continuous: node.continuous, velocity: (node.angle - 90) / 90 * 2 * Math.PI,
          enabled: node.outputEnabled && node.enabled };
      }).filter(node => node.real);
    }

    const rig={rotatePoint,worldPoint,physicsNodes,physicsShapes};cache.set(registry,rig);return rig;
  }
  scope.GhostRig={rotatePoint,forRegistry};
  if(typeof module!=='undefined'&&module.exports)module.exports=scope.GhostRig;
})(globalThis);
