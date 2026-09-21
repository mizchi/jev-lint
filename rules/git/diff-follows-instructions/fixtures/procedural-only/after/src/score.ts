export function clampScore(score: number): number {
  if (score > 100) return 100;
  if (score < 0) return 0;
  return score;
}
