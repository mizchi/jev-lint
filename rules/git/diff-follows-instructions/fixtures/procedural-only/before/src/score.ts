export function clampScore(score: number): number {
  if (score > 100) return 100;
  return score;
}
