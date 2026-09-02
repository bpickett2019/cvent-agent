import type { DefaultSession } from "next-auth";
import type { EmeraldRole } from "./lib/entra-authz";

declare module "next-auth" {
  interface Session {
    user: DefaultSession["user"] & { roles: EmeraldRole[] };
  }
  interface User {
    roles?: EmeraldRole[];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    roles?: EmeraldRole[];
  }
}
