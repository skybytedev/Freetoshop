export function pixel(target, x, y) {
  const canvas = target.canvas || target;
  const d = canvas.getContext("2d").getImageData(x, y, 1, 1).data;
  return [d[0], d[1], d[2], d[3]];
}
