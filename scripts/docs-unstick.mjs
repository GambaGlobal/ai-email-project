import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ALLOWED_SET_STATUS = new Set(["failed", "queued"]);

function resolvePsqlBin() {
  const envBin = process.env.PSQL_BIN;
  if (envBin && envBin.trim().length > 0) {
    return envBin;
  }

  const candidates = ["/opt/homebrew/opt/postgresql@16/bin/psql", "/usr/local/bin/psql"];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return "psql";
}

function toIntInRange(raw, fallback, min, max) {
  if (raw === undefined) {
    return fallback;
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    return null;
  }
  return parsed;
}

function sqlLiteral(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function parseDbHost(databaseUrl) {
  const parsed = new URL(databaseUrl);
  if (!parsed.hostname) {
    throw new Error("DATABASE_URL must include host");
  }
  return parsed.port ? `${parsed.hostname}:${parsed.port}` : parsed.hostname;
}

function printErrorAndExit(message) {
  console.error(JSON.stringify({ event: "docs.unstick.error", message }));
  process.exit(1);
}

function runSql(psqlBin, databaseUrl, sql, input) {
  const sqlSegments = [];
  if (input.useTransaction || input.tenantId) {
    sqlSegments.push("BEGIN;");
  }
  if (input.tenantId) {
    sqlSegments.push(`SELECT set_config('app.tenant_id', ${sqlLiteral(input.tenantId)}, true);`);
  }
  sqlSegments.push(sql.trim());
  if (input.useTransaction || input.tenantId) {
    sqlSegments.push("COMMIT;");
  }

  const wrapped = sqlSegments.join("\n");

  return new Promise((resolve) => {
    const child = spawn(psqlBin, [databaseUrl, "-v", "ON_ERROR_STOP=1", "-At", "-F", "\t", "-c", wrapped], {
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("close", (code) => {
      resolve({ ok: code === 0, stdout, stderr });
    });

    child.on("error", (error) => {
      resolve({ ok: false, stdout, stderr: `${psqlBin}: ${error.message}` });
    });
  });
}

function normalizeRows(stdout) {
  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && line !== "BEGIN" && line !== "COMMIT" && line !== "set_config");
}

const databaseUrl = process.env.DATABASE_URL;
const tenantId = process.env.TENANT_ID;
const allowAllTenants = process.env.ALLOW_ALL_TENANTS === "1";
const thresholdMinutes = toIntInRange(process.env.THRESHOLD_MINUTES, 15, 1, 10_080);
const limit = toIntInRange(process.env.LIMIT, 50, 1, 500);
const setStatus = (process.env.SET_STATUS ?? "failed").trim().toLowerCase();
const dryRun = process.env.DOCS_UNSTICK_CONFIRM !== "1";

if (!databaseUrl) {
  printErrorAndExit("DATABASE_URL is required");
}
if (thresholdMinutes === null) {
  printErrorAndExit("THRESHOLD_MINUTES must be an integer 1..10080");
}
if (limit === null) {
  printErrorAndExit("LIMIT must be an integer 1..500");
}
if (!ALLOWED_SET_STATUS.has(setStatus)) {
  printErrorAndExit('SET_STATUS must be one of "failed" or "queued"');
}
if (!allowAllTenants && !tenantId) {
  printErrorAndExit("TENANT_ID is required unless ALLOW_ALL_TENANTS=1");
}
if (tenantId && !UUID_PATTERN.test(tenantId)) {
  printErrorAndExit("TENANT_ID must be a UUID");
}

let dbHost;
try {
  dbHost = parseDbHost(databaseUrl);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  printErrorAndExit(message);
}

const scopedTenantId = allowAllTenants ? null : tenantId;

const whereParts = [
  "ingestion_status = 'processing'",
  `ingestion_status_updated_at < now() - (${thresholdMinutes} * interval '1 minute')`
];
if (!allowAllTenants && tenantId) {
  whereParts.push(`tenant_id = ${sqlLiteral(tenantId)}::uuid`);
}
const whereClause = `WHERE ${whereParts.join(" AND ")}`;

console.log(
  JSON.stringify({
    event: "docs.unstick.start",
    thresholdMinutes,
    limit,
    tenantId: scopedTenantId,
    allowAllTenants,
    setStatus,
    dryRun,
    dbHost
  })
);

const matchSql = `
SELECT
  id::text,
  tenant_id::text,
  ingestion_status_updated_at::text
FROM docs
${whereClause}
ORDER BY ingestion_status_updated_at ASC, tenant_id ASC, id ASC
LIMIT ${limit};
`;

const psqlBin = resolvePsqlBin();
const matchResult = await runSql(psqlBin, databaseUrl, matchSql, {
  tenantId: scopedTenantId,
  useTransaction: false
});

if (!matchResult.ok) {
  printErrorAndExit((matchResult.stderr || "query failed").trim());
}

const matchedRows = normalizeRows(matchResult.stdout)
  .map((line) => {
    const [docId, rowTenantId, statusUpdatedAt] = line.split("\t");
    if (!docId || !rowTenantId || !statusUpdatedAt) {
      return null;
    }
    return {
      docId,
      tenantId: rowTenantId,
      statusUpdatedAt
    };
  })
  .filter((row) => row !== null)
  .sort((a, b) => {
    const tsCompare = a.statusUpdatedAt.localeCompare(b.statusUpdatedAt);
    if (tsCompare !== 0) {
      return tsCompare;
    }
    const tenantCompare = a.tenantId.localeCompare(b.tenantId);
    if (tenantCompare !== 0) {
      return tenantCompare;
    }
    return a.docId.localeCompare(b.docId);
  });

console.log(
  JSON.stringify({
    event: "docs.unstick.matched",
    matchedCount: matchedRows.length
  })
);

for (const row of matchedRows) {
  console.log(
    JSON.stringify({
      event: "docs.unstick.match",
      docId: row.docId,
      tenantId: row.tenantId,
      statusUpdatedAt: row.statusUpdatedAt
    })
  );
}

if (dryRun) {
  const rerunParts = [
    'DATABASE_URL="<redacted>"'
  ];
  if (allowAllTenants) {
    rerunParts.push("ALLOW_ALL_TENANTS=1");
  } else if (tenantId) {
    rerunParts.push(`TENANT_ID=\"${tenantId}\"`);
  }
  rerunParts.push(`THRESHOLD_MINUTES=\"${thresholdMinutes}\"`);
  rerunParts.push(`LIMIT=\"${limit}\"`);
  rerunParts.push(`SET_STATUS=\"${setStatus}\"`);
  rerunParts.push("DOCS_UNSTICK_CONFIRM=1");
  rerunParts.push("pnpm -w docs:unstick");
  console.log(`Re-run with confirm: ${rerunParts.join(" ")}`);
  console.log(
    `OK docs:unstick dry-run matched=${matchedRows.length} thresholdMinutes=${thresholdMinutes} limit=${limit}`
  );
  process.exit(0);
}

const applySql = `
WITH targets AS (
  SELECT id, tenant_id
  FROM docs
  ${whereClause}
  ORDER BY ingestion_status_updated_at ASC, tenant_id ASC, id ASC
  LIMIT ${limit}
),
updated AS (
  UPDATE docs AS d
  SET
    ingestion_status = ${sqlLiteral(setStatus)},
    ingestion_status_updated_at = now(),
    updated_at = now()
  FROM targets t
  WHERE d.id = t.id
    AND d.tenant_id = t.tenant_id
  RETURNING d.id::text, d.tenant_id::text, d.ingestion_status::text, d.ingestion_status_updated_at::text
)
SELECT *
FROM updated
ORDER BY ingestion_status_updated_at ASC, tenant_id ASC, id ASC;
`;

const applyResult = await runSql(psqlBin, databaseUrl, applySql, {
  tenantId: scopedTenantId,
  useTransaction: true
});

if (!applyResult.ok) {
  printErrorAndExit((applyResult.stderr || "apply failed").trim());
}

const appliedRows = normalizeRows(applyResult.stdout)
  .map((line) => {
    const [docId, rowTenantId, newStatus, updatedAt] = line.split("\t");
    if (!docId || !rowTenantId || !newStatus || !updatedAt) {
      return null;
    }
    return {
      docId,
      tenantId: rowTenantId,
      newStatus,
      updatedAt
    };
  })
  .filter((row) => row !== null)
  .sort((a, b) => {
    const tsCompare = a.updatedAt.localeCompare(b.updatedAt);
    if (tsCompare !== 0) {
      return tsCompare;
    }
    const tenantCompare = a.tenantId.localeCompare(b.tenantId);
    if (tenantCompare !== 0) {
      return tenantCompare;
    }
    return a.docId.localeCompare(b.docId);
  });

for (const row of appliedRows) {
  console.log(
    JSON.stringify({
      event: "docs.unstick.applied",
      docId: row.docId,
      tenantId: row.tenantId,
      newStatus: row.newStatus,
      updatedAt: row.updatedAt
    })
  );
}

console.log(
  `OK docs:unstick applied=${appliedRows.length} status=${setStatus} thresholdMinutes=${thresholdMinutes} limit=${limit}`
);
