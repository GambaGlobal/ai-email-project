import type { FastifyRequest } from "fastify";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isValidTenantId(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

export function resolveTenantIdForOAuthStart(
  request: FastifyRequest<{ Querystring?: { tenant_id?: string } }>
): string | null {
  // OAuth start supports browser redirects, so query tenant is allowed.
  const queryTenantId = request.query?.tenant_id;

  if (isValidTenantId(queryTenantId)) {
    return queryTenantId;
  }

  const headerTenantId = request.headers["x-tenant-id"];
  if (isValidTenantId(headerTenantId)) {
    return headerTenantId;
  }

  return null;
}

export function resolveTenantIdFromHeader(request: FastifyRequest): string | null {
  const headerTenantId = request.headers["x-tenant-id"];

  if (isValidTenantId(headerTenantId)) {
    return headerTenantId;
  }

  return null;
}

export function resolveTenantIdFromQuery(
  request: FastifyRequest<{ Querystring?: { tenant_id?: string } }>
): string | null {
  const queryTenantId = request.query?.tenant_id;

  if (isValidTenantId(queryTenantId)) {
    return queryTenantId;
  }

  return null;
}
