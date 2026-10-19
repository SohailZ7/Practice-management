import "next-auth";
import "next-auth/jwt";

declare module "next-auth" {
  interface Session {
    authAt?: number;
    lastActive?: number;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    authAt?: number;
    lastActive?: number;
  }
}
