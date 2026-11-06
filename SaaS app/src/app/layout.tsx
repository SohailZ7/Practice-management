import type { Metadata } from "next";
import type { ReactNode } from "react";
import { getCurrentUser, getSessionTiming, levels } from "@/lib/session";
import { canOpenAdmin } from "@/lib/access";
import { normalizeTheme, themeAttribute } from "@/lib/theme";
import { DesktopUpdateBanner } from "@/components/DesktopUpdateBanner";
import { AppShell } from "@/components/AppShell";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Brain and Behavior Center", template: "%s · Brain and Behavior Center" },
  description: "Schedule, tasks, employees and access for Brain and Behavior Center.",
  icons: {
    icon: [{ url: "/brand/bbc-icon-64.png", sizes: "64x64", type: "image/png" }],
    apple: [{ url: "/brand/bbc-icon-180.png", sizes: "180x180", type: "image/png" }],
  },
};

export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: { children: ReactNode }) {
  const user = await getCurrentUser();
  const timing = user ? await getSessionTiming() : null;
  return (
    <html lang="en" data-theme={user ? themeAttribute(normalizeTheme(user.theme)) : undefined}>
      <body>
        {user ? (
          <AppShell
            name={user.name}
            email={user.email}
            levels={levels(user)}
            isAdmin={canOpenAdmin(user)}
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
