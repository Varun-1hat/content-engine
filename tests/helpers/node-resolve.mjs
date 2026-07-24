// Module-resolution hook for the acceptance suite. NOT a test file — it is
// registered by tests/release-closeout.acceptance.test.ts before that file
// imports any product module, and it must not be listed in package.json's test
// script (it contains no tests).
//
// Why it exists: the app is compiled by Next/tsc, which resolves extensionless
// relative specifiers and Next's own subpath entry points. Plain `node
// --experimental-strip-types` does neither, so `src/lib/jobs.ts` (the module
// that owns the PATCH allowlist, criterion 44) and `src/lib/auth.ts` (the
// tenancy guard, criterion 43) are unimportable from the lean suite without
// this. Nothing is stubbed, mocked or replaced: the REAL product modules are
// loaded, only their specifiers are resolved the way the app's build resolves
// them.
//
//   * `next/server` / `next/headers` -> the `.js` file the package actually
//     ships (the `next` package publishes no `exports` map, so bare ESM
//     resolution cannot find them);
//   * `./foo` -> `./foo.ts` when that is the file that exists.

export async function resolve(specifier, context, nextResolve) {
  // Next's subpath entry points ship as plain .js beside the package root.
  if (/^next\/[^/.]+$/.test(specifier)) {
    try {
      return await nextResolve(`${specifier}.js`, context);
    } catch {
      // fall through to the default resolver's own error
    }
  }

  // Extensionless relative import inside src/ — the app tsconfig adds the .ts.
  if (specifier.startsWith('.') && !/\.[mc]?[jt]sx?$/.test(specifier)) {
    try {
      return await nextResolve(`${specifier}.ts`, context);
    } catch {
      // fall through: it may genuinely be a .js/.json/directory specifier
    }
  }

  return nextResolve(specifier, context);
}
