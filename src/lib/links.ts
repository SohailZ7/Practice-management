// Link detection, same rules as the Sohail Todo App.

export type LinkType = "webex" | "pr" | "doc" | "markdown" | "link";

export function detectLinkType(url: string): LinkType {
  const lower = url.toLowerCase();
  if (lower.includes("webex.com")) return "webex";
  if (/\/pull\/\d+|\/pull-requests\/\d+|\/merge_requests\/\d+/.test(lower)) return "pr";
  if (lower.endsWith(".md")) return "markdown";
  if (lower.endsWith(".docx") || lower.endsWith(".doc") || lower.includes("docs.google.com")) {
    return "doc";
  }
  return "link";
}

export function linkTypeMeta(type: string): { icon: string; label: string } {
  switch (type) {
    case "webex":
      return { icon: "💬", label: "Webex" };
    case "pr":
      return { icon: "⑂", label: "PR" };
    case "doc":
      return { icon: "📄", label: "Doc" };
    case "markdown":
      return { icon: "📝", label: "Markdown" };
    default:
      return { icon: "🔗", label: "Link" };
  }
}

/** Only http(s) links are accepted so a stored link can never be a javascript: URL. */
export function normalizeUrl(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const u = new URL(withScheme);
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}
