'use server';

import { MOCKPAY_EVENT_TYPES } from '@relayforge/shared/providers';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { describeActionError } from '@/lib/api/errors';
import { createEndpoint, replayDelivery, setEndpointActive } from '@/lib/api/resources';
import { isUuid } from '@/lib/search-params';

export type FormState =
  { readonly status: 'idle' } | { readonly status: 'error'; readonly message: string };

export type CreateEndpointState =
  | FormState
  | {
      readonly status: 'created';
      readonly url: string;
      readonly signingSecret: string;
    };

/** Replays a final delivery as a new delivery, then opens it. */
export async function replayDeliveryAction(deliveryId: string): Promise<FormState> {
  if (!isUuid(deliveryId)) return { status: 'error', message: 'Unknown delivery.' };

  let replayId: string;
  try {
    replayId = (await replayDelivery(deliveryId)).deliveryId;
  } catch (error: unknown) {
    return { status: 'error', message: describeActionError(error) };
  }
  revalidatePath('/deliveries');
  revalidatePath('/dead-letter');
  redirect(`/deliveries/${replayId}`);
}

export async function createEndpointAction(
  _previous: CreateEndpointState,
  form: FormData,
): Promise<CreateEndpointState> {
  const url = form.get('url');
  const description = form.get('description');
  const eventTypes = form
    .getAll('eventTypes')
    .filter((value): value is string => typeof value === 'string')
    .filter((value) => MOCKPAY_EVENT_TYPES.some((type) => type === value));

  if (typeof url !== 'string' || url.trim() === '') {
    return { status: 'error', message: 'Enter the endpoint URL.' };
  }
  if (eventTypes.length === 0) {
    return { status: 'error', message: 'Choose at least one event type.' };
  }

  try {
    const created = await createEndpoint({
      url: url.trim(),
      description:
        typeof description === 'string' && description.trim() !== ''
          ? description.trim()
          : undefined,
      eventTypes,
    });
    revalidatePath('/endpoints');
    return { status: 'created', url: created.url, signingSecret: created.signingSecret };
  } catch (error: unknown) {
    return { status: 'error', message: describeActionError(error) };
  }
}

export async function setEndpointActiveAction(
  endpointId: string,
  isActive: boolean,
): Promise<FormState> {
  if (!isUuid(endpointId)) return { status: 'error', message: 'Unknown endpoint.' };
  try {
    await setEndpointActive(endpointId, isActive);
  } catch (error: unknown) {
    return { status: 'error', message: describeActionError(error) };
  }
  revalidatePath('/endpoints');
  return { status: 'idle' };
}
