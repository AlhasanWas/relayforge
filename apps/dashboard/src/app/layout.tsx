import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { NavLink } from '@/components/nav-link';
import './globals.css';

// Every page shows live operational data read from the API at request time.
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: { default: 'RelayForge', template: '%s · RelayForge' },
  description: 'Operator dashboard for the RelayForge demo workspace',
  robots: { index: false, follow: false },
};

const NAVIGATION = [
  { href: '/', label: 'Overview' },
  { href: '/events', label: 'Events' },
  { href: '/deliveries', label: 'Deliveries' },
  { href: '/dead-letter', label: 'Dead letter' },
  { href: '/endpoints', label: 'Endpoints' },
  { href: '/transactions', label: 'Transactions' },
  { href: '/ledger', label: 'Ledger' },
] as const;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="font-sans antialiased">
        <div className="min-h-screen md:grid md:grid-cols-[13rem_1fr]">
          <aside className="border-line bg-surface border-b md:sticky md:top-0 md:h-screen md:border-r md:border-b-0">
            <div className="flex items-center justify-between gap-4 px-4 py-4 md:block md:px-5 md:py-6">
              <div>
                <p className="text-base font-semibold tracking-tight">RelayForge</p>
                <p className="text-muted text-xs">Demo workspace</p>
              </div>
            </div>
            <nav aria-label="Main" className="overflow-x-auto px-2 pb-3 md:px-3">
              <ul className="flex gap-1 md:flex-col">
                {NAVIGATION.map((item) => (
                  <li key={item.href}>
                    <NavLink href={item.href}>{item.label}</NavLink>
                  </li>
                ))}
              </ul>
            </nav>
          </aside>
          <main className="mx-auto w-full max-w-6xl px-4 py-6 md:px-8 md:py-8">{children}</main>
        </div>
      </body>
    </html>
  );
}
