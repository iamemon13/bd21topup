import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";

const SITE_URL = "http://192.168.0.196:3000";

export async function GET(request: Request) {
  const url = new URL(request.url);

  const code = url.searchParams.get("code");

  if (!code) {
    return NextResponse.redirect(new URL("/login?error=no_code", SITE_URL));
  }

  const redirectResponse = NextResponse.redirect(new URL("/account", SITE_URL));

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          const cookieHeader = request.headers.get("cookie");

          if (!cookieHeader) {
            return [];
          }

          return cookieHeader.split(";").map((cookie) => {
            const [name, ...rest] = cookie.trim().split("=");

            return {
              name,
              value: rest.join("="),
            };
          });
        },

        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            redirectResponse.cookies.set(name, value, options);
          });
        },
      },
    },
  );

  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    console.error("AUTH CALLBACK ERROR:", error);

    return NextResponse.redirect(
      new URL("/login?error=callback_failed", SITE_URL),
    );
  }

  return redirectResponse;
}
