import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { refreshSession } from "@/lib/supabase/proxy";

const publicAuthPaths = new Set(["/auth"]);

export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const isProtected = path.startsWith("/dashboard");

  if (!isSupabaseConfigured()) {
    if (isProtected) {
      return NextResponse.redirect(new URL("/", request.url));
    }
    return NextResponse.next();
  }

  const { claims, response } = await refreshSession(request);
  const isAuthenticated = Boolean(claims?.sub);

  if (isProtected && !isAuthenticated) {
    return NextResponse.redirect(new URL("/auth", request.url));
  }

  if (publicAuthPaths.has(path) && isAuthenticated) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
