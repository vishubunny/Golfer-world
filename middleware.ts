import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

/**
 * Auth gate — redirects unauthenticated users away from /dashboard and /admin.
 * Subscription/role checks happen in the page itself for finer feedback.
 */
export async function middleware(req: NextRequest) {
  const res = NextResponse.next();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => req.cookies.getAll(),
        setAll: (toSet: { name: string; value: string; options?: any }[]) =>
          toSet.forEach(({ name, value, options }) => res.cookies.set(name, value, options))
      }
    }
  );
  const { data: { user } } = await supabase.auth.getUser();

  const path = req.nextUrl.pathname;
  const protectedRoute = path.startsWith("/dashboard") || path.startsWith("/admin");
  if (protectedRoute && !user) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", path);
    return NextResponse.redirect(url);
  }
  return res;
}

export const config = {
  matcher: ["/dashboard/:path*", "/admin/:path*"]
};
