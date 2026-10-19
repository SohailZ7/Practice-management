import { withAuth } from "next-auth/middleware";

export default withAuth({ pages: { signIn: "/login" } });

// Everything except the sign-in page, NextAuth routes and static assets requires a session.
// Per-module authorization happens on the server in requireAccess().
export const config = {
  matcher: ["/((?!login|api/auth|_next/static|_next/image|favicon.ico).*)"],
};
