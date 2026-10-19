// Runs once when the server starts. The Node-only checks live in a separate file so the Edge bundle never sees node:crypto.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./instrumentation-node");
  }
}
