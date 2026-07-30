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

Preparing a fan alert sends zero messages. Until delivery adapters are implemented, the creator can copy the attribution links into permitted publishing and messaging tools. Platform-only followers remain a conversion opportunity: use the social link in a bio, Story, description, or pinned post where supported to invite voluntary direct opt-in.

## Delivery boundary

The next delivery milestone needs a provider such as a verified email service and, optionally, a compliant SMS service. Before a worker sends anything it must re-check active consent, suppression status, frequency caps, and workspace authorization. The delivery queue should reference fan IDs rather than duplicating contact details.
