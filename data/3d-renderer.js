// Software depth buffer. Greater projected depth is nearer the viewer.
// Faces must be convex; boxes and cylinder caps/sides meet that requirement.
const previewDepthBuffers = new WeakMap();

function renderPreviewFaces(ctx, faces, width, height, ratio) {
  let depth = previewDepthBuffers.get(ctx);
  if (!depth || depth.length !== width * height) {
    depth = new Float32Array(width * height);
    previewDepthBuffers.set(ctx, depth);
  }
  depth.fill(-Infinity);
  const image = ctx.getImageData(0, 0, width, height);
  const pixels = image.data;
  const screenFaces = faces.map(face => ({ ...face,
    points: face.points.map(p => [p[0] * ratio, p[1] * ratio, p[2]]) }));
  const edge = (a, b, x, y) => (b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]);
  const write = (index, color) => {
    const offset = index * 4;
    pixels[offset] = color[0]; pixels[offset + 1] = color[1]; pixels[offset + 2] = color[2]; pixels[offset + 3] = 255;
  };
  function triangle(a, b, c, color) {
    const area = edge(a, b, c[0], c[1]);
    if (Math.abs(area) < 1e-8) return;
    const minX = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0])));
    const maxX = Math.min(width - 1, Math.ceil(Math.max(a[0], b[0], c[0])));
    const minY = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1])));
    const maxY = Math.min(height - 1, Math.ceil(Math.max(a[1], b[1], c[1])));
    for (let y = minY; y <= maxY; ++y) {
      for (let x = minX; x <= maxX; ++x) {
        const u = edge(b, c, x + 0.5, y + 0.5) / area;
        const v = edge(c, a, x + 0.5, y + 0.5) / area;
        const w = 1 - u - v;
        if (u < -1e-8 || v < -1e-8 || w < -1e-8) continue;
        const z = u * a[2] + v * b[2] + w * c[2];
        const index = y * width + x;
        if (z <= depth[index]) continue;
        depth[index] = z;
        write(index, color);
      }
    }
  }
  screenFaces.forEach(face => {
    const hex = face.color.slice(1);
    const color = [0, 2, 4].map(offset => parseInt(hex.slice(offset, offset + 2), 16));
    for (let i = 1; i + 1 < face.points.length; ++i) {
      triangle(face.points[0], face.points[i], face.points[i + 1], color);
    }
  });
  // Draw only visible polygon edges. Hidden edges cannot show through other parts.
  screenFaces.forEach(face => {
    let slopeX = 0, slopeY = 0;
    const faceA = face.points[0];
    for (let j = 1; j + 1 < face.points.length; ++j) {
      const faceB = face.points[j], faceC = face.points[j + 1];
      const area = edge(faceA, faceB, faceC[0], faceC[1]);
      if (Math.abs(area) < 1e-8) continue;
      slopeX = ((faceB[2] - faceA[2]) * (faceC[1] - faceA[1]) - (faceC[2] - faceA[2]) * (faceB[1] - faceA[1])) / area;
      slopeY = ((faceB[0] - faceA[0]) * (faceC[2] - faceA[2]) - (faceC[0] - faceA[0]) * (faceB[2] - faceA[2])) / area;
      break;
    }
    face.points.forEach((a, i) => {
      const b = face.points[(i + 1) % face.points.length];
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) * 2));
      // Clip the sampling range to the viewport, including very large zoomed faces.
      let from = 0, to = 1;
      for (const [origin, delta, limit] of [[a[0], dx, width], [a[1], dy, height]]) {
        if (delta === 0) {
          if (origin < 0 || origin >= limit) return;
        } else {
          const first = -origin / delta, last = (limit - origin) / delta;
          from = Math.max(from, Math.min(first, last));
          to = Math.min(to, Math.max(first, last));
        }
      }
      for (let step = Math.max(0, Math.ceil(from * steps)); step <= Math.min(steps, Math.floor(to * steps)); ++step) {
        const t = step / steps, x = Math.floor(a[0] + dx * t), y = Math.floor(a[1] + dy * t);
        if (x < 0 || y < 0 || x >= width || y >= height) continue;
        const index = y * width + x, z = a[2] + (b[2] - a[2]) * t;
        // Compare both surfaces at the same pixel centre on this face's plane.
        const pixelZ = z + slopeX * (x + 0.5 - a[0] - dx * t) + slopeY * (y + 0.5 - a[1] - dy * t);
        if (pixelZ + 0.05 < depth[index]) continue;
        if (face.selected) write(index, [255, 224, 138]);
        else {
          const offset = index * 4, alpha = 0.53;
          write(index, [9, 18, 27].map((value, channel) => value * alpha + pixels[offset + channel] * (1 - alpha)));
        }
      }
    });
  });
  ctx.putImageData(image, 0, 0);
}
