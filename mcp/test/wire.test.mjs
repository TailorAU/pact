// Wire-level tests: the guard through a REAL McpServer + InMemoryTransport,
// so nothing here can pass by testing arguments the SDK would strip. This is
// the direct product of a review finding: an earlier argument-based check
// (disclosure_level) was dead code at the wire because no tool schema
// declared it and SDK zod validation strips undeclared arguments before the
// guard runs. These tests pin (a) that stripping behaviour, (b) enforcement
// through the transport, and (c) that declared guard-facing arguments reach
// the guard.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import {
  MANDATE_EXTENSION_ID,
  mandateGuard,
  mandateServerOptions,
  resetMandateStateForTests,
} from '../dist/mandate.js';

const EXT = MANDATE_EXTENSION_ID;
const HOUR = 60 * 60 * 1000;

function validMandate(overrides = {}) {
  return {
    version: '1',
    session_id: 'sess_wire',
    agent_id: 'agent_wire',
    handler_principal_id: 'did:web:knox.example',
    disclosure_ceiling: 2,
    expires_at: new Date(Date.now() + HOUR).toISOString(),
    signature: 'base64url-test-signature',
    signing_key_id: 'did:web:knox.example#key-1',
    ...overrides,
  };
}

/** Mirrors the tool() wrapper in src/index.ts — same guard seam, same order. */
async function connectedPair(seenArgs) {
  const server = new McpServer({ name: 'wire-test', version: '0.0.0' }, mandateServerOptions());
  const tool = (name, description, shape, handler) => {
    server.tool(name, description, shape, async (args, extra) => {
      const gate = mandateGuard(name, args ?? {}, extra?._meta);
      if (gate.block) return gate.block;
      return gate.stamp(await handler(args, extra));
    });
  };
  tool(
    'pact_escalate',
    'escalate',
    {
      documentId: z.string(),
      message: z.string(),
      disclosure_level: z.number().int().min(1).max(4).optional(),
    },
    async (args) => {
      seenArgs.push(args);
      return { content: [{ type: 'text', text: 'escalated' }] };
    },
  );
  const client = new Client({ name: 'wire-client', version: '0.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

beforeEach(() => {
  delete process.env.PACT_MANDATE_ENFORCEMENT;
  delete process.env.PACT_MANDATE_REGISTRY;
  resetMandateStateForTests();
});

test('wire: SDK strips undeclared arguments before the guard — argument-based checks only reach declared args', async () => {
  const seen = [];
  const client = await connectedPair(seen);
  const res = await client.callTool({
    name: 'pact_escalate',
    arguments: { documentId: 'd', message: 'm', undeclared_field: 'smuggled' },
  });
  assert.notEqual(res.isError, true);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].undeclared_field, undefined, 'undeclared argument must be stripped by the SDK');
});

test('wire: required mode fails closed through the transport when no mandate is carried', async () => {
  process.env.PACT_MANDATE_ENFORCEMENT = 'required';
  resetMandateStateForTests();
  const seen = [];
  const client = await connectedPair(seen);
  const res = await client.callTool({ name: 'pact_escalate', arguments: { documentId: 'd', message: 'm' } });
  assert.equal(res.isError, true);
  assert.ok(res.content[0].text.includes('MandateRequired'), res.content[0].text);
  assert.equal(seen.length, 0, 'handler must not run');
});

test('wire: mandate in _meta reaches the guard; declared disclosure_level is enforced end-to-end', async () => {
  process.env.PACT_MANDATE_ENFORCEMENT = 'required';
  resetMandateStateForTests();
  const seen = [];
  const client = await connectedPair(seen);
  // Above ceiling → refused at the wire.
  const denied = await client.callTool({
    name: 'pact_escalate',
    arguments: { documentId: 'd', message: 'm', disclosure_level: 3 },
    _meta: { [EXT]: validMandate() },
  });
  assert.equal(denied.isError, true);
  assert.ok(denied.content[0].text.includes('MandateDisclosureExceeded'), denied.content[0].text);
  assert.equal(seen.length, 0);
  // Within ceiling → executes.
  const ok = await client.callTool({
    name: 'pact_escalate',
    arguments: { documentId: 'd', message: 'm', disclosure_level: 2 },
    _meta: { [EXT]: validMandate() },
  });
  assert.notEqual(ok.isError, true, JSON.stringify(ok.content));
  assert.equal(seen.length, 1);
});
