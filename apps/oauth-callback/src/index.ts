import Fastify from "fastify";
import { GoogleAuth } from "google-auth-library";

function requiredEnv(name: "API_BASE_URL" | "ADMIN_BASE_URL"): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function buildAdminRedirect(adminBaseUrl: string, status: "connected" | "error"): string {
  const redirect = new URL("/onboarding", adminBaseUrl);
  redirect.searchParams.set("gmail", status);
  return redirect.toString();
}

function asSingle(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) {
    return typeof value[0] === "string" ? value[0] : null;
  }
  return typeof value === "string" ? value : null;
}

async function main() {
  const apiBaseUrl = requiredEnv("API_BASE_URL");
  const adminBaseUrl = requiredEnv("ADMIN_BASE_URL");
  const auth = new GoogleAuth();

  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? "info"
    }
  });

  app.get<{ Querystring: { code?: string | string[]; state?: string | string[]; error?: string | string[] } }>(
    "/v1/auth/gmail/callback",
    async (request, reply) => {
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
          return reply.redirect(302, buildAdminRedirect(adminBaseUrl, "connected"));
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

  const port = Number(process.env.PORT ?? 8080);
  const host = process.env.HOST ?? "0.0.0.0";

  await app.listen({ port, host });
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
