import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

type JsonSchema = {
  type?: "array" | "boolean" | "integer" | "null" | "number" | "object" | "string";
  const?: unknown;
  enum?: unknown[];
  minItems?: number;
  minLength?: number;
  pattern?: string;
  required?: string[];
  properties?: Record<string, JsonSchema>;
  additionalProperties?: boolean;
  items?: JsonSchema;
  oneOf?: JsonSchema[];
};

function validate(value: unknown, schema: JsonSchema, path: string): string[] {
  if (schema.oneOf) {
    const matches = schema.oneOf.filter((candidate) => validate(value, candidate, path).length === 0);
    return matches.length === 1 ? [] : [`${path} must match exactly one allowed schema`];
  }
  if (schema.type) {
    const valid = schema.type === "array" ? Array.isArray(value)
      : schema.type === "null" ? value === null
      : schema.type === "object" ? typeof value === "object" && value !== null && !Array.isArray(value)
      : schema.type === "integer" ? typeof value === "number" && Number.isInteger(value)
      : schema.type === "number" ? typeof value === "number" && Number.isFinite(value)
      : typeof value === schema.type;
    if (!valid) return [`${path} must be ${schema.type}`];
  }
  if ("const" in schema && value !== schema.const) return [`${path} must equal ${String(schema.const)}`];
  if (schema.enum && !schema.enum.includes(value)) return [`${path} must be one of ${schema.enum.join(", ")}`];
  if (typeof value === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength) return [`${path} is too short`];
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) return [`${path} has an invalid format`];
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) return [`${path} has too few items`];
    return value.flatMap((item, index) => schema.items ? validate(item, schema.items, `${path}[${index}]`) : []);
  }
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    const errors = (schema.required ?? [])
      .filter((key) => !(key in record))
      .map((key) => `${path}.${key} is required`);
    if (schema.additionalProperties === false) {
      errors.push(...Object.keys(record).filter((key) => !(key in (schema.properties ?? {})))
        .map((key) => `${path}.${key} is not allowed`));
    }
    for (const [key, propertySchema] of Object.entries(schema.properties ?? {})) {
      if (key in record) errors.push(...validate(record[key], propertySchema, `${path}.${key}`));
    }
    return errors;
  }
  return [];
}

const protocolsPath = new URL("../data/protocols.json", import.meta.url);
const schemaPath = new URL("../data/protocols.schema.json", import.meta.url);
const protocols = JSON.parse(readFileSync(fileURLToPath(protocolsPath), "utf8")) as unknown;
const schema = JSON.parse(readFileSync(fileURLToPath(schemaPath), "utf8")) as JsonSchema;
const errors = validate(protocols, schema, "protocols");
if (errors.length) throw new Error(`Protocol JSON schema validation failed:\n${errors.join("\n")}`);
if (!Array.isArray(protocols)) throw new Error("Protocol data must be an array.");
console.log(`Validated ${protocols.length} protocol drafts against data/protocols.schema.json.`);
