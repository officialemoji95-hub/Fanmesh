# Authorized audience imports

FanMesh accepts creator-owned CSV exports from approved lead forms and official platform export tools. Previewing is read-only. Committing requires a signed-in creator and an explicit confirmation that the records are authorized and that the consent fields are accurate.

Download the in-product template at `/fanmesh-import-template.csv`.

## CSV columns

| Column | Required | Meaning |
| --- | --- | --- |
| `name` | No | Fan display name |
| `email` | Email or phone | Contact email |
| `phone` | Email or phone | Seven to fifteen digits; an international `+` prefix is allowed |
| `location` | No | Creator-provided city or region |
| `sourceId` | No | Lead or export record ID from the authorized source |
| `consent` | Yes | Must be `true` for an accepted direct-contact record |
| `consentAt` | Yes | ISO date or timestamp for the consent event |
| `consentSource` | Yes | Form, campaign, page, or other provenance label |
| `consentChannels` | Sometimes | `email`, `sms`, or `email,sms`; required when both contact methods are present |
| `campaignId` | No | Source campaign identifier |
| `utmSource`, `utmMedium`, `utmCampaign` | No | First-party attribution fields |

The source dropdown records whether the file came from Meta Ads, a Facebook/Instagram/YouTube official export, TikTok Ads, Google Ads, or another first-party consent CSV.

## Import behavior

1. The browser parses the CSV locally and sends structured rows to the preview API.
2. The server validates contact fields, source type, consent timestamp, consent provenance, and direct-contact channels.
3. Deterministic contact keys deduplicate matching rows inside the upload and merge repeat imports into the same workspace fan.
4. FanMesh preserves earlier channels, metrics, and up to 25 recent provenance entries instead of replacing them.
5. Consent events are append-only; an identical event is not written twice.
6. Rejected rows remain outside the database and are shown with row-level reasons.

## Data that must not be imported

- Purchased or scraped lists
- Private follower data obtained outside an official API/export
- Records without explicit direct-contact consent
- Social-media passwords, session cookies, access tokens, or Supabase secrets
- Contacts collected for a purpose that does not permit creator updates

Platform followers who have not opted in remain aggregate reach signals. They cannot be converted into direct-contact identities by FanMesh.
