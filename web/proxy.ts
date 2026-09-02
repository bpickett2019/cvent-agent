import type { NextFetchEvent, NextMiddleware, NextRequest } from "next/server";
import { auth } from "./auth";

const entraMiddleware = auth as unknown as NextMiddleware;

export function proxy(request: NextRequest, event: NextFetchEvent) {
  return entraMiddleware(request, event);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
