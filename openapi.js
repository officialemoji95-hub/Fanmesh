export const openApiDocument = {
  openapi: "3.1.0",
  info: {
    title: "FanMesh API",
    version: "0.16.0",
    description: "Audience intelligence API for consented fan relationships.",
  },
  servers: [{ url: "/api/v1" }],
  components: {
    securitySchemes: {
      creatorSession: { type: "apiKey", in: "cookie", name: "fanmesh_access" },
    },
  },
  paths: {
    "/auth/session": {
      get: {
        summary: "Get the current creator session and account-mode status",
        responses: { 200: { description: "Session state" } },
      },
    },
    "/auth/signup": {
      post: {
        summary: "Create a Supabase-backed creator account and workspace",
        requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["displayName", "email", "password"] } } } },
        responses: { 201: { description: "Account created" }, 400: { description: "Invalid account input" } },
      },
    },
    "/auth/signin": {
      post: {
        summary: "Sign in and establish secure HTTP-only session cookies",
        requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["email", "password"] } } } },
        responses: { 200: { description: "Authenticated session" }, 401: { description: "Invalid credentials" } },
      },
    },
    "/auth/signout": {
      post: { summary: "Revoke and clear the current session", responses: { 200: { description: "Signed out" } } },
    },
    "/dashboard": {
      get: {
        summary: "Get the signed-in workspace dashboard in one request",
        security: [{ creatorSession: [] }],
        responses: { 200: { description: "Workspace, insights, fans, and connections" }, 401: { description: "Sign-in required" } },
      },
    },
    "/workspace": {
      get: {
        summary: "Get the current private creator workspace",
        security: [{ creatorSession: [] }],
        responses: { 200: { description: "Workspace" }, 401: { description: "Sign-in required" } },
      },
    },
    "/fans": {
      get: {
        summary: "List scored fan records",
        security: [{ creatorSession: [] }],
        parameters: [{ name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 100 } }],
        responses: { 200: { description: "Fan collection" } },
      },
    },
    "/insights": {
      get: {
        summary: "Get audience health and recommendations",
        security: [{ creatorSession: [] }],
        responses: { 200: { description: "Audience insights" } },
      },
    },
    "/connections": {
      get: {
        summary: "List supported authorized sources with safe account, campaign, and performance summaries",
        security: [{ creatorSession: [] }],
        responses: { 200: { description: "Connection capability catalog" } },
      },
    },
    "/oauth/{provider}/start": {
      get: {
        summary: "Start an official platform OAuth authorization",
        security: [{ creatorSession: [] }],
        parameters: [{ name: "provider", in: "path", required: true, schema: { type: "string", enum: ["meta", "tiktok", "snapchat", "youtube", "x", "threads"] } }],
        responses: { 302: { description: "Redirect to the platform consent screen" }, 401: { description: "Sign-in required" }, 503: { description: "Provider developer app not configured" } },
      },
    },
    "/oauth/{provider}/callback": {
      get: {
        summary: "Verify OAuth state, exchange the code server-side, encrypt tokens, and run the initial sync",
        parameters: [{ name: "provider", in: "path", required: true, schema: { type: "string" } }],
        responses: { 302: { description: "Return to the FanMesh Connections screen" } },
      },
    },
    "/oauth/{provider}/sync": {
      post: {
        summary: "Refresh authorized aggregate account and asset metadata",
        security: [{ creatorSession: [] }],
        parameters: [{ name: "provider", in: "path", required: true, schema: { type: "string" } }],
        responses: { 200: { description: "Connection synchronized" }, 401: { description: "Reconnect required" } },
      },
    },
    "/oauth/{provider}/disconnect": {
      delete: {
        summary: "Erase stored platform tokens and mark the connection revoked",
        security: [{ creatorSession: [] }],
        parameters: [{ name: "provider", in: "path", required: true, schema: { type: "string" } }],
        responses: { 200: { description: "Connection revoked" } },
      },
    },
    "/oauth/meta/leads/preview": {
      post: {
        summary: "Fetch and validate selected authorized Meta Instant Form submissions without returning contact fields",
        security: [{ creatorSession: [] }],
        requestBody: { required: true, content: { "application/json": { schema: {
          type: "object",
          required: ["formIds", "consentChannels", "confirmedAuthorized", "confirmedConsent"],
          properties: {
            formIds: { type: "array", maxItems: 10, items: { type: "string" } },
            consentChannels: { type: "array", items: { type: "string", enum: ["email", "sms"] } },
            confirmedAuthorized: { type: "boolean", const: true },
            confirmedConsent: { type: "boolean", const: true },
          },
        } } } },
        responses: { 200: { description: "Safe validation summary with no lead contact fields" }, 400: { description: "Consent confirmation or form selection required" }, 403: { description: "Meta lead permission or asset access missing" } },
      },
    },
    "/oauth/meta/leads/commit": {
      post: {
        summary: "Re-fetch, revalidate, deduplicate, and persist selected consented Meta lead submissions",
        security: [{ creatorSession: [] }],
        requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["formIds", "consentChannels", "confirmedAuthorized", "confirmedConsent"] } } } },
        responses: { 201: { description: "Meta lead import committed with consent provenance" }, 400: { description: "No valid consented records" }, 403: { description: "Meta lead permission or asset access missing" } },
      },
    },
    "/oauth/snapchat/leads/webhooks": {
      post: {
        summary: "Create verified live-lead webhooks for selected authorized Snapchat Lead Generation Forms",
        security: [{ creatorSession: [] }],
        requestBody: { required: true, content: { "application/json": { schema: {
          type: "object",
          required: ["formIds", "consentChannels", "confirmedAuthorized", "confirmedConsent"],
          properties: {
            formIds: { type: "array", minItems: 1, maxItems: 10, items: { type: "string" } },
            consentChannels: { type: "array", minItems: 1, items: { type: "string", enum: ["email", "sms"] } },
            confirmedAuthorized: { type: "boolean", const: true },
            confirmedConsent: { type: "boolean", const: true },
          },
        } } } },
        responses: { 201: { description: "Snapchat live-lead webhook enabled" }, 400: { description: "Form, channel, or consent confirmation missing" }, 403: { description: "Snapchat asset access missing" } },
      },
    },
    "/webhooks/snapchat/leads/{pathKey}": {
      post: {
        summary: "Receive an HMAC-verified Snapchat lead submission and persist its consented contact",
        parameters: [
          { name: "pathKey", in: "path", required: true, schema: { type: "string" } },
          { name: "Signature", in: "header", required: true, schema: { type: "string" } },
          { name: "t", in: "header", required: true, schema: { type: "string" } },
        ],
        responses: { 202: { description: "Lead accepted or duplicate acknowledged without returning contact fields" }, 401: { description: "Signature invalid or expired" }, 403: { description: "Form or ad-account mismatch" } },
      },
    },
    "/score": {
      post: {
        summary: "Calculate an explainable True Fan Score",
        requestBody: { required: true, content: { "application/json": { schema: { type: "object" } } } },
        responses: { 200: { description: "Score result" }, 400: { description: "Invalid JSON body" } },
      },
    },
    "/activations": {
      get: {
        summary: "List recent saved fan-alert activations",
        security: [{ creatorSession: [] }],
        responses: { 200: { description: "Recent activation drafts without contact details" }, 401: { description: "Sign-in required" } },
      },
    },
    "/activations/prepare": {
      post: {
        summary: "Prepare and persist an explainable fan-alert activation",
        security: [{ creatorSession: [] }],
        requestBody: {
          required: true,
          content: { "application/json": { schema: {
            type: "object",
            required: ["title", "contentUrl", "channels", "confirmedOwnedContent"],
            properties: {
              title: { type: "string", minLength: 2, maxLength: 100 },
              contentUrl: { type: "string", format: "uri", description: "Public HTTPS destination controlled by the creator" },
              objective: { type: "string", enum: ["release", "sales", "community", "evergreen"] },
              message: { type: "string", maxLength: 280 },
              channels: { type: "array", minItems: 1, items: { type: "string", enum: ["email", "sms"] } },
              holdoutPercent: { type: "number", minimum: 0, maximum: 25 },
              confirmedOwnedContent: { type: "boolean", const: true },
            },
          } } },
        },
        responses: {
          201: { description: "Activation draft saved with eligibility counts, attribution links, and delivery readiness" },
          400: { description: "Invalid content, channel, or ownership confirmation" },
          401: { description: "Sign-in required" },
        },
      },
    },
    "/outreach/readiness": {
      get: {
        summary: "Report safe email and SMS provider readiness without exposing credentials",
        security: [{ creatorSession: [] }],
        responses: { 200: { description: "Resend and Twilio readiness" }, 401: { description: "Sign-in required in account mode" } },
      },
    },
    "/outreach/campaigns": {
      get: {
        summary: "List recent lead-outreach campaigns without contact fields",
        security: [{ creatorSession: [] }],
        responses: { 200: { description: "Campaign summaries and provider result counts" }, 401: { description: "Sign-in required" } },
      },
    },
    "/outreach/preview": {
      post: {
        summary: "Preview a consented, source-filtered lead cohort without returning contact fields",
        security: [{ creatorSession: [] }],
        requestBody: { required: true, content: { "application/json": { schema: {
          type: "object",
          required: ["title", "contentUrl", "message", "channels", "sources", "confirmedOwnedContent", "confirmedAudienceRights"],
          properties: {
            title: { type: "string", minLength: 2, maxLength: 100 },
            contentUrl: { type: "string", format: "uri" },
            subject: { type: "string", maxLength: 150 },
            message: { type: "string", minLength: 2, maxLength: 500 },
            channels: { type: "array", items: { type: "string", enum: ["email", "sms"] } },
            sources: { type: "array", items: { type: "string", enum: ["meta_ads", "tiktok_ads", "snapchat_ads", "x_ads", "google_ads", "youtube_ads", "threads_ads", "csv"] } },
            holdoutPercent: { type: "number", minimum: 0, maximum: 25 },
            confirmedOwnedContent: { type: "boolean", const: true },
            confirmedAudienceRights: { type: "boolean", const: true },
          },
        } } } },
        responses: { 200: { description: "Private cohort counts, tracking links, and provider readiness" }, 400: { description: "Invalid or unconfirmed outreach" }, 401: { description: "Sign-in required" } },
      },
    },
    "/outreach/send": {
      post: {
        summary: "Revalidate the cohort, send through configured providers, and persist delivery receipts",
        security: [{ creatorSession: [] }],
        requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["campaignId", "confirmedSend"] } } } },
        responses: { 201: { description: "Launch completed or partially completed with safe counts" }, 409: { description: "Provider missing, cohort empty, or campaign already submitted" }, 401: { description: "Sign-in required" } },
      },
    },
    "/organic/posts": {
      get: {
        summary: "Rank recent authorized Instagram, TikTok, YouTube, X, and Threads posts for an organic follow-up",
        security: [{ creatorSession: [] }],
        responses: {
          200: { description: "Recent posts with explainable opportunity components and current organic baselines" },
          401: { description: "Sign-in required" },
        },
      },
    },
    "/content-mesh": {
      get: {
        summary: "Match creator-owned content across connected platforms and explain organic performance gaps",
        security: [{ creatorSession: [] }],
        responses: {
          200: { description: "Cross-platform content groups, per-platform benchmark indexes, and native recovery recommendations with paid delivery excluded" },
          401: { description: "Sign-in required" },
        },
      },
    },
    "/organic/activate": {
      post: {
        summary: "Capture a recent post's organic baseline and save a follow-up activation",
        security: [{ creatorSession: [] }],
        requestBody: {
          required: true,
          content: { "application/json": { schema: {
            type: "object",
            required: ["postKey"],
            properties: {
              postKey: { type: "string", description: "Opaque key returned by GET /organic/posts" },
              objective: { type: "string", enum: ["release", "sales", "community", "evergreen"] },
              message: { type: "string", maxLength: 280 },
              channels: { type: "array", items: { type: "string", enum: ["email", "sms"] } },
              holdoutPercent: { type: "number", minimum: 0, maximum: 25 },
            },
          } } },
        },
        responses: {
          201: { description: "Organic baseline and activation saved; no messages sent" },
          404: { description: "Post not present in the latest authorized sync" },
          409: { description: "Instagram or TikTok connection required" },
        },
      },
    },
    "/campaigns/recommend": {
      post: {
        summary: "Create a compliant activation sequence",
        requestBody: { content: { "application/json": { schema: { type: "object" } } } },
        responses: { 200: { description: "Campaign playbook" } },
      },
    },
    "/imports/leads/preview": {
      post: {
        summary: "Validate a consented ad-lead import without persisting it",
        requestBody: {
          required: true,
          content: { "application/json": { schema: {
            type: "object",
            required: ["rows"],
            properties: {
              source: { type: "string", enum: ["meta_ads", "tiktok_ads", "snapchat_ads", "x_ads", "google_ads", "youtube_ads", "threads_ads", "csv"] },
              rows: { type: "array", maxItems: 1000, items: { type: "object" } },
              confirmedAuthorized: { type: "boolean" },
              confirmedConsent: { type: "boolean" },
              consentChannels: { type: "array", items: { type: "string", enum: ["email", "sms"] } },
            },
          } } },
        },
        responses: { 200: { description: "Import preview" }, 400: { description: "Invalid or unconsented rows" } },
      },
    },
    "/imports/leads/commit": {
      post: {
        summary: "Revalidate and commit authorized audience records to the signed-in workspace",
        security: [{ creatorSession: [] }],
        requestBody: {
          required: true,
          content: { "application/json": { schema: { type: "object", required: ["source", "rows", "confirmedAuthorized"] } } },
        },
        responses: { 201: { description: "Import completed" }, 400: { description: "Invalid, unconfirmed, or unconsented records" }, 401: { description: "Sign-in required" } },
      },
    },
    "/imports/identities/preview": {
      post: {
        summary: "Validate a batch from an official platform data download without granting direct-contact consent",
        security: [{ creatorSession: [] }],
        requestBody: {
          required: true,
          content: { "application/json": { schema: {
            type: "object",
            required: ["source", "relationship", "rows"],
            properties: {
              source: { type: "string", enum: ["facebook_export", "instagram_export", "tiktok_export", "youtube_export"] },
              relationship: { type: "string", enum: ["follower", "friend", "subscriber", "commenter", "liker", "viewer"] },
              rows: { type: "array", maxItems: 2000, items: { type: "object" } },
            },
          } } },
        },
        responses: { 200: { description: "Platform-only identity import preview" }, 400: { description: "Invalid export records" }, 401: { description: "Sign-in required in account mode" } },
      },
    },
    "/imports/identities/commit": {
      post: {
        summary: "Commit an authorized official-export batch as platform-only identities",
        security: [{ creatorSession: [] }],
        requestBody: {
          required: true,
          content: { "application/json": { schema: {
            type: "object",
            required: ["source", "relationship", "rows", "confirmedAuthorized", "confirmedOfficialExport"],
            properties: {
              source: { type: "string", enum: ["facebook_export", "instagram_export", "tiktok_export", "youtube_export"] },
              relationship: { type: "string" },
              rows: { type: "array", maxItems: 2000, items: { type: "object" } },
              confirmedAuthorized: { type: "boolean", const: true },
              confirmedOfficialExport: { type: "boolean", const: true },
              finalBatch: { type: "boolean", description: "Refresh the aggregate audience snapshot after the last batch" },
            },
          } } },
        },
        responses: { 201: { description: "Platform identities saved without direct-contact consent" }, 400: { description: "Confirmation or valid identities required" }, 401: { description: "Sign-in required" } },
      },
    },
    "/experiments/social": {
      post: {
        summary: "Build a measured social distribution experiment",
        requestBody: { content: { "application/json": { schema: {
          type: "object",
          properties: {
            contentId: { type: "string" },
            objective: { type: "string", enum: ["release", "sales", "community", "evergreen"] },
            platforms: { type: "array", items: { type: "string" } },
            channels: { type: "array", items: { type: "string", enum: ["native_social", "consented_direct", "authorized_ads"] } },
            holdoutPercent: { type: "number", minimum: 0, maximum: 50 },
          },
        } } } },
        responses: { 200: { description: "Social experiment draft" } },
      },
    },
  },
};
