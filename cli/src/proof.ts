import { readFileSync } from 'node:fs';

/**
 * Load a §17.6 authorization_proof envelope from a JSON file.
 *
 * The CLI does NOT sign — signing is the hardware/biometric layer's job
 * (§17.3). The CLI just *carries* a pre-built proof. Typical flow:
 *
 *   1. The hardware/biometric layer (FIDO2 authenticator, voice device,
 *      etc.) produces a signed proof and writes it to a JSON file.
 *   2. The agent invokes a PACT CLI command with `--authorization-proof
 *      <file>`.
 *   3. This helper reads + parses the file; the command threads the
 *      resulting object into the api.ts call, which puts it on the
 *      request body as `authorization_proof`.
 */
export function loadProof(file: string): Record<string, unknown> {
  let raw: string;
  try {
    raw = readFileSync(file, 'utf8');
  } catch (err) {
    throw new Error(`Cannot read authorization-proof file ${file}: ${(err as Error).message}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`authorization-proof file ${file} is not valid JSON: ${(err as Error).message}`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`authorization-proof file ${file} must contain a JSON object (the §17.6 envelope).`);
  }
  return parsed as Record<string, unknown>;
}
