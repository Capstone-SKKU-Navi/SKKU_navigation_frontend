/** Render a numeric level as a UI string: positive → "{n}F", negative → "B{|n|}". */
export function formatLevel(level: number): string {
  return level >= 0 ? `${level}F` : `B${-level}`;
}
