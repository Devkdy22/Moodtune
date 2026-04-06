export type CanonicalGenre =
  | "k-pop"
  | "hip-hop"
  | "melodic-hip-hop"
  | "r&b"
  | "soul"
  | "indie"
  | "folk"
  | "ost";

export type CanonicalSpecialTag = "ost";

function compact(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function collapsed(value: string): string {
  return value.toLowerCase().replace(/[\s-]+/g, "");
}

export function normalizeGenre(raw?: string): CanonicalGenre | null {
  if (!raw) return null;
  const v = compact(raw);
  const c = collapsed(raw);

  if (["kpop", "k-pop", "k pop"].includes(v) || c === "kpop") return "k-pop";
  if (["hiphop", "hip-hop", "hip hop"].includes(v) || c === "hiphop") return "hip-hop";
  if (
    ["멜로디 힙합", "melodic hip hop", "melodic-hip-hop"].includes(v) ||
    c === "melodichiphop"
  ) {
    return "melodic-hip-hop";
  }
  if (["rnb", "r&b", "r n b"].includes(v) || c === "rnb" || c === "r&b") return "r&b";
  if (["soul", "소울"].includes(v)) return "soul";
  if (["indie", "인디", "k-indie", "k indie"].includes(v) || c === "kindie") return "indie";
  if (["folk", "포크"].includes(v)) return "folk";
  if (
    ["ost", "soundtrack", "movie soundtrack", "영화음악", "영화 음악"].includes(v) ||
    c === "ost" ||
    c === "soundtrack" ||
    c === "moviesoundtrack" ||
    c === "영화음악"
  ) {
    return "ost";
  }

  return null;
}

export function normalizeSpecialTag(raw?: string): CanonicalSpecialTag | null {
  const g = normalizeGenre(raw);
  if (g === "ost") return "ost";
  return null;
}

