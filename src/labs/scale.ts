/**
 * How a mass becomes a radius.
 *
 * The cube root is the constant-density rule for spheres, which is how we
 * intuit a heavier ball: twice the mass is a little over a quarter wider, not
 * twice as wide. A strictly two-dimensional disc would want a square root, but
 * across the mass range these labs offer -- fifty to one from lightest to
 * heaviest -- that produces a seven-fold spread of radii that will not fit in
 * the box alongside anything else.
 */
export function radiusForMass(mass: number, unit = 0.11): number {
  return unit * Math.cbrt(Math.max(mass, 1e-6));
}
