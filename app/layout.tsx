import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import "./globals.css";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { logout } from "@/app/login/actions";
import { SubmitButton } from "@/components/submit-button";

export const metadata: Metadata = {
  title: "OrderHub",
  description: "Order dashboard",
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <html lang="en">
      <body className="bg-gray-50 text-gray-900">
        <nav className="border-b bg-white px-6 py-3">
          <div className="mx-auto flex max-w-6xl items-center justify-between text-sm">
            <span className="font-semibold">OrderHub</span>
            <div className="flex items-center gap-4">
              {user ? (
                <>
                  <Link href="/dashboard" className="text-blue-600 hover:underline">
                    Dashboard
                  </Link>
                  <Link href="/analytics" className="text-blue-600 hover:underline">
                    Analytics
                  </Link>
                  <Link href="/products" className="text-blue-600 hover:underline">
                    Products
                  </Link>
                  <Link href="/shops/new" className="text-blue-600 hover:underline">
                    New Shop
                  </Link>
                  <Link href="/shops/connect" className="text-blue-600 hover:underline">
                    Connect Shopify
                  </Link>
                  <form action={logout}>
                    <SubmitButton variant="secondary" pendingLabel="Logging out…">
                      Logout
                    </SubmitButton>
                  </form>
                </>
              ) : (
                <Link href="/login" className="text-blue-600 hover:underline">
                  Login
                </Link>
              )}
            </div>
          </div>
        </nav>
        {children}
      </body>
    </html>
  );
}
