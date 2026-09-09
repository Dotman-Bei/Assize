/**
 * The forbidden vocabulary (AGENTS.md, PRD §5.2, §22 G8, frontend.md §1.6).
 *
 * This file is the single source of truth for the list, and it is the one file
 * `pnpm check:vocabulary` exempts from its own scan — a rule has to be able to
 * name the words it forbids.
 *
 * PRD §5.2: "A schema validator rejects the words ... in any claim string or
 * user-facing copy, as a backstop against the product lying by accident."
 */

/**
 * AGENTS.md lists seven. PRD §5.2 and frontend.md §1.6 list the first six.
 * AGENTS.md states that it overrides anything inferred from surrounding files,
 * and `claims.json` independently lists all seven, so the union is enforced
 * (DECISIONS.md D-007).
 */
export const FORBIDDEN_VOCABULARY = [
  "guaranteed",
  "safe",
  "liquid",
  "always",
  "protected",
  "insured",
  "risk-free",
] as const;

export type ForbiddenWord = (typeof FORBIDDEN_VOCABULARY)[number];

/**
 * Matching is on word boundaries, case-insensitive (DECISIONS.md D-008).
 *
 * Substring matching would be unusable in both directions. It would forbid
 * "liquidity", which frontend.md §3.1 mandates in the product's own headline,
 * and "safeParse", an ordinary library call — while a boundary match still
 * catches the bare words that would let the product overclaim.
 */
export function forbiddenWordPattern(): RegExp {
  const alternation = FORBIDDEN_VOCABULARY.map((word) =>
    word.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"),
  ).join("|");
  return new RegExp(`\\b(${alternation})\\b`, "giu");
}

/** Every forbidden word occurring in `text`, lowercased, in order of appearance. */
export function findForbiddenWords(text: string): string[] {
  return [...text.matchAll(forbiddenWordPattern())].map((match) => match[0].toLowerCase());
}
