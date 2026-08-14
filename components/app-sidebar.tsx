"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { Icon } from "@/components/ui/icon";
import { ICONS } from "@/components/icons";

type NavItem = { href: string; label: string; icon: keyof typeof ICONS };
type NavGroup = { label: string; items: NavItem[] };

const NAV_GROUPS: NavGroup[] = [
  {
    label: "Overview",
    items: [
      { href: "/dashboard", label: "Dashboard", icon: "dashboard" },
      { href: "/analytics", label: "Analytics", icon: "analytics" },
      { href: "/products", label: "Products", icon: "products" },
    ],
  },
  {
    label: "Shops",
    items: [
      { href: "/shops", label: "All Shops", icon: "shops" },
      { href: "/shops/new", label: "New Shop", icon: "newShop" },
      { href: "/shops/connect", label: "Connect Store", icon: "connect" },
    ],
  },
  {
    label: "Automation",
    items: [{ href: "/workflows", label: "Workflows", icon: "workflows" }],
  },
  {
    label: "System",
    items: [{ href: "/admin", label: "Admin", icon: "admin" }],
  },
];

function NavLink({ item, onNavigate }: { item: NavItem; onNavigate?: () => void }) {
  const pathname = usePathname();
  // "/shops" itself must not stay highlighted while looking at
  // "/shops/[id]/..." sub-pages (those aren't in this nav at all), but a
  // shop-scoped page should still be treated as "under Shops" — exact
  // match for single-segment routes, prefix match otherwise.
  const isActive = item.href === "/shops" ? pathname === "/shops" : pathname.startsWith(item.href);

  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={isActive ? "page" : undefined}
      className={cn(
        "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
        isActive
          ? "bg-brand-50 text-brand-700"
          : "text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900"
      )}
    >
      <Icon path={ICONS[item.icon]} className="h-4.5 w-4.5 shrink-0" />
      {item.label}
    </Link>
  );
}

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav className="flex h-full flex-col gap-6 overflow-y-auto px-3 py-4" aria-label="Main">
      {NAV_GROUPS.map((group) => (
        <div key={group.label}>
          <p className="mb-1 px-3 text-xs font-semibold uppercase tracking-wide text-neutral-400">
            {group.label}
          </p>
          <div className="flex flex-col gap-0.5">
            {group.items.map((item) => (
              <NavLink key={item.href} item={item} onNavigate={onNavigate} />
            ))}
          </div>
        </div>
      ))}
    </nav>
  );
}

export function AppSidebar({ logoutSlot }: { logoutSlot: ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <>
      {/* Mobile top bar — the sidebar itself is hidden below md, replaced
          by this bar + a slide-in overlay, so nothing is inaccessible on a
          phone-width viewport. */}
      <header className="sticky top-0 z-20 flex items-center justify-between border-b border-neutral-200 bg-white px-4 py-3 md:hidden">
        <Link href="/dashboard" className="text-lg font-semibold text-neutral-900">
          OrderHub
        </Link>
        <button
          type="button"
          onClick={() => setMobileOpen(true)}
          aria-label="Open navigation menu"
          className="rounded-md p-2 text-neutral-600 hover:bg-neutral-100"
        >
          <Icon path={ICONS.menu} className="h-5 w-5" />
        </button>
      </header>

      {mobileOpen && (
        <div className="fixed inset-0 z-30 md:hidden">
          <button
            type="button"
            aria-label="Close navigation menu"
            className="absolute inset-0 bg-neutral-900/40"
            onClick={() => setMobileOpen(false)}
          />
          <div className="absolute inset-y-0 left-0 flex w-72 flex-col bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-neutral-200 px-4 py-3">
              <span className="text-lg font-semibold text-neutral-900">OrderHub</span>
              <button
                type="button"
                onClick={() => setMobileOpen(false)}
                aria-label="Close navigation menu"
                className="rounded-md p-2 text-neutral-600 hover:bg-neutral-100"
              >
                <Icon path={ICONS.close} className="h-5 w-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">
              <SidebarContent onNavigate={() => setMobileOpen(false)} />
            </div>
            <div className="border-t border-neutral-200 p-3">{logoutSlot}</div>
          </div>
        </div>
      )}

      {/* Desktop sidebar — fixed width, always visible at md and above. */}
      <aside className="hidden w-64 shrink-0 flex-col border-r border-neutral-200 bg-white md:flex">
        <div className="flex items-center gap-2 border-b border-neutral-200 px-4 py-4">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-brand-600 text-sm font-bold text-white">
            O
          </div>
          <span className="text-lg font-semibold text-neutral-900">OrderHub</span>
        </div>
        <div className="flex-1 overflow-y-auto">
          <SidebarContent />
        </div>
        <div className="border-t border-neutral-200 p-3">{logoutSlot}</div>
      </aside>
    </>
  );
}
