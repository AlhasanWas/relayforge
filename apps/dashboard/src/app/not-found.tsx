import { Card, TextLink } from '@/components/ui';

export default function NotFound() {
  return (
    <Card className="px-5 py-6">
      <h1 className="text-base font-semibold">Not found</h1>
      <p className="text-muted mt-1 text-sm">Nothing with this id exists in the demo workspace.</p>
      <p className="mt-4 text-sm">
        <TextLink href="/">Back to the overview</TextLink>
      </p>
    </Card>
  );
}
