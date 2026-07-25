# Security, privacy, and platform integrity

## Data acquisition

Only ingest data through creator-authorized official APIs, documented webhooks, user-provided exports, and fan-submitted forms. If a platform does not provide a supported capability, FanMesh must disable that connection or use a clearly documented export workflow—not scrape around the restriction.

## Identity resolution

- Prefer explicit fan confirmation and verified contact points.
- Hash normalized matching keys and encrypt recoverable personal data at rest.
- Store every source, timestamp, consent purpose, and merge confidence.
- Require review for uncertain merges and provide an unmerge path.
- Never infer sensitive categories for scoring or targeting.

## Activation safety

- Require channel-specific opt-in before direct delivery.
- Apply quiet hours, unsubscribe handling, suppression lists, and frequency caps.
- Exclude purchased lists and unverified third-party contacts.
- Do not automate fake streams, likes, follows, comments, or coordinated deception.
- Do not promise guaranteed placement in a recommendation feed.

## Production controls

- Least-privilege OAuth scopes and encrypted token storage
- Short-lived sessions, secure cookies, CSRF protection, and passkeys where possible
- Tenant isolation with database policies and authorization tests
- Signed imports and webhooks, rate limiting, replay protection, and idempotency
- Audit logs for data access and high-impact mutations
- Self-service access, correction, export, deletion, and consent withdrawal
- Incident response and token revocation procedures
