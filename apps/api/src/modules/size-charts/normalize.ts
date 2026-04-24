export const lowerTrim = (s: string): string => s.trim().toLowerCase();

export const lowerTrimArray = (arr: string[] | undefined | null): string[] =>
  (arr ?? []).map(lowerTrim).filter((s) => s.length > 0);
