function arrayRange(start: number, stop: number, step: number): number[] {
  return Array.from({ length: (stop - start) / step + 1 }, (_, i) => start + i * step);
}

export function extractLevels(level: string): number[] {
  level = level.trim();
  if (level === '') return [];

  const regExRange = /(-?\d+)-(-?\d+)/;

  if (level.includes(';')) {
    return level.split(';').flatMap(val => extractLevels(val));
  } else if (regExRange.test(level)) {
    const m = regExRange.exec(level)!;
    return arrayRange(parseInt(m[1]), parseInt(m[2]), 1);
  } else if (!isNaN(parseFloat(level))) {
    return [parseFloat(level)];
  }

  return [];
}
