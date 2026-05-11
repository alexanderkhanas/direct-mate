import * as fs from 'fs';

/**
 * Locks the WASM-pinning path used by `ImageEmbeddingService`.
 *
 * Background: `@xenova/transformers@2.17.2` exposes an internal
 * `executionProviders` array at `src/backends/onnx.js` that
 * `models.js` imports and passes directly to
 * `InferenceSession.create()`. Mutating this array in place is the
 * ONLY supported way to force the WASM execution provider — writing
 * to `env.backends.onnx.executionProviders` is a no-op (that path
 * targets ORT's runtime env, not the session-construction array).
 *
 * What this spec catches:
 *  1. The subpath `@xenova/transformers/src/backends/onnx.js` no
 *     longer resolves (package restructured / renamed / replaced).
 *  2. The named export `executionProviders` is gone or no longer
 *     declared as a mutable array (internal refactor).
 *  3. The `executionProviders.unshift('cpu')` line that drives the
 *     CPU-segfault in Node is still there to be overridden (its
 *     removal would mean the default no longer needs forcing — at
 *     which point this spec must be revisited).
 *
 * Why a static-text check and not a runtime import: Jest's VM
 * sandbox refuses dynamic `import()` of ESM modules without
 * `--experimental-vm-modules`. Configuring the whole test runner
 * for one spec is more invasive than checking the contract by
 * resolving the file path + grepping its exports. The production
 * service still does the runtime mutation; this spec locks the
 * dep's source contract that mutation depends on.
 *
 * If `@xenova/transformers` is ever upgraded to a major that
 * reshapes its internals (or migrated to
 * `@huggingface/transformers`), these assertions fail loudly and
 * the production EP-pinning must be revisited at the same time.
 */
describe('ImageEmbeddingService — WASM execution provider contract', () => {
  let onnxSrcPath: string;
  let onnxSrc: string;

  beforeAll(() => {
    onnxSrcPath = require.resolve(
      '@xenova/transformers/src/backends/onnx.js',
    );
    onnxSrc = fs.readFileSync(onnxSrcPath, 'utf-8');
  });

  it('the internal onnx backend module resolves at the expected subpath', () => {
    expect(onnxSrcPath).toMatch(
      /@xenova\/transformers\/src\/backends\/onnx\.js$/,
    );
  });

  it('exports a mutable `executionProviders` array (named export, `const`)', () => {
    // The const-array idiom is what lets us mutate the contents in
    // place from the consumer. If the dep ever reshapes this to
    // `export const executionProviders = Object.freeze([...])` or
    // moves it inside a function scope, our service mutation breaks
    // silently and prod resurfaces the CPU-segfault.
    expect(onnxSrc).toMatch(/export\s+const\s+executionProviders\s*=\s*\[/);
  });

  it('still unshifts `cpu` in Node — meaning the default needs forcing', () => {
    // This is the line that puts CPU first in Node. If it's gone,
    // either the default already prefers WASM (good — but our
    // service still pins, so behavior is equivalent) or the
    // mechanism changed (bad — service mutation may no longer
    // apply). Either way, this assertion failing is a signal to
    // re-read the dep's onnx.js and confirm pinning still works.
    expect(onnxSrc).toMatch(/executionProviders\.unshift\(['"]cpu['"]\)/);
  });
});
