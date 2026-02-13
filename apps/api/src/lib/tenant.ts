import type { FastifyRequest } from "fastify";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isValidTenantId(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function resolveTenantHeaderValue(headers: FastifyRequest["headers"]): string | null {
  const rawHeaderValue = headers["x-tenant-id"];
  const normalizedValue = Array.isArray(rawHeaderValue) ? rawHeaderValue[0] : rawHeaderValue;

  if (typeof normalizedValue !== "string") {
    return null;
  }

  const tenantId = normalizedValue.trim();
  return tenantId.length > 0 ? tenantId : null;
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
  const tenantId = resolveTenantHeaderValue(request.headers);

  if (!tenantId && process.env.TENANT_DEBUG === "1") {
    // Debug-only tenant header introspection for local troubleshooting.
    // eslint-disable-next-line no-console
    console.warn("TENANT_DEBUG missing x-tenant-id", {
      headerKeys: Object.keys(request.headers),
      tenantHeader: request.headers["x-tenant-id"]
    });
  }

  return tenantId;
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
