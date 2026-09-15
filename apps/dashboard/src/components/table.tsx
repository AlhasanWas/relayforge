import type { ReactNode } from 'react';

export function Table({
  caption,
  head,
  children,
}: {
  caption: string;
  head: readonly string[];
  children: ReactNode;
}) {
  return (
    <div className="border-line bg-surface overflow-x-auto rounded-lg border">
      <table className="w-full text-left text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead className="border-line text-muted border-b text-xs">
          <tr>
            {head.map((label) => (
              <th key={label} scope="col" className="px-4 py-2 font-medium whitespace-nowrap">
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-line divide-y">{children}</tbody>
      </table>
    </div>
  );
}

export function Cell({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <td className={`px-4 py-2.5 align-top ${className}`}>{children}</td>;
}
