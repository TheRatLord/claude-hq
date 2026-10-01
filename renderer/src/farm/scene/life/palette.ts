/** Critter colour variants (instance tints: [tint, tint2] or a single tint). */
type C3 = [number, number, number];
const T = (a: C3, b: C3): [C3, C3] => [a, b];

/** butterflies: fore-wing tint, hind-wing tint */
export const BUTTERFLIES: Record<string, [C3, C3]> = {
  lemon: T([1, 0.86, 0.3], [1, 0.92, 0.5]),
  cabbage: T([1, 1, 0.97], [0.95, 0.97, 0.9]),
  monarch: T([1, 0.55, 0.2], [1, 0.62, 0.25]),
  blue: T([0.5, 0.7, 1], [0.62, 0.8, 1]),
  pink: T([1, 0.64, 0.8], [1, 0.8, 0.9]),
  green: T([0.72, 0.92, 0.5], [0.85, 0.97, 0.6]),
};
export const DRAGONS: Record<string, [C3, C3]> = {
  teal: T([0.3, 0.85, 0.8], [1, 1, 1]),
  blue: T([0.35, 0.55, 1], [1, 1, 1]),
  red: T([0.95, 0.38, 0.28], [1, 1, 1]),
};
/** fish: body, fins */
export const FISH: Record<string, [C3, C3]> = {
  koi: T([1, 0.55, 0.25], [1, 0.8, 0.6]),
  koiWhite: T([1, 0.97, 0.93], [1, 0.62, 0.4]),
  trout: T([0.72, 0.8, 0.78], [0.85, 0.7, 0.72]),
  perch: T([0.66, 0.76, 0.48], [1, 0.6, 0.35]),
};
export const RABBITS: Record<string, C3> = {
  brown: [0.8, 0.62, 0.46], grey: [0.74, 0.72, 0.7], cream: [0.97, 0.93, 0.85], dark: [0.62, 0.48, 0.37], sand: [0.88, 0.77, 0.62],
};
