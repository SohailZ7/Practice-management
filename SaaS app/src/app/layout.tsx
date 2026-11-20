import type { Metadata } from "next";
import type { ReactNode } from "react";
import { getCurrentUser, getSessionTiming, levels } from "@/lib/session";
import { canOpenAdmin } from "@/lib/access";
import { normalizeTheme, themeAttribute } from "@/lib/theme";
import { DesktopUpdateBanner } from "@/components/DesktopUpdateBanner";
import { AppShell } from "@/components/AppShell";
import { DM_Sans } from "next/font/google";
import { isStaging } from "@/lib/promote/rules";
import { envKind, ENV_TEXT, titlePrefix } from "@/lib/envBanner";
import "./globals.css";

// Self-hosted at build time by Next (no request to Google from the browser).
const dmSans = DM_Sans({ subsets: ["latin"], variable: "--font-dm", display: "swap", weight: ["400", "500", "600"] });

export function generateMetadata(): Metadata {
  const pre = titlePrefix(envKind());
  return {
  title: { default: `${pre}Brain and Behavior Center`, template: `${pre}%s · Brain and Behavior Center` },
  description: "Schedule, tasks, employees and access for Brain and Behavior Center.",
  icons: {
    icon: [{ url: "/brand/bbc-icon-64.png", sizes: "64x64", type: "image/png" }],
    apple: [{ url: "/brand/bbc-icon-180.png", sizes: "180x180", type: "image/png" }],
  },
};
}

export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: { children: ReactNode }) {
  const user = await getCurrentUser();
  const timing = user ? await getSessionTiming() : null;
  const kind = envKind();
  return (
    <html lang="en" className={dmSans.variable} data-theme={user ? themeAttribute(normalizeTheme(user.theme)) : undefined}>
      <body className="has-envbar">
        <div className={`env-bar ${kind}`} role="status" data-env={kind}>
          <strong>{ENV_TEXT[kind].label}</strong>
          <span>{ENV_TEXT[kind].note}</span>
        </div>
        {user ? (
          <AppShell
            name={user.name}
            email={user.email}
            levels={levels(user)}
            isAdmin={canOpenAdmin(user)}
            staging={isStaging()}
            roleLabel={user.role === "ADMIN" ? "Practice administrator" : user.role === "PROVIDER" ? "Provider" : "Staff"}
            timing={timing}
          >
            <DesktopUpdateBanner user={user} />
            {children}
          </AppShell>
        ) : (
          <main style={{ padding: "0 16px" }}>{children}</main>
        )}
      </body>
    </html>
  );
}
