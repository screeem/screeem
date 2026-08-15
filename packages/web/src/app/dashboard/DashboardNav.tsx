"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const teamItems = [
  { href: "/dashboard/team", label: "Team settings" },
  { href: "/dashboard/calendar", label: "Calendar" },
  { href: "/dashboard/forms", label: "Forms" },
  { href: "/dashboard/integrations", label: "Integrations" },
  { href: "/dashboard/api", label: "API" },
];

const userItems = [
  { href: "/dashboard/user", label: "User" },
];

export function DashboardNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Dashboard sections"
      className="flex justify-between gap-6 overflow-x-auto"
    >
      {[teamItems, userItems].map((items, index) => (
        <div key={index} className="flex gap-6">
          {items.map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`whitespace-nowrap border-b-2 py-3 text-sm font-medium transition-colors ${
                  active
                    ? "border-gray-900 text-gray-900"
                    : "border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-800"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
