/* Thin wrapper around ajv that loads the v1 schema set on demand and
 * resolves cross-schema $refs (records.json#/$defs/record from
 * record-by-id.json).  Each schema is loaded once per process; ajv
 * compiles on first use and caches the validator function.
 *
 * One ajv instance per process — matches Playwright's worker model
 * where every spec file shares one parent process by default. */
import Ajv from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import * as fs from 'node:fs';
import * as path from 'node:path';

const SCHEMA_DIR = path.join(__dirname, '..', '..', 'docs', 'api-schemas', 'v1');

let _ajv: Ajv | null = null;

function getAjv(): Ajv {
  if (_ajv) return _ajv;
  const ajv = new Ajv({ allErrors: true, strict: false, allowUnionTypes: true });
  addFormats(ajv as any);
  // Register every schema file by its $id so cross-schema $ref works.
  for (const file of fs.readdirSync(SCHEMA_DIR)) {
    if (!file.endsWith('.json')) continue;
    const full = path.join(SCHEMA_DIR, file);
    const schema = JSON.parse(fs.readFileSync(full, 'utf8'));
    ajv.addSchema(schema, file);  // key by filename so {$ref: "records.json#/$defs/record"} resolves.
  }
  _ajv = ajv;
  return ajv;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export function validate(schemaFile: string, payload: unknown): ValidationResult {
  const ajv = getAjv();
  const validator = ajv.getSchema(schemaFile);
  if (!validator) {
    return { valid: false, errors: [`schema not found: ${schemaFile}`] };
  }
  const ok = validator(payload);
  if (ok) return { valid: true, errors: [] };
  const errors = (validator.errors ?? []).map(e => {
    const pathStr = e.instancePath || '(root)';
    return `${pathStr} ${e.message ?? ''} ${e.params ? JSON.stringify(e.params) : ''}`.trim();
  });
  return { valid: false, errors };
}
