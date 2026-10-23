import { randomBytes } from "node:crypto";

import {
  ProviderError,
  Secret,
  type MailMessage,
  type RateLimitDecision,
  type SyncMailPayload,
} from "@bystro/core";
import {
  createDb,
  forOrganization,
  getConnection,
  listMailMessages,
  readConnectionTokens,
  saveConnection,
  type ConnectionTokens,
} from "@bystro/db";
import { createTestOrganization, loadRootEnv, readTestDatabase } from "@bystro/db/testing";
import type { MailboxReader, OAuthProviderConfig } from "@bystro/integrations";
import { UnrecoverableError } from "bullmq";
import { afterAll, describe, expect, it } from "vitest";

import { RateLimitedError, type RateLimiter } from "../rate-limiter";
import { silentLogger } from "../test/redis";
import { dispatchMailSyncHandler } from "./dispatch-mail-sync";
import { syncMailHandler, type MailboxSetup } from "./sync-mail";

loadRootEnv();
const { db, close } = createDb(readTestDatabase().url);
const key = randomBytes(32);
const NOW = new Date("2026-10-24T08:00:00Z");

afterAll(async () => {
  await close();
});

const message = (id: string): MailMessage => ({
  source: "gmail",
  externalId: id,
  threadExternalId: `t-${id}`,
  historyId: null,
  receivedAt: new Date("2026-10-22T10:00:00Z"),
  labels: ["INBOX", "UNREAD"],
  from: { name: "Jana Nová", address: "jana@example.test" },
  to: [],
  cc: [],
  subject: "Tajný předmět",
  messageIdHeader: null,
  inReplyTo: null,
  references: [],
  snippet: "tajný úryvek",
  bodyText: "tajný text",
  hasAttachments: false,
});

/** A mailbox with two messages in Doručené; every call reports its quota cost first. */
function fakeMailbox(
  onRequest: (cost: number) => Promise<void>,
  fail?: () => Error,
): MailboxReader {
  const messages = [message("m1"), message("m2")];
  const call = async (cost: number) => {
    await onRequest(cost);
    const error = fail?.();
    if (error !== undefined) throw error;
  };
  return {
    source: "gmail",
    async currentHistoryId() {
      await call(1);
      return "900";
    },
    async listMessageIds(label) {
      await call(5);
      return {
        ids: label === "INBOX" || label === "UNREAD" ? messages.map((item) => item.externalId) : [],
        nextPageToken: null,
      };
    },
    async getMessage(id) {
      await call(60);
      return messages.find((item) => item.externalId === id) ?? null;
    },
    async listChanges() {
      await call(2);
      return { records: [], nextPageToken: null, historyId: "900" };
    },
  };
}

const openLimiter: RateLimiter = {
  acquire: async (): Promise<RateLimitDecision> => ({ allowed: true, retryAfterMs: 0 }),
  require: async () => {},
};

const oauth: OAuthProviderConfig = {
  id: "gmail",
  authorizationEndpoint: "https://accounts.example/o/oauth2/v2/auth",
  tokenEndpoint: "https://oauth2.example/token",
  clientId: "client-id",
  clientSecret: new Secret("client-secret"),
  scopes: [],
  pkce: "S256",
  clientAuthentication: "body",
};

async function connected(tokens: Partial<ConnectionTokens> = {}) {
  const { organization, owner } = await createTestOrganization(db, "Firma s poštou");
  const connection = await saveConnection(
    db,
    organization.id,
    {
      provider: "gmail",
      category: "email",
      externalAccountId: "petr@dvorak.test",
      scopes: [],
      tokens: {
        accessToken: new Secret("access-old"),
        refreshToken: new Secret("refresh-keep"),
        expiresAt: null,
        ...tokens,
      },
      userId: owner.id,
      source: "web",
    },
    key,
  );
  const data: SyncMailPayload = {
    organizationId: organization.id,
    connectionId: connection.id,
    mode: "incremental",
  };
  return { data, organizationId: organization.id, connectionId: connection.id };
}

interface RunOptions {
  limiter?: RateLimiter;
  setup?: Partial<MailboxSetup> | null;
  fetch?: typeof fetch;
  fail?: () => Error;
  usedTokens?: ConnectionTokens[];
  sleeps?: number[];
}

function run(data: SyncMailPayload, options: RunOptions = {}) {
  const handler = syncMailHandler({
    db,
    encryptionKey: key,
    rateLimiter: options.limiter ?? openLimiter,
    now: () => NOW,
    sleep: async (ms) => {
      options.sleeps?.push(ms);
    },
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    resolveMailbox: () =>
      options.setup === null
        ? null
        : {
            oauth,
            rateLimit: { key: "gmail.mailbox", limit: { max: 6_000, windowMs: 60_000 } },
            create: (tokens, onRequest) => {
              options.usedTokens?.push(tokens);
              return fakeMailbox(onRequest, options.fail);
            },
            ...options.setup,
          },
  });
  return handler({ data, jobId: "job-1", attempt: 1, logger: silentLogger });
}

const statusOf = async (organizationId: string, connectionId: string) =>
  (await getConnection(db, organizationId, connectionId))?.status;

describe("syncMailHandler", () => {
  it("syncs the mailbox, marks the connection connected and audits counts only", async () => {
    const { data, organizationId, connectionId } = await connected();
    await run(data);

    expect(await statusOf(organizationId, connectionId)).toBe("connected");
    expect(await listMailMessages(db, { organizationId, connectionId }, key)).toHaveLength(2);
    const audit = await forOrganization(db, organizationId).listAuditLogs();
    const synced = audit.find((entry) => entry.action === "mail.synced");
    expect(synced).toMatchObject({
      actorType: "system",
      source: "worker",
      targetId: connectionId,
      metadata: { provider: "gmail", mode: "full", messagesCreated: 2, messagesDeleted: 0 },
    });
    expect(JSON.stringify(audit)).not.toMatch(/tajn|jana@example|petr@dvorak|access-old/);

    // Running it again adds nothing.
    await run(data);
    expect(await listMailMessages(db, { organizationId, connectionId }, key)).toHaveLength(2);
  });

  it("refreshes an expiring access token before reading the mailbox", async () => {
    const { data, organizationId, connectionId } = await connected({
      expiresAt: new Date("2026-10-24T08:02:00Z"),
    });
    const fetchFn = (async () =>
      Response.json({
        access_token: "access-new",
        token_type: "Bearer",
        expires_in: 3599,
      })) as typeof fetch;
    const usedTokens: ConnectionTokens[] = [];

    await run(data, { fetch: fetchFn, usedTokens });

    expect(usedTokens[0]?.accessToken.reveal()).toBe("access-new");
    const stored = await readConnectionTokens(db, organizationId, connectionId, key);
    expect(stored?.refreshToken?.reveal()).toBe("refresh-keep");
  });

  it("asks to reconnect when Google refuses the refresh token (7 days in testing mode)", async () => {
    const { data, organizationId, connectionId } = await connected({
      expiresAt: new Date("2026-10-24T07:00:00Z"),
    });
    const fetchFn = (async () =>
      Response.json({ error: "invalid_grant" }, { status: 400 })) as typeof fetch;

    await expect(run(data, { fetch: fetchFn })).rejects.toBeInstanceOf(UnrecoverableError);
    expect(await statusOf(organizationId, connectionId)).toBe("reauth_required");
    // A connection waiting for the user is skipped quietly afterwards.
    await expect(run(data)).resolves.toBeUndefined();
  });

  it("waits for the per-minute quota inside the job instead of failing", async () => {
    const { data, organizationId, connectionId } = await connected();
    const costs: number[] = [];
    let refusals = 2;
    const limiter: RateLimiter = {
      acquire: async (_key, _limit, cost) => {
        costs.push(cost ?? 1);
        if (refusals > 0) {
          refusals -= 1;
          return { allowed: false, retryAfterMs: 20_000 };
        }
        return { allowed: true, retryAfterMs: 0 };
      },
      require: async () => {},
    };
    const sleeps: number[] = [];

    await run(data, { limiter, sleeps });

    expect(sleeps).toEqual([20_000, 20_000]);
    expect(costs).toContain(60);
    expect(await listMailMessages(db, { organizationId, connectionId }, key)).toHaveLength(2);
  });

  it("is put back when the quota stays used up for too long", async () => {
    const { data, organizationId, connectionId } = await connected();
    const limiter: RateLimiter = {
      acquire: async () => ({ allowed: false, retryAfterMs: 60_000 }),
      require: async () => {},
    };
    await expect(run(data, { limiter })).rejects.toBeInstanceOf(RateLimitedError);
    expect(await statusOf(organizationId, connectionId)).toBe("degraded");
  });

  it("marks a temporary outage as degraded and retries", async () => {
    const { data, organizationId, connectionId } = await connected();
    await expect(
      run(data, { fail: () => new ProviderError("provider_unavailable") }),
    ).rejects.toBeInstanceOf(ProviderError);
    expect(await statusOf(organizationId, connectionId)).toBe("degraded");
  });

  it("fails clearly when Gmail is not configured in this environment", async () => {
    const { data, organizationId, connectionId } = await connected();
    await expect(run(data, { setup: null })).rejects.toBeInstanceOf(UnrecoverableError);
    expect((await getConnection(db, organizationId, connectionId))?.lastErrorCode).toBe(
      "provider_not_configured",
    );
  });
});

describe("dispatchMailSyncHandler", () => {
  it("enqueues one sync per mailbox and five-minute slot", async () => {
    const jobs: { data: SyncMailPayload; jobId: string }[] = [];
    const seen = new Set<string>();
    const handler = dispatchMailSyncHandler({
      listTargets: async () => [
        {
          organizationId: "6f1c1c6e-8c55-4f39-9a63-0d6b8b1f6d01",
          connectionId: "0b9f7f2e-3a8c-4d6e-9f5b-2c1d4e6f8a90",
          provider: "gmail",
        },
      ],
      enqueue: async (data, jobId) => {
        if (seen.has(jobId)) return false;
        seen.add(jobId);
        jobs.push({ data, jobId });
        return true;
      },
      now: () => new Date("2026-10-24T08:07:30Z"),
    });
    const context = { jobId: "d", attempt: 1, logger: silentLogger };
    await handler({ ...context, data: { mode: "incremental" } });
    await handler({ ...context, data: { mode: "incremental" } });

    expect(jobs).toEqual([
      {
        data: {
          organizationId: "6f1c1c6e-8c55-4f39-9a63-0d6b8b1f6d01",
          connectionId: "0b9f7f2e-3a8c-4d6e-9f5b-2c1d4e6f8a90",
          mode: "incremental",
        },
        jobId: "sync.mail.0b9f7f2e-3a8c-4d6e-9f5b-2c1d4e6f8a90.incremental.2026-10-24T08-05",
      },
    ]);
  });
});
