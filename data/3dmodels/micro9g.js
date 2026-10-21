// Micro servo; local origin is the shaft pivot near the case end.
function drawMicro9g({ box, cylinder, label, color }) {
  box([6, -12, 0], [23, 20, 12], color, false);
  cylinder([0, -1, 0], 3, 6, "#d4b66d", true);
  box([9, 3, 0], [24, 3, 6], "#dce4eb", true);
  label([0, 18, 0]);
}
