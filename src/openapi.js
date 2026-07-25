export const openApiDocument = {
  openapi: "3.1.0",
  info: {
    title: "FanMesh API",
    version: "0.1.0",
    description: "Audience intelligence API for consented fan relationships.",
  },
  servers: [{ url: "/api/v1" }],
  paths: {
    "/fans": {
      get: {
        summary: "List scored fan records",
        parameters: [{ name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 100 } }],
        responses: { 200: { description: "Fan collection" } },
      },
    },
    "/insights": {
      get: {
        summary: "Get audience health and recommendations",
        responses: { 200: { description: "Audience insights" } },
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
  },
};
