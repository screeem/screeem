import "server-only";

import Ajv, { type ErrorObject } from "ajv";
import addFormats from "ajv-formats";

const MAX_SCHEMA_BYTES = 32 * 1024;
const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);

export type SubmissionSchema = Record<string, unknown>;

export function normalizeSubmissionSchema(value: unknown): SubmissionSchema | null {
  if (value === undefined || value === null || value === "") return null;

  let schema: unknown = value;
  if (typeof value === "string") {
    try {
      schema = JSON.parse(value);
    } catch {
      throw new Error("Submission schema must be valid JSON");
    }
  }

  if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
    throw new Error("Submission schema must be a JSON object");
  }
  if (new TextEncoder().encode(JSON.stringify(schema)).byteLength > MAX_SCHEMA_BYTES) {
    throw new Error("Submission schema must be 32 KB or smaller");
  }

  try {
    ajv.compile(schema);
  } catch (error) {
    throw new Error(error instanceof Error ? `Invalid JSON Schema: ${error.message}` : "Invalid JSON Schema");
  }
  return schema as SubmissionSchema;
}

export function validateSubmission(schema: SubmissionSchema, payload: Record<string, unknown>) {
  const validate = ajv.compile(schema);
  if (validate(payload)) return [];
  return (validate.errors ?? []).map(formatValidationError);
}

function formatValidationError(error: ErrorObject) {
  return {
    path: error.instancePath || "/",
    keyword: error.keyword,
    message: error.message ?? "is invalid",
  };
}
