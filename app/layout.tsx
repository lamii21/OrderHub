import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Inter } from "next/font/google";
import Link from "next/link";
import "./globals.css";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { logout } from "@/app/login/actions";
import { SubmitButton } from "@/components/submit-button";
import { AppSidebar } from "@/components/app-sidebar";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

export const metadata: Metadata = {
  title: "OrderHub",
  description: "Order dashboard",
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return (
      <html lang="en" className={inter.variable}>
        <body className="bg-neutral-50 font-sans text-neutral-900">
          <nav className="border-b border-neutral-200 bg-white px-6 py-3">
            <div className="mx-auto flex max-w-6xl items-center justify-between text-sm">
              <span className="text-lg font-semibold text-neutral-900">OrderHub</span>
              <Link href="/login" className="font-medium text-brand-600 hover:text-brand-700">
                Login
              </Link>
            </div>
          </nav>
          {children}
        </body>
      </html>
    );
  }

  const logoutSlot = (
    <form action={logout}>
      <SubmitButton variant="secondary" pendingLabel="Logging out…">
        Logout
      </SubmitButton>
    </form>
  );

  return (
    <html lang="en" className={inter.variable}>
      <body className="font-sans text-neutral-900">
        <div className="flex min-h-screen bg-neutral-50">
          <AppSidebar logoutSlot={logoutSlot} />
          <div className="min-w-0 flex-1">{children}</div>
        </div>
      </body>
    </html>
  );
}
