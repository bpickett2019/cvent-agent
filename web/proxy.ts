import { NextResponse, type NextRequest } from "next/server";
import { authorizeOperatorRequest, operatorAuthOptions } from "./lib/operator-auth";

export function proxy(request: NextRequest): NextResponse {
  const authorization = authorizeOperatorRequest(request, operatorAuthOptions());
  if (authorization.authorized) return NextResponse.next();

  return new NextResponse("Operator authentication required", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="EmeraldX operator console", charset="UTF-8"',
      "Cache-Control": "no-store",
    },
  });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
