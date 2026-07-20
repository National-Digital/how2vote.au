/** Minimal argv parsing for the bin entrypoints (positional + --flags, no dependency). */
export function parseCliArgs(
  argv: string[],
  valueFlags: string[] = [],
): { positionals: string[]; flags: Set<string>; values: Record<string, string> } {
  const positionals: string[] = [];
  const flags = new Set<string>();
  const values: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (!arg.startsWith("--")) {
      positionals.push(arg);
    } else if (valueFlags.includes(arg)) {
      const value = argv[++i];
      if (value === undefined) throw new Error(`${arg} requires a value`);
      values[arg] = value;
    } else {
      flags.add(arg);
    }
  }
  return { positionals, flags, values };
}
