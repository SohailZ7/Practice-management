// Scope for GET /notes/visits: the signed-in provider's own visits. `myProviderName` (what Desktop knows) wins over the account name; `mine=1` uses the account name.
// Returns the name to match against each visit's provider, or null for "everyone's visits" (the default).
export function mineName(a: { mine: string | null; myProviderName: string | null; userName: string }): string | null {
  const explicit = (a.myProviderName ?? "").trim().slice(0, 120);
  if (explicit) return explicit;
  if (a.mine === "1" || a.mine === "true") return a.userName.trim() || null;
  return null;
}
