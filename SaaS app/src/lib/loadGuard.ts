/** Never let a pop-up hang on "Loading…": a promise that rejects if it has not settled in `ms`. */
export const LOAD_TIMEOUT_MS = 20000;

export const TRANSCRIPT_LOAD_ERROR = "Could not load the transcript. Try again, or tell the team.";

export function withTimeout<T>(p: Promise<T>, ms: number = LOAD_TIMEOUT_MS): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), ms);
    p.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });
}
