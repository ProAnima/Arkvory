export function inspectCompilerOptions(options, label, pure = false) {
  const errors = [];
  for (const flag of [
    'strict',
    'noUncheckedIndexedAccess',
    'exactOptionalPropertyTypes',
    'noImplicitOverride',
    'noImplicitReturns',
    'noFallthroughCasesInSwitch',
    'noUnusedLocals',
    'noUnusedParameters',
    'noPropertyAccessFromIndexSignature',
    'noEmitOnError',
    'forceConsistentCasingInFileNames',
    'verbatimModuleSyntax',
    'isolatedModules',
  ])
    if (options?.[flag] !== true) errors.push(`${label}: ${flag} must remain enabled`);
  // strict=true can still be weakened by an explicitly disabled child option.
  for (const flag of [
    'noImplicitAny',
    'noImplicitThis',
    'strictNullChecks',
    'strictFunctionTypes',
    'strictBindCallApply',
    'strictPropertyInitialization',
    'strictBuiltinIteratorReturn',
    'alwaysStrict',
    'useUnknownInCatchVariables',
  ])
    if (options?.[flag] === false) errors.push(`${label}: ${flag} cannot override strict mode`);
  if (options?.skipLibCheck !== false) errors.push(`${label}: skipLibCheck must remain false`);
  if (options?.noCheck || options?.allowJs)
    errors.push(`${label}: noCheck/allowJs cannot bypass TypeScript`);
  if (
    pure &&
    (!Array.isArray(options?.types) ||
      options.types.length ||
      options?.lib?.some((lib) => !/^lib\.es.*\.d\.ts$/.test(lib)))
  )
    errors.push(`${label}: pure layers must not acquire Node/browser ambient globals`);
  return errors;
}
