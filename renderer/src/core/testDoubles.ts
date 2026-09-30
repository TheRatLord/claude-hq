/**
 * Test-support: typed stand-ins for large interfaces (the DOM, three's renderer, the socket store) in `*.test.ts`.
 * Never imported by app code.
 */

/**
 * A double standing in for a big interface: only the members the code under test reads exist on it. This is the one cast
 * for doubles (the alternative, implementing the whole of `Document` / `WebGLRenderer`, is not what these tests are about).
 */
export function fake<T extends object>(double: object): T {
  return double as T;
}
