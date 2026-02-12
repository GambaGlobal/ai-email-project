"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/onboarding", label: "Onboarding" },
  { href: "/docs", label: "Docs" },
  { href: "/tone-policies", label: "Tone & Policies" },
  { href: "/system-health", label: "System Health" }
];

export function AdminNav() {
  const pathname = usePathname();

  return (
    <nav className="admin-nav" aria-label="Admin navigation">
      <h2>Admin</h2>
      <ul>
        {links.map((link) => (
          <li key={link.href}>
            <Link href={link.href} data-active={pathname === link.href}>
              {link.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
