'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

export function NavLink({ href, children }: { href: string; children: ReactNode }) {
  const pathname = usePathname();
  const active = href === '/' ? pathname === '/' : pathname.startsWith(href);
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={`block rounded-md px-3 py-1.5 text-sm whitespace-nowrap transition-colors ${
        active ? 'bg-subtle text-ink font-medium' : 'text-muted hover:bg-subtle hover:text-ink'
      }`}
    >
      {children}
    </Link>
  );
}
