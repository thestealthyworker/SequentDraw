import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string);
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL as string, process.env.SUPABASE_SERVICE_ROLE_KEY as string);

export async function POST(request: Request) {
  const body = await request.text();
  const event = stripe.webhooks.constructEvent(body, request.headers.get('stripe-signature') as string, process.env.STRIPE_WEBHOOK_SECRET as string);

  if (event.type === 'checkout.session.completed') {
    await supabase.from('orders').update({ paid: true }).eq('id', event.data.object.id);
  }

  return new Response('ok', { status: 200 });
}
