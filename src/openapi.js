export const openApiDocument = {
  openapi: "3.1.0",
  info: {
    title: "FanMesh API",
    version: "0.2.0",
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
        summary: "List supported authorized social and lead sources",
        security: [{ creatorSession: [] }],
        responses: { 200: { description: "Connection capability catalog" } },
      },
    },
    "/score": {
      post: {
        summary: "Calculate an explainable True Fan Score",
        requestBody: { required: true, content: { "application/json": { schema: { type: "object" } } } },
        responses: { 200: { description: "Score result" }, 400: { description: "Invalid JSON body" } },
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
            properties: { rows: { type: "array", maxItems: 1000, items: { type: "object" } } },
          } } },
        },
        responses: { 200: { description: "Import preview" }, 400: { description: "Invalid or unconsented rows" } },
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
