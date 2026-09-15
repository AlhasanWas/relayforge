'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import {
  type CreateEndpointState,
  createEndpointAction,
  type FormState,
  replayDeliveryAction,
  setEndpointActiveAction,
} from '@/app/actions';

const IDLE: FormState = { status: 'idle' };

function SubmitButton({
  children,
  pendingLabel,
  variant = 'primary',
}: {
  children: string;
  pendingLabel: string;
  variant?: 'primary' | 'secondary';
}) {
  const { pending } = useFormStatus();
  const styles =
    variant === 'primary'
      ? 'bg-accent text-accent-ink hover:opacity-90'
      : 'border-line bg-surface text-ink hover:bg-subtle border';
  return (
    <button
      type="submit"
      disabled={pending}
      className={`rounded-md px-3 py-1.5 text-xs font-medium whitespace-nowrap disabled:opacity-60 ${styles}`}
    >
      {pending ? pendingLabel : children}
    </button>
  );
}

function FormError({ state }: { state: FormState | CreateEndpointState }) {
  if (state.status !== 'error') return null;
  return (
    <p role="alert" className="text-bad mt-1 text-xs">
      {state.message}
    </p>
  );
}

export function ReplayButton({ deliveryId }: { deliveryId: string }) {
  const [state, action] = useActionState(replayDeliveryAction.bind(null, deliveryId), IDLE);
  return (
    <form action={action}>
      <SubmitButton pendingLabel="Replaying…">Replay</SubmitButton>
      <FormError state={state} />
    </form>
  );
}

export function EndpointActiveToggle({
  endpointId,
  isActive,
}: {
  endpointId: string;
  isActive: boolean;
}) {
  const [state, action] = useActionState(
    setEndpointActiveAction.bind(null, endpointId, !isActive),
    IDLE,
  );
  return (
    <form action={action}>
      <SubmitButton variant="secondary" pendingLabel="Saving…">
        {isActive ? 'Disable' : 'Enable'}
      </SubmitButton>
      <FormError state={state} />
    </form>
  );
}

export function CreateEndpointForm({ eventTypes }: { eventTypes: readonly string[] }) {
  const [state, action] = useActionState<CreateEndpointState, FormData>(createEndpointAction, IDLE);
  const inputClass =
    'border-line bg-canvas focus:border-accent w-full rounded-md border px-2.5 py-1.5 text-sm outline-none';

  return (
    <form action={action} className="space-y-3 px-4 py-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-xs">
          <span className="text-muted mb-1 block">URL</span>
          <input
            name="url"
            type="url"
            required
            placeholder="https://example.com/webhooks"
            className={inputClass}
          />
        </label>
        <label className="block text-xs">
          <span className="text-muted mb-1 block">Description (optional)</span>
          <input name="description" maxLength={200} className={inputClass} />
        </label>
      </div>
      <fieldset className="text-xs">
        <legend className="text-muted mb-1">Event types</legend>
        <div className="flex flex-wrap gap-4">
          {eventTypes.map((type) => (
            <label key={type} className="flex items-center gap-1.5">
              <input type="checkbox" name="eventTypes" value={type} defaultChecked />
              <span className="font-mono">{type}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton pendingLabel="Creating…">Create endpoint</SubmitButton>
        <FormError state={state} />
      </div>
      {state.status === 'created' && (
        <div role="status" className="bg-ok-soft text-ok rounded-md px-3 py-2 text-xs">
          <p>
            Created <span className="font-mono">{state.url}</span>. Copy the signing secret now; it
            is not shown again.
          </p>
          <p className="mt-1 font-mono break-all select-all">{state.signingSecret}</p>
        </div>
      )}
    </form>
  );
}
