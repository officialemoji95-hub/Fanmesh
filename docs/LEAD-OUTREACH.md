# Lead Outreach

Lead Outreach sends a creator-controlled post to leads who already granted email or SMS permission. It does not contact platform-only followers, scrape contact details, send automated social DMs, or influence a platform feed.

## Setup

1. Run `supabase/migrations/202607310001_lead_outreach.sql` in the Supabase SQL Editor.
2. For email, create a Resend account, verify the sending domain, and add `RESEND_API_KEY` plus `OUTREACH_EMAIL_FROM` to Render. `OUTREACH_REPLY_TO` is optional.
3. For SMS, configure a permitted Twilio sender and add `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and `TWILIO_FROM_NUMBER` to Render.
4. Redeploy, sign in, and confirm the Lead Outreach badge reports the expected sender as ready.

## Launch flow

1. Import authorized leads with consent timestamp, source, and channel provenance.
2. Add the public post URL, message, direct channels, and source filters.
3. Confirm content ownership and lead contact rights, then preview.
4. Review eligible, held-out, frequency-capped, and source totals. Contact details are not returned to browser JavaScript.
5. Check the separate launch confirmation and send.

FanMesh chooses at most one channel per lead in a campaign, preferring email when both selected channels are consented. It reserves the measurement holdout, suppresses a lead already messaged on that channel during the previous 48 hours, and caps the beta launch at 100 recipients. Resend requests use a per-fan idempotency key. Provider acceptance is recorded as `sent`; delivery, bounce, and reply webhooks are a later operational milestone and should not be inferred from provider acceptance.

Email recipients receive the tracked destination and a reply-to-unsubscribe instruction. SMS messages include the provider-standard `STOP` instruction. The creator remains responsible for a valid disclosure, lawful sender registration, accurate consent provenance, and acting on email unsubscribe replies.
