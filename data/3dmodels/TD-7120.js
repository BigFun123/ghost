// Standard servo; local origin is the metal shaft pivot near the case end.
function drawTD7120({ box, cylinder, label, color }) {
  box([12, -20, 0], [40, 40, 20], color, false);
  cylinder([0, 1, 0], 4, 6, "#d4b66d", true);
  cylinder([0, 3, 0], 9, 3, "#dce4eb", true);
  cylinder([0, -43, 0], 9, 3, "#dce4eb", true);
  // Coaxial plastic support nub on the opposite face.
  cylinder([0, -42, 0], 4, 4, "#202a33", false);
  label([0, 18, 0]);
}
