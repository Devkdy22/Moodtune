import {
  CanonicalGenre,
  CanonicalSpecialTag,
} from "../utils/normalizeIntent";

export function extractForcedGenresFromPrompt(prompt: string): CanonicalGenre[] {
  const lower = String(prompt ?? "").toLowerCase();
  const result = new Set<CanonicalGenre>();

  if (/k[\s-]?pop/.test(lower)) result.add("k-pop");
  if (/ost|soundtrack|movie soundtrack|영화\s*음악/.test(lower)) result.add("ost");
  if (/r\s*&\s*b|rnb|r\s*n\s*b/.test(lower)) result.add("r&b");
  if (/소울|\bsoul\b/.test(lower)) result.add("soul");
  if (/멜로디\s*힙합|melodic[\s-]*hip[\s-]*hop/.test(lower)) result.add("melodic-hip-hop");
  if (/힙합|hip[\s-]*hop/.test(lower)) result.add("hip-hop");
  if (/인디|\bindie\b/.test(lower)) result.add("indie");
  if (/포크|\bfolk\b/.test(lower)) result.add("folk");

  return Array.from(result);
}

export function extractForcedSpecialTagsFromPrompt(prompt: string): CanonicalSpecialTag[] {
  const lower = String(prompt ?? "").toLowerCase();
  const result = new Set<CanonicalSpecialTag>();

  if (/ost|soundtrack|movie soundtrack|영화\s*음악/.test(lower)) result.add("ost");

  return Array.from(result);
}
