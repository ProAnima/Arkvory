/**
 * The search's words: what Unicode calls a word in each script, so Chinese and
 * Japanese — no spaces between words — are found by a word, not only by a whole
 * sentence; and a name such as `http_burst_start` by each of its parts too.
 * The index is written with it (config.mts) and the search box reads queries
 * with it (theme/index.ts): both must cut words the same way.
 */
const segmenter =
  typeof Intl !== 'undefined' && 'Segmenter' in Intl
    ? new Intl.Segmenter(undefined, { granularity: 'word' })
    : null;

/** MiniSearch's own rule, where the platform has no `Intl.Segmenter`. */
const SPACE_OR_PUNCTUATION = /[\n\r\p{Z}\p{P}]+/u;

export function tokenize(text: string): string[] {
  const words = segmenter
    ? [...segmenter.segment(text)].filter((part) => part.isWordLike).map((part) => part.segment)
    : text.split(SPACE_OR_PUNCTUATION).filter(Boolean);
  const parts: string[] = [];
  for (const word of words) {
    parts.push(word);
    if (/[_./:-]/.test(word)) parts.push(...word.split(/[_./:-]+/).filter(Boolean));
  }
  return parts;
}
