// The server-side allowlist for the per-reel B-roll frequency label.
//
// The Studio sends a human label ("Minimal" | "Standard" | "High"); the server
// resolves it — vendor/behaviour detail never travels as an opaque value from
// the browser. It lives here rather than in generate-broll-plan/route.ts because
// createJob has to write the label at REEL CREATION (the column default used to
// read 'Standard' until the broll_plan stage completed, so every read before
// then showed a value nobody chose), and lib code cannot import from a route.
//
// An unrecognised label is UI drift, not an attack: it normalises to the default
// rather than 400-ing, matching how generate-broll-plan already tolerates one
// (an unknown key simply selects no frequency guidance line).

export const BROLL_FREQUENCIES = ['Minimal', 'Standard', 'High'] as const;

export type BrollFrequency = (typeof BROLL_FREQUENCIES)[number];

/** What a reel gets when the user expressed no preference. Matches the column default. */
export const DEFAULT_BROLL_FREQUENCY: BrollFrequency = 'Standard';

export function normalizeBrollFrequency(value: unknown): BrollFrequency {
  return typeof value === 'string' && (BROLL_FREQUENCIES as readonly string[]).includes(value)
    ? (value as BrollFrequency)
    : DEFAULT_BROLL_FREQUENCY;
}
