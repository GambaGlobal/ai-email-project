import Fastify from "fastify";
import { GoogleAuth } from "google-auth-library";

function buildAdminRedirect(adminBaseUrl: string, status: "gmail" | "error"): string {
  const redirect = new URL("/onboarding", adminBaseUrl);
  redirect.searchParams.set("connected", status);
  return redirect.toString();
}

function asSingle(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) {
    return typeof value[0] === "string" ? value[0] : null;
  }
  return typeof value === "string" ? value : null;
}

function appendQueryParams(
  targetUrl: URL,
  query: Record<string, string | string[] | undefined>
): void {
  for (const [key, rawValue] of Object.entries(query)) {
    if (typeof rawValue === "string") {
      targetUrl.searchParams.append(key, rawValue);
      continue;
    }

    if (Array.isArray(rawValue)) {
      for (const item of rawValue) {
        if (typeof item === "string") {
          targetUrl.searchParams.append(key, item);
        }
      }
    }
  }
}

function readConfiguredEnv(
  preferredName: "API_PUBLIC_URL" | "ADMIN_PUBLIC_URL",
  aliasName: "API_BASE_URL" | "ADMIN_BASE_URL"
): string | null {
  const preferred = process.env[preferredName]?.trim();
  if (preferred) {
    return preferred;
  }

  const alias = process.env[aliasName]?.trim();
  return alias || null;
}

function readTenantIdHeader(headers: Record<string, string | string[] | undefined>): string | null {
  const raw = headers["x-tenant-id"];
  if (typeof raw === "string" && raw.trim()) {
    return raw.trim();
  }
  if (Array.isArray(raw)) {
    for (const value of raw) {
      if (typeof value === "string" && value.trim()) {
        return value.trim();
      }
    }
  }
  return null;
}

function readOriginHeader(headers: Record<string, string | string[] | undefined>): string | null {
  const raw = headers.origin;
  if (typeof raw === "string" && raw.trim()) {
    return raw.trim();
  }
  if (Array.isArray(raw)) {
    for (const value of raw) {
      if (typeof value === "string" && value.trim()) {
        return value.trim();
      }
    }
  }
  return null;
}

function normalizeBaseUrl(rawUrl: string): string | null {
  const withScheme = /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`;
  try {
    const parsed = new URL(withScheme);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return null;
    }
    return parsed.origin;
  } catch {
    return null;
  }
}

function resolveAllowedOrigin(headers: Record<string, string | string[] | undefined>): string | null {
  const origin = readOriginHeader(headers);
  if (!origin) {
    return null;
  }

  const rawAdminBaseUrl = readConfiguredEnv("ADMIN_PUBLIC_URL", "ADMIN_BASE_URL");
  if (!rawAdminBaseUrl) {
    return null;
  }

  const adminOrigin = normalizeBaseUrl(rawAdminBaseUrl);
  if (!adminOrigin) {
    return null;
  }

  return origin === adminOrigin ? origin : null;
}

function applyCorsHeaders(reply: { header: (name: string, value: string) => unknown }, origin: string): void {
  reply.header("Vary", "Origin");
  reply.header("Access-Control-Allow-Origin", origin);
  reply.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  reply.header("Access-Control-Allow-Headers", "x-tenant-id, content-type");
}

async function parseOAuthStartUrl(response: Response): Promise<string | null> {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    return null;
  }

  try {
    const payload = (await response.json()) as { url?: unknown; authUrl?: unknown };
    const candidate =
      typeof payload.url === "string"
        ? payload.url
        : typeof payload.authUrl === "string"
          ? payload.authUrl
          : null;
    if (!candidate) {
      return null;
    }

    const parsed = new URL(candidate);
    return parsed.toString();
  } catch {
    return null;
  }
}

async function main() {
  const auth = new GoogleAuth();

  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? "info"
    }
  });

  app.get<{ Querystring: { code?: string | string[]; state?: string | string[]; error?: string | string[] } }>(
    "/v1/auth/gmail/callback",
    async (request, reply) => {
      const rawAdminBaseUrl = readConfiguredEnv("ADMIN_PUBLIC_URL", "ADMIN_BASE_URL");
      const rawApiBaseUrl = readConfiguredEnv("API_PUBLIC_URL", "API_BASE_URL");
      const adminBaseUrl = rawAdminBaseUrl ? normalizeBaseUrl(rawAdminBaseUrl) : null;
      const apiBaseUrl = rawApiBaseUrl ? normalizeBaseUrl(rawApiBaseUrl) : null;

      if (!adminBaseUrl || !apiBaseUrl) {
        request.log.error(
          {
            adminConfigured: Boolean(rawAdminBaseUrl),
            apiConfigured: Boolean(rawApiBaseUrl),
            adminUrlValid: Boolean(adminBaseUrl),
            apiUrlValid: Boolean(apiBaseUrl)
          },
          "gmail oauth callback bridge: missing or invalid bridge base URLs"
        );
        if (!adminBaseUrl) {
          return reply.code(500).send({ error: "OAuth bridge misconfigured" });
        }
        return reply.redirect(302, buildAdminRedirect(adminBaseUrl, "error"));
      }

      const code = asSingle(request.query.code);
      const state = asSingle(request.query.state);
      const oauthError = asSingle(request.query.error);

      if (oauthError || !code || !state) {
        request.log.info("gmail oauth callback bridge: invalid callback payload");
        return reply.redirect(302, buildAdminRedirect(adminBaseUrl, "error"));
      }

      try {
        const idTokenClient = await auth.getIdTokenClient(apiBaseUrl);
        const tokenHeaders = await idTokenClient.getRequestHeaders(apiBaseUrl);

        const privateCallback = new URL("/v1/auth/gmail/callback", apiBaseUrl);
        privateCallback.searchParams.set("code", code);
        privateCallback.searchParams.set("state", state);

        const response = await fetch(privateCallback.toString(), {
          method: "GET",
          headers: {
            Authorization: String(tokenHeaders.Authorization ?? "")
          }
        });

        if (response.ok) {
          request.log.info("gmail oauth callback bridge: private callback succeeded");
          return reply.redirect(302, buildAdminRedirect(adminBaseUrl, "gmail"));
        }

        request.log.warn(
          { statusCode: response.status },
          "gmail oauth callback bridge: private callback failed"
        );
        return reply.redirect(302, buildAdminRedirect(adminBaseUrl, "error"));
      } catch (error) {
        request.log.error({ error }, "gmail oauth callback bridge: forwarding failed");
        return reply.redirect(302, buildAdminRedirect(adminBaseUrl, "error"));
      }
    }
  );

  app.get<{ Querystring: Record<string, string | string[] | undefined> }>(
    "/v1/auth/gmail/start",
    async (request, reply) => {
      const rawAdminBaseUrl = readConfiguredEnv("ADMIN_PUBLIC_URL", "ADMIN_BASE_URL");
      const rawApiBaseUrl = readConfiguredEnv("API_PUBLIC_URL", "API_BASE_URL");
      const adminBaseUrl = rawAdminBaseUrl ? normalizeBaseUrl(rawAdminBaseUrl) : null;
      const apiBaseUrl = rawApiBaseUrl ? normalizeBaseUrl(rawApiBaseUrl) : null;

      if (!adminBaseUrl || !apiBaseUrl) {
        request.log.error(
          {
            adminConfigured: Boolean(rawAdminBaseUrl),
            apiConfigured: Boolean(rawApiBaseUrl),
            adminUrlValid: Boolean(adminBaseUrl),
            apiUrlValid: Boolean(apiBaseUrl)
          },
          "gmail oauth start bridge: missing or invalid bridge base URLs"
        );
        if (!adminBaseUrl) {
          return reply.code(500).send({ error: "OAuth bridge misconfigured" });
        }
        return reply.redirect(302, buildAdminRedirect(adminBaseUrl, "error"));
      }

      try {
        const idTokenClient = await auth.getIdTokenClient(apiBaseUrl);
        const tokenHeaders = await idTokenClient.getRequestHeaders(apiBaseUrl);

        const privateStart = new URL("/v1/auth/gmail/start", apiBaseUrl);
        appendQueryParams(privateStart, request.query);

        const response = await fetch(privateStart.toString(), {
          method: "GET",
          headers: {
            Authorization: String(tokenHeaders.Authorization ?? "")
          },
          redirect: "manual"
        });

        const location = response.headers.get("location");
        if (location && response.status >= 300 && response.status < 400) {
          request.log.info("gmail oauth start bridge: private start redirect forwarded");
          return reply.redirect(302, location);
        }

        if (response.ok) {
          const authUrl = await parseOAuthStartUrl(response);
          if (authUrl) {
            request.log.info("gmail oauth start bridge: private start JSON url forwarded");
            return reply.redirect(302, authUrl);
          }
        }

        request.log.warn(
          {
            statusCode: response.status,
            hasLocationHeader: Boolean(location)
          },
          "gmail oauth start bridge: upstream response did not include redirectable auth URL"
        );
        return reply.redirect(302, buildAdminRedirect(adminBaseUrl, "error"));
      } catch (error) {
        request.log.error({ error }, "gmail oauth start bridge: forwarding failed");
        return reply.redirect(302, buildAdminRedirect(adminBaseUrl, "error"));
      }
    }
  );

  app.get<{ Querystring: Record<string, string | string[] | undefined> }>(
    "/v1/mail/gmail/connection",
    async (request, reply) => {
      const allowedOrigin = resolveAllowedOrigin(request.headers);
      if (allowedOrigin) {
        applyCorsHeaders(reply, allowedOrigin);
      }

      const rawApiBaseUrl = readConfiguredEnv("API_PUBLIC_URL", "API_BASE_URL");
      const apiBaseUrl = rawApiBaseUrl ? normalizeBaseUrl(rawApiBaseUrl) : null;
      const tenantId = readTenantIdHeader(request.headers);

      if (!tenantId) {
        return reply.code(400).send({ error: "Missing tenant context. Send x-tenant-id header." });
      }

      if (!apiBaseUrl) {
        request.log.error(
          { apiConfigured: Boolean(rawApiBaseUrl), apiUrlValid: Boolean(apiBaseUrl) },
          "gmail connection proxy: missing or invalid API base URL"
        );
        return reply.code(500).send({ error: "OAuth bridge misconfigured" });
      }

      try {
        const idTokenClient = await auth.getIdTokenClient(apiBaseUrl);
        const tokenHeaders = await idTokenClient.getRequestHeaders(apiBaseUrl);

        const privateUrl = new URL("/v1/mail/gmail/connection", apiBaseUrl);
        appendQueryParams(privateUrl, request.query);

        const response = await fetch(privateUrl.toString(), {
          method: "GET",
          headers: {
            Authorization: String(tokenHeaders.Authorization ?? ""),
            "x-tenant-id": tenantId
          }
        });

        const contentType = response.headers.get("content-type");
        const payload = await response.text();
        if (contentType) {
          reply.header("content-type", contentType);
        }
        return reply.code(response.status).send(payload);
      } catch (error) {
        request.log.error({ error }, "gmail connection proxy: forwarding failed");
        return reply.code(502).send({ error: "Unable to reach private API" });
      }
    }
  );

  app.post<{ Querystring: Record<string, string | string[] | undefined> }>(
    "/v1/mail/gmail/disconnect",
    async (request, reply) => {
      const allowedOrigin = resolveAllowedOrigin(request.headers);
      if (allowedOrigin) {
        applyCorsHeaders(reply, allowedOrigin);
      }

      const rawApiBaseUrl = readConfiguredEnv("API_PUBLIC_URL", "API_BASE_URL");
      const apiBaseUrl = rawApiBaseUrl ? normalizeBaseUrl(rawApiBaseUrl) : null;
      const tenantId = readTenantIdHeader(request.headers);

      if (!tenantId) {
        return reply.code(400).send({ error: "Missing tenant context. Send x-tenant-id header." });
      }

      if (!apiBaseUrl) {
        request.log.error(
          { apiConfigured: Boolean(rawApiBaseUrl), apiUrlValid: Boolean(apiBaseUrl) },
          "gmail disconnect proxy: missing or invalid API base URL"
        );
        return reply.code(500).send({ error: "OAuth bridge misconfigured" });
      }

      try {
        const idTokenClient = await auth.getIdTokenClient(apiBaseUrl);
        const tokenHeaders = await idTokenClient.getRequestHeaders(apiBaseUrl);

        const privateUrl = new URL("/v1/mail/gmail/disconnect", apiBaseUrl);
        appendQueryParams(privateUrl, request.query);

        const response = await fetch(privateUrl.toString(), {
          method: "POST",
          headers: {
            Authorization: String(tokenHeaders.Authorization ?? ""),
            "x-tenant-id": tenantId
          }
        });

        const contentType = response.headers.get("content-type");
        const payload = await response.text();
        if (contentType) {
          reply.header("content-type", contentType);
        }
        return reply.code(response.status).send(payload);
      } catch (error) {
        request.log.error({ error }, "gmail disconnect proxy: forwarding failed");
        return reply.code(502).send({ error: "Unable to reach private API" });
      }
    }
  );

  app.get<{ Querystring: Record<string, string | string[] | undefined> }>(
    "/v1/docs",
    async (request, reply) => {
      const allowedOrigin = resolveAllowedOrigin(request.headers);
      if (allowedOrigin) {
        applyCorsHeaders(reply, allowedOrigin);
      }

      const rawApiBaseUrl = readConfiguredEnv("API_PUBLIC_URL", "API_BASE_URL");
      const apiBaseUrl = rawApiBaseUrl ? normalizeBaseUrl(rawApiBaseUrl) : null;
      const tenantId = readTenantIdHeader(request.headers);

      if (!tenantId) {
        return reply.code(400).send({ error: "Missing tenant context. Send x-tenant-id header." });
      }

      if (!apiBaseUrl) {
        request.log.error(
          { apiConfigured: Boolean(rawApiBaseUrl), apiUrlValid: Boolean(apiBaseUrl) },
          "docs proxy: missing or invalid API base URL"
        );
        return reply.code(500).send({ error: "OAuth bridge misconfigured" });
      }

      try {
        const idTokenClient = await auth.getIdTokenClient(apiBaseUrl);
        const tokenHeaders = await idTokenClient.getRequestHeaders(apiBaseUrl);

        const privateUrl = new URL("/v1/docs", apiBaseUrl);
        appendQueryParams(privateUrl, request.query);

        const response = await fetch(privateUrl.toString(), {
          method: "GET",
          headers: {
            Authorization: String(tokenHeaders.Authorization ?? ""),
            "x-tenant-id": tenantId
          }
        });

        const contentType = response.headers.get("content-type");
        const payload = await response.text();
        if (contentType) {
          reply.header("content-type", contentType);
        }
        return reply.code(response.status).send(payload);
      } catch (error) {
        request.log.error({ error }, "docs proxy: forwarding failed");
        return reply.code(502).send({ error: "Unable to reach private API" });
      }
    }
  );

  app.options("/v1/mail/gmail/connection", async (request, reply) => {
    const allowedOrigin = resolveAllowedOrigin(request.headers);
    if (allowedOrigin) {
      applyCorsHeaders(reply, allowedOrigin);
    }
    return reply.code(204).send();
  });

  app.options("/v1/mail/gmail/disconnect", async (request, reply) => {
    const allowedOrigin = resolveAllowedOrigin(request.headers);
    if (allowedOrigin) {
      applyCorsHeaders(reply, allowedOrigin);
    }
    return reply.code(204).send();
  });

  app.options("/v1/docs", async (request, reply) => {
    const allowedOrigin = resolveAllowedOrigin(request.headers);
    if (allowedOrigin) {
      applyCorsHeaders(reply, allowedOrigin);
    }
    return reply.code(204).send();
  });

  const port = Number(process.env.PORT ?? 8080);
  const host = process.env.HOST ?? "0.0.0.0";

  await app.listen({ port, host });
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
