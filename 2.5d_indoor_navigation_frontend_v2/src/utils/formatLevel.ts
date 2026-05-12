/** Render a numeric level as a UI string: positive → "{n}F", negative → "B{|n|}". */
export function formatLevel(level: number): string {
  return level >= 0 ? `${level}F` : `B${-level}`;
}

/**
 * Render a numeric level the way it appears inside video filenames: above-ground
 * floors are bare numbers ("1".."5"), basements are "B1", "B2", … This is the
 * token after "_c_F" for corridor clips and after "_s_{id}_" / "_e_{id}_" for
 * stair/elevator clips. Inverse of {@link parseFloorToken}.
 */
export function floorFilenameToken(level: number): string {
  return level >= 0 ? String(level) : `B${-level}`;
}

/**
 * Parse a video-filename floor token ("3", "B1", or the legacy signed "-1")
 * into a numeric level — basements come back negative. Returns null when the
 * token isn't a recognised floor.
 */
export function parseFloorToken(token: string): number | null {
  const basement = /^[Bb](\d+)$/.exec(token);
  if (basement) return -Number(basement[1]);
  return /^-?\d+$/.test(token) ? Number(token) : null;
}
