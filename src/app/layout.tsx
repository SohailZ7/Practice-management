import type { Metadata } from "next";
import type { ReactNode } from "react";
import { getCurrentUser, levels } from "@/lib/session";
import { canOpenAdmin } from "@/lib/access";
import { Nav } from "@/components/Nav";
import "./globals.css";

export const metadata: Metadata = {
  title: "Practice Management",
  description: "Schedule, tasks, employees and access for the practice.",
};

export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: { children: ReactNode }) {
  const user = await getCurrentUser();
  return (
    <html lang="en">
      <body>
        {user && (
          <Nav
            name={user.name}
            email={user.email}
            levels={levels(user)}
            isAdmin={canOpenAdmin(user)}
          />
        )}
        <main>{children}</main>
      </body>
    </html>
  );
}
