// Fixed U bracket. Origin: top mounting pivot; spine extends toward -X.
function drawUBracketShort({ box, cylinder, label }) {
  const height = 44.2, reach = 24, depth = 20, thickness = 2;
  const color = "#9aafc1";
  box([-reach / 2, 0, 0], [reach, thickness, depth], color, false);
  box([-reach / 2, -height + thickness, 0], [reach, thickness, depth], color, false);
  box([-(reach - thickness / 2), -(height - thickness) / 2, 0], [thickness, height, depth], color, false);
  cylinder([0, 0, 0], 10, thickness, color, false);
  cylinder([0, -height + thickness, 0], 10, thickness, color, false);
  label([-reach, 12, 0]);
}
