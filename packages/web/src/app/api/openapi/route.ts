import { NextRequest, NextResponse } from "next/server";

export function GET(request: NextRequest) {
  const schema = {
    openapi: "3.1.0",
    info: {
      title: "Screeem Public API",
      version: "1.0.0",
      description: "Read forms and submissions for a Screeem team.",
    },
    servers: [{ url: new URL("/api/v1", request.url).toString().replace(/\/$/, "") }],
    security: [{ bearerAuth: [] }],
    paths: {
      "/forms": {
        get: {
          operationId: "listForms",
          summary: "List forms",
          responses: {
            "200": {
              description: "Forms belonging to the API key's team",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      data: { type: "array", items: { $ref: "#/components/schemas/Form" } },
                    },
                    required: ["data"],
                  },
                },
              },
            },
            "401": { $ref: "#/components/responses/Unauthorized" },
          },
        },
      },
      "/forms/{formId}/submissions": {
        get: {
          operationId: "listFormSubmissions",
          summary: "List submissions for a form",
          parameters: [
            {
              name: "formId",
              in: "path",
              required: true,
              schema: { type: "string", format: "uuid" },
            },
            {
              name: "limit",
              in: "query",
              schema: { type: "integer", minimum: 1, maximum: 100, default: 50 },
            },
          ],
          responses: {
            "200": {
              description: "Most recent submissions",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      data: {
                        type: "array",
                        items: { $ref: "#/components/schemas/FormSubmission" },
                      },
                    },
                    required: ["data"],
                  },
                },
              },
            },
            "401": { $ref: "#/components/responses/Unauthorized" },
            "404": { description: "Form not found" },
          },
        },
      },
    },
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "API key",
          description: "A public API key created in the Screeem dashboard.",
        },
      },
      responses: {
        Unauthorized: { description: "Missing or invalid public API key" },
      },
      schemas: {
        Form: {
          type: "object",
          properties: {
            id: { type: "string", format: "uuid" },
            name: { type: "string" },
            endpoint_key: { type: "string", format: "uuid" },
            allowed_origin: { type: ["string", "null"], format: "uri" },
            success_url: { type: ["string", "null"], format: "uri" },
            is_active: { type: "boolean" },
            requires_turnstile: { type: "boolean" },
            submission_schema: { type: ["object", "null"], additionalProperties: true },
            created_at: { type: "string", format: "date-time" },
            updated_at: { type: "string", format: "date-time" },
          },
          required: ["id", "name", "endpoint_key", "is_active", "requires_turnstile", "submission_schema", "created_at", "updated_at"],
        },
        FormSubmission: {
          type: "object",
          properties: {
            id: { type: "string", format: "uuid" },
            payload: { type: "object", additionalProperties: true },
            origin: { type: ["string", "null"] },
            user_agent: { type: ["string", "null"] },
            created_at: { type: "string", format: "date-time" },
          },
          required: ["id", "payload", "created_at"],
        },
      },
    },
  };

  return NextResponse.json(schema, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "public, max-age=300",
      "Content-Disposition": 'inline; filename="openapi.json"',
    },
  });
}
