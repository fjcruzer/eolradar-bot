import type { ServiceSummary } from "./types";

export interface RankedService {
  service: ServiceSummary;
  score: number;
}

export type ResolveResult =
  | { type: "match"; service: ServiceSummary }
  | { type: "ambiguous"; matches: ServiceSummary[]; total: number }
  | { type: "none"; suggestions: ServiceSummary[] };

const MIN_SCORE = 68;
const TIE_GAP = 4;
const MAX_AMBIGUOUS = 8;

const TOKEN_ALIASES: Record<string, string> = {
  postgres: "postgresql",
  k8s: "kubernetes",
};

/** Rank services for a free-text query. Highest score first, then slug. */
export function rankServices(query: string, services: readonly ServiceSummary[]): RankedService[] {
  const folded = fold(query);
  return services
    .map((service) => ({ service, score: scoreService(folded, service) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.service.slug.localeCompare(b.service.slug));
}

export function resolveService(query: string, services: readonly ServiceSummary[]): ResolveResult {
  const ranked = rankServices(query, services);
  const viable = ranked.filter((entry) => entry.score >= MIN_SCORE);
  const top = viable[0];
  if (!top) {
    return {
      type: "none",
      suggestions: ranked
        .filter((entry) => entry.score >= 50)
        .slice(0, 3)
        .map((entry) => entry.service),
    };
  }
  const close = viable.filter((entry) => top.score - entry.score <= TIE_GAP);
  if (close.length === 1) return { type: "match", service: top.service };
  return {
    type: "ambiguous",
    matches: close.slice(0, MAX_AMBIGUOUS).map((entry) => entry.service),
    total: close.length,
  };
}

function scoreService(query: string, service: ServiceSummary): number {
  if (query.length === 0) return 0;
  return Math.max(
    scoreText(query, fold(service.slug)),
    scoreText(query, fold(service.name)),
    scoreText(query, fold(service.category)),
    scoreText(query, fold(service.provider)),
  );
}

function scoreText(query: string, target: string): number {
  if (target.length === 0) return 0;
  if (query === target) return 100;
  if (query.length >= 3 && target.startsWith(query)) return 92;
  if (target.length >= 3 && query.startsWith(target)) return 88;
  if (query.length >= 3 && target.includes(query)) return 80;
  if (target.length >= 4 && query.includes(target)) return 76;
  const distance = levenshtein(query, target);
  const maxLen = Math.max(query.length, target.length);
  if (distance === 1 && maxLen >= 3) return 74;
  if (distance === 2 && maxLen >= 6) return 68;
  const similarity = 1 - distance / maxLen;
  if (similarity >= 0.8) return Math.round(60 + similarity * 20);
  return 0;
}

export function fold(input: string): string {
  return input
    .toLowerCase()
    .replaceAll("&", " and ")
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 0)
    .map((token) => TOKEN_ALIASES[token] ?? token)
    .join("");
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const previous = new Array<number>(b.length + 1);
  const current = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j += 1) previous[j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i;
    const aChar = a.charCodeAt(i - 1);
    for (let j = 1; j <= b.length; j += 1) {
      const cost = aChar === b.charCodeAt(j - 1) ? 0 : 1;
      const insert = (current[j - 1] ?? 0) + 1;
      const remove = (previous[j] ?? 0) + 1;
      const replace = (previous[j - 1] ?? 0) + cost;
      current[j] = Math.min(insert, remove, replace);
    }
    for (let j = 0; j <= b.length; j += 1) previous[j] = current[j] ?? 0;
  }
  return previous[b.length] ?? Math.max(a.length, b.length);
}
