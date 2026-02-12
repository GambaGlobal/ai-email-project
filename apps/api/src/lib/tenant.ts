import type { FastifyRequest } from "fastify";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function resolveTenantId(
  request: FastifyRequest<{ Querystring?: { tenant_id?: string } }>
): string | null {
  // Minimal tenant resolution for Phase 9.5:
  // prefer explicit `tenant_id` query param (browser OAuth redirects cannot set headers),
  // fallback to `x-tenant-id` header for API clients.
  const queryTenantId = request.query?.tenant_id;

  if (typeof queryTenantId === "string" && UUID_PATTERN.test(queryTenantId)) {
    return queryTenantId;
  }

  const headerTenantId = request.headers["x-tenant-id"];
  if (typeof headerTenantId === "string" && UUID_PATTERN.test(headerTenantId)) {
    return headerTenantId;
  }

  return null;
}
