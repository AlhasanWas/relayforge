import Link from 'next/link';
import type { ReactNode } from 'react';

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {description !== undefined && (
          <p className="text-muted mt-1 max-w-3xl text-sm">{description}</p>
        )}
      </div>
      {actions}
    </header>
  );
}

export function Section({
  title,
  description,
  actions,
  children,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="mt-8 first:mt-0">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">{title}</h2>
          {description !== undefined && <p className="text-muted mt-0.5 text-xs">{description}</p>}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`border-line bg-surface rounded-lg border ${className}`}>{children}</div>;
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <Card className="px-4 py-3">
      <p className="text-muted text-xs">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      {hint !== undefined && <p className="text-muted mt-0.5 text-xs">{hint}</p>}
    </Card>
  );
}

export function DetailList({ items }: { items: readonly (readonly [string, ReactNode])[] }) {
  return (
    <Card>
      <dl className="divide-line divide-y text-sm">
        {items.map(([label, value]) => (
          <div key={label} className="grid gap-1 px-4 py-2.5 sm:grid-cols-[12rem_1fr] sm:gap-4">
            <dt className="text-muted">{label}</dt>
            <dd className="min-w-0 break-words">{value}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

export function JsonBlock({ value }: { value: unknown }) {
  return (
    <Card className="overflow-x-auto">
      <pre className="px-4 py-3 font-mono text-xs leading-relaxed">
        {JSON.stringify(value, null, 2)}
      </pre>
    </Card>
  );
}

export function Mono({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <span className="font-mono text-xs" title={title}>
      {children}
    </span>
  );
}

export function TextLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="text-accent underline-offset-2 hover:underline">
      {children}
    </Link>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <Card className="text-muted px-4 py-10 text-center text-sm">
      <p>{children}</p>
    </Card>
  );
}

export function Notice({
  tone = 'info',
  children,
}: {
  tone?: 'info' | 'warn' | 'bad' | 'ok';
  children: ReactNode;
}) {
  const tones = {
    info: 'bg-info-soft text-info',
    warn: 'bg-warn-soft text-warn',
    bad: 'bg-bad-soft text-bad',
    ok: 'bg-ok-soft text-ok',
  } as const;
  return <div className={`rounded-md px-3 py-2 text-sm ${tones[tone]}`}>{children}</div>;
}
