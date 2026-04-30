// ===== Build-time globals =====
//
// `IS_PROD_BUILD` is injected by webpack's DefinePlugin (see webpack.config.js)
// as a *boolean literal* — `true` for `npm run build:prod`, `false` otherwise.
// Because it's a literal, webpack's optimizer folds `if (!IS_PROD_BUILD)`
// branches before chunk-graph generation, so dynamic `import()` calls inside
// those branches don't even produce orphan chunks in `dist/`. This is what
// keeps the editor + debug code physically absent from the prod bundle.

declare const IS_PROD_BUILD: boolean;
