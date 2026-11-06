// A sign-in token belongs to the environment it was issued for. It is kept together with that environment and only
// handed out for the same one, so for one render after a switch it can never be sent to the other server.
import type { EnvironmentId } from "./environments";

export type ScopedToken = { env: EnvironmentId; value: string } | null;

export const scopeToken = (env: EnvironmentId, value: string | null): ScopedToken => (value ? { env, value } : null);
export const tokenFor = (t: ScopedToken, env: EnvironmentId): string | null => (t && t.env === env ? t.value : null);
