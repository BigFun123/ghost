// Perspective scene camera. Clip polygons before projection and use reciprocal
// depth so the existing software depth buffer resolves occlusion correctly.
function componentCameraFaces(camera, { index, nodes, surfaces, worldPoint }, width, height) {
  const origin = worldPoint(nodes, index, camera.origin);
  const axes = [0, 1, 2].map(axis => {
    const end = worldPoint(nodes, index, camera.origin.map((value, i) => value + (i === axis ? 1 : 0)));
    const vector = end.map((value, i) => value - origin[i]);
    const length = Math.hypot(...vector);
    return vector.map(value => value / length);
  });
  const focal = height / (2 * Math.tan(camera.verticalFov * Math.PI / 360));
  const faces = [];
  surfaces.filter(surface => surface.index !== index).forEach(surface => {
    let polygon = surface.vertices.map(vertex => axes.map(axis =>
      axis.reduce((sum, value, i) => sum + value * (vertex[i] - origin[i]), 0)));
    // Near and four side planes bound projected coordinates, even at the lens.
    for (const distance of [p => p[2] - camera.near,
      p => p[2] * width / (2 * focal) + p[0], p => p[2] * width / (2 * focal) - p[0],
      p => p[2] * height / (2 * focal) + p[1], p => p[2] * height / (2 * focal) - p[1]]) {
      const clipped = [];
      polygon.forEach((a, i) => {
        const b = polygon[(i + 1) % polygon.length], da = distance(a), db = distance(b);
        if (da >= 0) clipped.push(a);
        if ((da >= 0) !== (db >= 0)) clipped.push(a.map((value, axis) => value + (b[axis] - value) * da / (da - db)));
      });
      polygon = clipped;
    }
    if (polygon.length >= 3) faces.push({ color: surface.color ?? "#778a9b", outline: false,
      points: polygon.map(p => [width / 2 + focal * p[0] / p[2], height / 2 - focal * p[1] / p[2], 1 / p[2]]) });
  });
  return faces;
}

function renderComponentCamera(canvas, camera, scene) {
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#0d1822"; ctx.fillRect(0, 0, canvas.width, canvas.height);
  const floor = { index: null, color: "#253c38", vertices: [[-5000, 0, -5000], [5000, 0, -5000], [5000, 0, 5000], [-5000, 0, 5000]] };
  const faces = componentCameraFaces(camera, { ...scene, surfaces: [...scene.surfaces, floor] }, canvas.width, canvas.height);
  renderPreviewFaces(ctx, faces, canvas.width, canvas.height, 1);
}
