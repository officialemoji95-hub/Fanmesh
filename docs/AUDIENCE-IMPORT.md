# Authorized audience imports

FanMesh has two import lanes. Official Facebook, Instagram, TikTok, and YouTube data downloads can add platform-only identities from JSON or CSV. Approved lead-form and first-party CSV files can add directly reachable contacts only when their permission provenance is present. Previewing is read-only, and every commit requires a signed-in creator plus an explicit source confirmation.

## Official follower and subscriber downloads

1. Request a JSON or CSV data download inside the platform account you control.
2. Download and unzip the archive on your device. FanMesh does not accept a whole ZIP or ask for the platform password.
3. In **Official data download**, select only the relevant follower, friend, subscriber, commenter, or liker JSON/CSV files. For Instagram, this is commonly a file such as `followers_1.json`.
4. Choose the matching platform and relationship, preview the import, then confirm that the files came from the official download tool.
5. FanMesh processes up to 250,000 identities per import in batches of 2,000 and deduplicates repeat downloads.

An official follower export commonly provides a username, platform ID, profile link, or observation timestamp. FanMesh stores those records as platform identity signals. It does **not** turn them into email, SMS, or automated-DM permission and does not claim that they can be contacted outside the platform.

Download the in-product template at `/fanmesh-import-template.csv`.

## Direct-contact CSV columns

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

The direct-contact source dropdown records whether the file came from Meta Ads, TikTok Ads, Google Ads, or another first-party consent CSV. Social follower downloads belong in the separate platform-identity lane.

## Import behavior

1. The browser parses JSON or CSV locally and sends structured rows to the matching preview API.
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

Platform followers who have not opted in remain named platform signals. They can help the creator understand overlap and invite fans to a first-party opt-in page, but FanMesh does not convert them into direct-contact permission.
