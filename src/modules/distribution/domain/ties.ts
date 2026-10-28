/** Orders closer than this in score are a tie the AI may reorder (contract 4.7). */
export const TIE_SCORE_DELTA = 2;

/**
 * Groups of entries whose score is within TIE_SCORE_DELTA of the previous one
 * (best score first). Only groups of two or more are returned. Equal scores
 * keep the input order, so the result is deterministic. Same rule as
 * alimentos-ai, so both sides agree on which orders are tied.
 */
export function findTieGroups<K>(entries: readonly { key: K; score: number }[]): K[][] {
  const sorted = [...entries].sort((a, b) => b.score - a.score);
  const groups: K[][] = [];
  let current: { key: K; score: number }[] = [];
  for (const entry of sorted) {
    const previous = current.at(-1);
    if (previous && previous.score - entry.score < TIE_SCORE_DELTA) {
      current.push(entry);
      continue;
    }
    if (current.length > 1) groups.push(current.map((e) => e.key));
    current = [entry];
  }
  if (current.length > 1) groups.push(current.map((e) => e.key));
  return groups;
}
