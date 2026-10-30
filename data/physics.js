// Browser-only Rapier adapter. Millimetre scene coordinates are converted to metres.
(function (scope) {
  const METRES_PER_UNIT = 0.001;
  let loading;
  async function load() {
    if (!loading) loading = (async () => {
      const module = await import('./lib/rapier.js');
      const RAPIER = module.default || module;
      await RAPIER.init();
      return RAPIER;
    })().catch(error => { loading = null; throw error; });
    return loading;
  }
  const vector = point => ({ x: point[0] * METRES_PER_UNIT, y: point[1] * METRES_PER_UNIT, z: point[2] * METRES_PER_UNIT });
  function quaternion(axes) {
    const [x, y, z] = axes;
    const m00 = x[0], m01 = y[0], m02 = z[0];
    const m10 = x[1], m11 = y[1], m12 = z[1];
    const m20 = x[2], m21 = y[2], m22 = z[2];
    const trace = m00 + m11 + m22;
    let q;
    if (trace > 0) {
      const s = Math.sqrt(trace + 1) * 2;
      q = { w: s / 4, x: (m21 - m12) / s, y: (m02 - m20) / s, z: (m10 - m01) / s };
    } else if (m00 > m11 && m00 > m22) {
      const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
      q = { w: (m21 - m12) / s, x: s / 4, y: (m01 + m10) / s, z: (m02 + m20) / s };
    } else if (m11 > m22) {
      const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
      q = { w: (m02 - m20) / s, x: (m01 + m10) / s, y: s / 4, z: (m12 + m21) / s };
    } else {
      const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
      q = { w: (m10 - m01) / s, x: (m02 + m20) / s, y: (m12 + m21) / s, z: s / 4 };
    }
    const length = Math.hypot(q.x, q.y, q.z, q.w);
    return { x: q.x / length, y: q.y / length, z: q.z / length, w: q.w / length };
  }
  function rotate(point, q) {
    const [x, y, z] = point;
    const tx = 2 * (q.y * z - q.z * y), ty = 2 * (q.z * x - q.x * z), tz = 2 * (q.x * y - q.y * x);
    return [x + q.w * tx + q.y * tz - q.z * ty, y + q.w * ty + q.z * tx - q.x * tz, z + q.w * tz + q.x * ty - q.y * tx];
  }
  function create(RAPIER, { fixedBaseIndex = null } = {}) {
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    world.timestep = 1 / 120;
    // Robot parts are centimetre-sized; the default metre-scale contact slop is too large.
    world.integrationParameters.normalizedAllowedLinearError = 0.00001;
    world.integrationParameters.normalizedPredictionDistance = 0.001;
    world.integrationParameters.numSolverIterations = 16;
    world.integrationParameters.maxCcdSubsteps = 4;
    world.createCollider(RAPIER.ColliderDesc.cuboid(10, 0.05, 10).setTranslation(0, -0.05, 0).setFriction(0.8).setCollisionGroups((4 << 16) | 3));
    let robot = [], signature = '', accumulator = 0, destroyed = false;
    const cubes = [];
    const colliderAssemblies = new Map();
    const collisionHooks = {
      filterContactPair(first, second) {
        // Connected robot parts may overlap at mounts. Detached assemblies must collide.
        if (colliderAssemblies.has(first) && colliderAssemblies.has(second) &&
            colliderAssemblies.get(first) === colliderAssemblies.get(second)) return null;
        return RAPIER.SolverFlags.COMPUTE_IMPULSE;
      },
      filterIntersectionPair() { return true; }
    };
    let parts = new Map(), motors = [], supports = [], guides = [], articulated = false;
    const api = {
      world,
      sync(shapes, topology) {
        if (destroyed) return;
        if (signature !== topology || robot.length !== shapes.length) {
          colliderAssemblies.clear();
          robot.forEach(entry => world.removeRigidBody(entry.body));
          robot = shapes.map(shape => {
            const body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased()
              .setTranslation(...shape.center.map(value => value * METRES_PER_UNIT)).setRotation(quaternion(shape.axes)));
            const collider = shape.kind === 'cylinder'
              ? RAPIER.ColliderDesc.cylinder(shape.height * METRES_PER_UNIT / 2, shape.radius * METRES_PER_UNIT)
              : RAPIER.ColliderDesc.cuboid(...shape.dimensions.map(value => value * METRES_PER_UNIT / 2));
            world.createCollider(collider.setFriction(0.7), body);
            return { body };
          });
          signature = topology;
        }
        robot.forEach(({ body }, index) => {
          body.setNextKinematicTranslation(vector(shapes[index].center));
          body.setNextKinematicRotation(quaternion(shapes[index].axes));
        });
      },
      syncRobot(nodes, shapes, topology) {
        if (destroyed) return;
        if (!articulated || signature !== topology) {
          colliderAssemblies.clear();
          robot.forEach(entry => world.removeRigidBody(entry.body));
          supports.forEach(body => world.removeRigidBody(body));
          supports = []; guides = [];
          robot = []; parts = new Map(); motors = []; articulated = true;
          // Weld attachments into compound rigid bodies. Fixed joints between tiny
          // brackets and heavier servos introduce solver flex that real mounts lack.
          const nodeByIndex = new Map(nodes.map(node => [node.index, node]));
          const assemblyFor = new Map(nodes.map(node => {
            let root = node;
            while (root.parent !== null) root = nodeByIndex.get(root.parent);
            return [node.index, root.index];
          }));
          const owners = new Map(), poses = new Map();
          const key = (index, side) => index + ":" + side;
          nodes.forEach(node => {
            for (const side of node.servo ? ["body", "shaft"] : ["body"]) {
              const id = key(node.index, side); owners.set(id, id); poses.set(id, node[side]);
            }
          });
          const find = id => {
            if (owners.get(id) !== id) owners.set(id, find(owners.get(id)));
            return owners.get(id);
          };
          nodes.forEach(node => {
            if (node.parent !== null) owners.set(find(key(node.index, node.fixedSide || "body")), find(key(node.parent, node.parentSide)));
          });
          const groups = new Map();
          poses.forEach((pose, id) => {
            const root = find(id);
            if (!groups.has(root)) {
              const center = vector(poses.get(root).center);
              const descriptor = fixedBaseIndex !== null && root === find(key(fixedBaseIndex, "body"))
                ? RAPIER.RigidBodyDesc.fixed() : RAPIER.RigidBodyDesc.dynamic();
              const body = world.createRigidBody(descriptor.setTranslation(center.x, center.y, center.z)
                .setLinearDamping(0.05).setAngularDamping(0.1).setCcdEnabled(true));
              groups.set(root, { body, center, shapes: 0 }); robot.push({ body });
            }
            const group = groups.get(root), center = vector(pose.center);
            parts.set(id, { body: group.body, offset: [center.x - group.center.x, center.y - group.center.y, center.z - group.center.z],
              rotation: quaternion(pose.axes), group });
          });
          // Share each component's specified mass across its collider volumes.
          // This preserves its total mass even when shapes occupy multiple bodies.
          const volumes = new Map();
          const volume = shape => shape.kind === "cylinder"
            ? Math.PI * shape.radius * shape.radius * shape.height
            : shape.dimensions.reduce((total, size) => total * size, 1);
          shapes.forEach(shape => volumes.set(shape.index, (volumes.get(shape.index) || 0) + volume(shape)));
          const masses = new Map(nodes.filter(node => Number.isFinite(node.massGrams) && node.massGrams > 0)
            .map(node => [node.index, node.massGrams / 1000]));
          shapes.forEach(shape => {
            const part = parts.get(key(shape.index, shape.shaft ? "shaft" : "body"));
            const pose = poses.get(key(shape.index, shape.shaft ? "shaft" : "body"));
            const center = vector(shape.center || rotate(shape.offset, part.rotation).map((value, axis) => value + pose.center[axis])), origin = part.group.center;
            const collider = shape.kind === "cylinder"
              ? RAPIER.ColliderDesc.cylinder(shape.height * METRES_PER_UNIT / 2, shape.radius * METRES_PER_UNIT)
              : RAPIER.ColliderDesc.cuboid(...shape.dimensions.map(value => value * METRES_PER_UNIT / 2));
            if (masses.has(shape.index)) collider.setMass(masses.get(shape.index) * volume(shape) / volumes.get(shape.index));
            else collider.setDensity(800);
            const created = world.createCollider(collider.setTranslation(center.x - origin.x, center.y - origin.y, center.z - origin.z)
              .setRotation(shape.axes ? quaternion(shape.axes) : part.rotation).setFriction(0.9)
              .setCollisionGroups((1 << 16) | 7).setActiveHooks(RAPIER.ActiveHooks.FILTER_CONTACT_PAIRS), part.body);
            colliderAssemblies.set(created.handle, assemblyFor.get(shape.index));
            part.group.shapes++;
          });
          nodes.forEach(node => {
            // Components without visible geometry (such as Null) can carry mass too.
            if (!masses.has(node.index) || volumes.has(node.index)) return;
            const part = parts.get(key(node.index, "body"));
            world.createCollider(RAPIER.ColliderDesc.ball(0.01).setSensor(true).setMass(masses.get(node.index))
              .setTranslation(...part.offset), part.body);
            part.group.shapes++;
          });
          groups.forEach(group => {
            // An isolated Null needs finite inertia, but it never pins the robot.
            if (!group.shapes) world.createCollider(RAPIER.ColliderDesc.ball(0.01).setSensor(true).setDensity(2400), group.body);
          });
          nodes.forEach(node => {
            if (!node.servo) return;
            const fixedSide = node.fixedSide || "body";
            const base = parts.get(key(node.index, fixedSide));
            const rotating = parts.get(key(node.index, fixedSide === "body" ? "shaft" : "body"));
            const pivot = vector(node.body.center);
            const anchor = group => ({ x: pivot.x - group.center.x, y: pivot.y - group.center.y, z: pivot.z - group.center.z });
            // All compound bodies start with identity rotation, so the same world
            // axis is a valid local hinge axis on both connected bodies.
            const axis = { x: node[fixedSide].axes[1][0], y: node[fixedSide].axes[1][1], z: node[fixedSide].axes[1][2] };
            const anchor1 = anchor(base.group), anchor2 = anchor(rotating.group);
            const joint = world.createImpulseJoint(RAPIER.JointData.revolute(anchor1, anchor2, axis), base.body, rotating.body, true);
            joint.setContactsEnabled(false);
            const reference = node.target * (fixedSide === "shaft" ? -1 : 1);
            motors.push({ joint, body: base.body, moving: rotating.body, index: node.index, axis, anchor1, anchor2, reference });
          });
          // Rapier's secondary generic-joint axes are a constructed local basis,
          // not the world Y/Z axes. Align each joint's PRIMARY axis explicitly.
          // Range carriers also lock rotation so their rails cannot tilt under load.
          nodes.filter(node => node.null && ["x", "y", "z"].some(axis => node.constraints?.[axis]?.enabled === true || node.rotationConstraints?.[axis] === true)).forEach(node => {
            const part = parts.get(key(node.index, "body"));
            const origin = vector(node.body.center), axes = RAPIER.JointAxesMask;
            const anchor = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(origin.x, origin.y, origin.z));
            supports.push(anchor);
            const mountPoint = { x: part.offset[0], y: part.offset[1], z: part.offset[2] };

            for (const axis of ["x", "y", "z"]) {
              const limit = node.constraints?.[axis];
              if (limit?.enabled !== true) continue;
              guides.push({ index: node.index, axis, origin: [...node.body.center], min: limit.min, max: limit.max });
              if (limit.min === limit.max) {
                const direction = { x: 0, y: 0, z: 0 }; direction[axis] = 1;
                const offset = { x: 0, y: 0, z: 0 }; offset[axis] = limit.min * METRES_PER_UNIT;
                const joint = world.createImpulseJoint(RAPIER.JointData.generic(offset, mountPoint, direction, axes.LinX), anchor, part.body, true);
                joint.setContactsEnabled(false);
              } else {
                const slider = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(origin.x, origin.y, origin.z).setGravityScale(0).lockRotations());
                world.createCollider(RAPIER.ColliderDesc.ball(0.005).setSensor(true).setDensity(20000), slider);
                supports.push(slider);
                const direction = { x: 0, y: 0, z: 0 }; direction[axis] = 1;
                const rail = world.createImpulseJoint(RAPIER.JointData.prismatic({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, direction), anchor, slider, true);
                rail.setContactsEnabled(false); rail.setLimits(limit.min * METRES_PER_UNIT, limit.max * METRES_PER_UNIT);
                const mount = world.createImpulseJoint(RAPIER.JointData.generic({ x: 0, y: 0, z: 0 }, mountPoint,
                  direction, axes.LinX), slider, part.body, true);
                mount.setContactsEnabled(false);
              }
            }
            for (const axis of ["x", "y", "z"]) {
              if (node.rotationConstraints?.[axis] !== true) continue;
              const direction = { x: 0, y: 0, z: 0 }; direction[axis] = 1;
              const joint = world.createImpulseJoint(RAPIER.JointData.generic({ x: 0, y: 0, z: 0 }, mountPoint,
                direction, axes.AngX), anchor, part.body, true);
              joint.setContactsEnabled(false);
            }
          });
          signature = topology; accumulator = 0;
        }
        motors.forEach(motor => {
          const { body, moving, index } = motor;
          const node = nodes.find(node => node.index === index);
          const powered = !!node.enabled;
          if (motor.powered !== powered) {
            // Replace the joint on power transitions. An unpowered hinge has no
            // motor at all, including no cached holding impulse or motor damping.
            world.removeImpulseJoint(motor.joint, true);
            motor.joint = world.createImpulseJoint(RAPIER.JointData.revolute(motor.anchor1, motor.anchor2, motor.axis), body, moving, true);
            motor.joint.setContactsEnabled(false);
            if (!node.continuous) {
              const sign = node.fixedSide === "shaft" ? -1 : 1;
              const limits = [node.minTarget ?? -Math.PI / 2, node.maxTarget ?? Math.PI / 2].map(value => value * sign - motor.reference);
              motor.joint.setLimits(Math.min(...limits), Math.max(...limits));
            }
            motor.joint.configureMotorModel(RAPIER.MotorModel.ForceBased);
            motor.powered = powered;
            body.wakeUp(); moving.wakeUp();
          }
          const sign = node.fixedSide === "shaft" ? -1 : 1;
          const command = node.continuous ? node.velocity * sign : node.target * sign - motor.reference;
          if (motor.command !== command) { body.wakeUp(); moving.wakeUp(); }
          motor.command = command;
          if (!powered) return;
          if (node.continuous) motor.joint.configureMotorVelocity(command, 0.2);
          else motor.joint.configureMotorPosition(command, 20, 0.2);
        });
      },
      point(index, point, shaft = false) {
        const part = !destroyed && articulated && parts.get(index + ":" + (shaft ? "shaft" : "body"));
        if (!part) return null;
        const offset = rotate(point.map(value => value * METRES_PER_UNIT), part.rotation).map((value, axis) => value + part.offset[axis]);
        const local = rotate(offset, part.body.rotation()), p = part.body.translation();
        return [local[0] + p.x, local[1] + p.y, local[2] + p.z].map(value => value / METRES_PER_UNIT);
      },
      stepFixed(count = 1) {
        if (destroyed) throw new Error("Physics world has been disposed.");
        if (!Number.isInteger(count) || count < 0 || count > 10000) throw new Error("Invalid fixed step count.");
        for (let i = 0; i < count; i++) world.step(undefined, collisionHooks);
      },
      advance(seconds) {
        if (destroyed) return;
        accumulator += Math.max(0, Math.min(seconds, 0.1));
        let steps = 0;
        while (accumulator >= world.timestep && steps < 12) {
          world.step(undefined, collisionHooks); accumulator -= world.timestep; steps++;
        }
        if (steps === 12) accumulator = 0;
      },
      dropCube(point) {
        if (destroyed) return;
        if (cubes.length >= 20) world.removeRigidBody(cubes.shift().body);
        const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic()
          .setTranslation(...point.map(value => value * METRES_PER_UNIT)).setCcdEnabled(true));
        world.createCollider(RAPIER.ColliderDesc.cuboid(0.01, 0.01, 0.01).setDensity(400).setRestitution(0.2).setFriction(0.7).setCollisionGroups((2 << 16) | 7), body);
        cubes.push({ body, size: 20 });
      },
      boxes() {
        if (destroyed) return [];
        return cubes.map(({ body, size }) => {
          const position = body.translation(), rotation = body.rotation();
          const centre = [position.x, position.y, position.z].map(value => value / METRES_PER_UNIT);
          const vertices = Array.from({ length: 8 }, (_, bits) => {
            const point = rotate([0, 1, 2].map(axis => ((bits >> axis) & 1 ? 0.5 : -0.5) * size), rotation);
            return point.map((value, axis) => value + centre[axis]);
          });
          return { vertices, color: '#e5a747' };
        });
      },
      debugLines() {
        if (destroyed) return [];
        const { vertices, colors } = world.debugRender();
        const lines = [];
        for (let i = 0; i < vertices.length; i += 6) {
          lines.push({ start: Array.from(vertices.subarray(i, i + 3), value => value / METRES_PER_UNIT),
            end: Array.from(vertices.subarray(i + 3, i + 6), value => value / METRES_PER_UNIT),
            color: 'rgb(' + Array.from(colors.subarray(i / 3 * 4, i / 3 * 4 + 3), value => Math.round(value * 255)).join(',') + ')' });
        }
        return lines;
      },
      constraintGuides() {
        return destroyed ? [] : guides.map(guide => ({ ...guide, current: api.point(guide.index, [0, 0, 0]) }));
      },
      resetRobot() { if (!destroyed) { signature = ""; accumulator = 0; } },
      clear() { if (!destroyed) { cubes.forEach(({ body }) => world.removeRigidBody(body)); cubes.length = 0; accumulator = 0; } },
      destroy() { if (!destroyed) { destroyed = true; world.free(); robot = []; parts.clear(); colliderAssemblies.clear(); motors = []; supports = []; guides = []; cubes.length = 0; } }
    };
    return api;
  }
  scope.GhostPhysics = { load, create };
})(globalThis);
