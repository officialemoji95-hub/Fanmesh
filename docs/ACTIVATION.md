# Fan alerts and real reach

FanMesh separates two useful but different audience states:

- **Known platform fans** came from official exports or authorized APIs. They show where the creator relationship exists, but they cannot be emailed, texted, or automatically messaged.
- **Directly alertable fans** have active email or SMS consent. They can enter a delivery cohort after the corresponding provider is connected.

## Prepare a fan alert

Open **Activations**, enter the public HTTPS URL for the post or release, choose email and/or SMS, confirm that the destination is controlled by the creator, and select an optional holdout.

FanMesh then:

1. counts identified, platform-only, email-consented, and SMS-consented fans directly from the private workspace;
2. calculates the selected cohort and measurement holdout;
3. generates separate social, email, and SMS links with `utm_source=fanmesh`, a channel `utm_medium`, and a stable `fm_campaign` identifier;
4. saves the activation plan without contact details in the plan payload; and
5. reports whether each channel has an eligible audience and still needs a provider connection.

Preparing a legacy fan alert sends zero messages. The Lead Outreach composer is the launch path: it previews the exact consented cohort, reports provider readiness, and requires a separate explicit send confirmation. Platform-only followers remain a conversion opportunity and never enter email/SMS delivery without direct consent.

## Delivery boundary

Resend email and Twilio SMS adapters are implemented. Before a launch FanMesh re-checks source provenance, active channel consent, a 48-hour frequency cap, workspace authorization, provider readiness, and the 100-recipient beta limit. Delivery receipts reference fan IDs and provider message IDs rather than duplicating contact details. See `docs/LEAD-OUTREACH.md`.
