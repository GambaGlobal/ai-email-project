import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";

const TARGET_DB = "ai_email_dev";
const READY_TIMEOUT_MS = 30_000;
const READY_POLL_MS = 1_500;
const BREW_CANDIDATES = ["/opt/homebrew/bin/brew", "/usr/local/bin/brew", "brew"];

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    encoding: "utf8",
    stdio: "pipe",
    ...options
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function printCommandResult(label, result) {
  const stdout = (result.stdout ?? "").trim();
  const stderr = (result.stderr ?? "").trim();
  console.log(`\n$ ${label}`);
  if (stdout) {
    console.log(stdout);
  }
  if (stderr) {
    console.log(stderr);
  }
}

async function maybePrintBrewLogs(brewPrefix) {
  const candidates = [
    join(brewPrefix, "var/log/postgresql@16.log"),
    join(brewPrefix, "var/log/postgres.log"),
    "/opt/homebrew/var/log/postgresql@16.log",
    "/usr/local/var/log/postgresql@16.log"
  ];

  for (const filePath of candidates) {
    if (!existsSync(filePath)) {
      continue;
    }

    try {
      const raw = await readFile(filePath, "utf8");
      const lines = raw.trim().split("\n");
      const tail = lines.slice(Math.max(lines.length - 40, 0)).join("\n");
      console.log(`\n--- Last lines: ${filePath} ---`);
      console.log(tail);
      return;
    } catch {
      // Best effort only.
    }
  }
}

function getReadinessChecks(pgBin) {
  return [
    {
      name: "tcp",
      env: process.env,
      args: [join(pgBin, "pg_isready"), "-h", "127.0.0.1", "-p", "5432"]
    },
    {
      name: "socket",
      env: { ...process.env, PGHOST: "/tmp" },
      args: [join(pgBin, "pg_isready"), "-p", "5432"]
    }
  ];
}

function buildDatabaseUrl(mode) {
  if (mode === "tcp") {
    return `postgresql://127.0.0.1:5432/${TARGET_DB}`;
  }
  return `postgresql:///${TARGET_DB}?host=/tmp`;
}

function getPsqlArgs(psqlPath, dbMode, database, sql) {
  if (dbMode === "tcp") {
    return [psqlPath, "-h", "127.0.0.1", "-d", database, "-c", sql];
  }

  return [psqlPath, "-d", database, "-c", sql];
}

function printPgVectorManualCommands({ brewPath, psqlPath, dbMode }) {
  const verifyArgs = getPsqlArgs(
    psqlPath,
    dbMode,
    "postgres",
    "select name from pg_available_extensions where name='vector';"
  );
  const hostExport = dbMode === "tcp" ? "" : "export PGHOST=/tmp";
  const listVectorCmd = `${brewPath} list pgvector | rg 'vector\\.control|vector--|extension'`;

  console.error("\nRun these commands manually, then rerun: pnpm -w db:setup");
  console.error(`  ${brewPath} install pgvector`);
  console.error(`  ${listVectorCmd}`);
  console.error(`  PG_PREFIX="$(${brewPath} --prefix postgresql@16)"`);
  console.error('  EXT_DIR="${PG_PREFIX}/share/postgresql@16/extension"');
  console.error(`  VEC_CONTROL="$(${brewPath} list pgvector | rg 'vector\\.control$' | head -n 1)"`);
  console.error('  VEC_DIR="$(dirname "${VEC_CONTROL}")"');
  console.error('  cp -f "${VEC_DIR}/vector.control" "${EXT_DIR}/vector.control"');
  console.error('  cp -f "${VEC_DIR}"/vector--*.sql "${EXT_DIR}/"');
  console.error(`  ${brewPath} services restart postgresql@16`);
  if (hostExport) {
    console.error(`  ${hostExport}`);
  }
  console.error("If files are missing, try: brew reinstall pgvector");
  console.error(
    "Alternative: use a Docker Postgres image that already includes pgvector for local development."
  );
  console.error(`  ${verifyArgs.join(" ")}`);
}

function linkPgVectorExtension({ brewPath, psqlPath, dbMode, queryEnv }) {
  const pgPrefixResult = run(brewPath, ["--prefix", "postgresql@16"]);
  printCommandResult(`${brewPath} --prefix postgresql@16`, pgPrefixResult);
  if (pgPrefixResult.status !== 0) {
    console.error("Unable to resolve Homebrew prefix for postgresql@16.");
    printPgVectorManualCommands({ brewPath, psqlPath, dbMode });
    return false;
  }

  const pgPrefix = pgPrefixResult.stdout.trim();
  const extDir = join(pgPrefix, "share/postgresql@16/extension");

  if (!existsSync(extDir)) {
    console.error(`Postgres extension dir does not exist: ${extDir}`);
    printPgVectorManualCommands({ brewPath, psqlPath, dbMode });
    return false;
  }

  const brewListResult = run(brewPath, ["list", "pgvector"]);
  printCommandResult("brew list pgvector", brewListResult);
  const brewListFiltered = run("bash", [
    "-lc",
    `${brewPath} list pgvector | (rg 'vector\\.control|vector--|extension' || true)`
  ]);
  printCommandResult("brew list pgvector | rg 'vector\\.control|vector--|extension'", brewListFiltered);
  if (brewListResult.status !== 0) {
    console.error("Unable to list pgvector package files.");
    printPgVectorManualCommands({ brewPath, psqlPath, dbMode });
    return false;
  }

  const vectorControlPath = (brewListResult.stdout ?? "")
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.endsWith("/vector.control"));
  if (!vectorControlPath) {
    console.error("No vector.control file found in Homebrew pgvector files.");
    console.error("Troubleshooting output shown above:");
    console.error(`  ${brewPath} list pgvector | rg 'vector\\.control|vector--|extension'`);
    console.error("Try: brew reinstall pgvector");
    console.error("Alternative: use a Docker Postgres image that bundles pgvector.");
    printPgVectorManualCommands({ brewPath, psqlPath, dbMode });
    return false;
  }

  const srcDir = dirname(vectorControlPath);
  if (!srcDir || srcDir === ".") {
    console.error(`Invalid pgvector source directory resolved from ${vectorControlPath}`);
    console.error("Refusing to continue to avoid self-referential symlinks.");
    printPgVectorManualCommands({ brewPath, psqlPath, dbMode });
    return false;
  }

  if (srcDir === extDir) {
    console.log("pgvector extension files are already in the Postgres extension dir; skipping install copy.");
  } else {
    const copyResult = run("bash", [
      "-lc",
      `set -euo pipefail; cp -f "${srcDir}/vector.control" "${extDir}/vector.control"; cp -f "${srcDir}"/vector--*.sql "${extDir}/"`
    ]);
    printCommandResult(
      `cp -f "${srcDir}/vector.control" "${extDir}/vector.control" && cp -f "${srcDir}"/vector--*.sql "${extDir}/"`,
      copyResult
    );
    if (copyResult.status !== 0) {
      console.error("Failed to copy pgvector extension files into Postgres extension directory.");
      printPgVectorManualCommands({ brewPath, psqlPath, dbMode });
      return false;
    }
  }

  const restartService = run(brewPath, ["services", "restart", "postgresql@16"]);
  printCommandResult("brew services restart postgresql@16", restartService);
  if (restartService.status !== 0) {
    console.error("Failed to restart postgresql@16 after linking pgvector extension files.");
    printPgVectorManualCommands({ brewPath, psqlPath, dbMode });
    return false;
  }

  const verifyArgs = getPsqlArgs(
    psqlPath,
    dbMode,
    "postgres",
    "select name from pg_available_extensions where name='vector';"
  );
  const verifyVector = run(verifyArgs[0], verifyArgs.slice(1), { env: queryEnv });
  printCommandResult(
    `${verifyArgs[0]} ${verifyArgs.slice(1, -2).join(" ")} -c "select name from pg_available_extensions where name='vector';"`,
    verifyVector
  );
  if (verifyVector.status !== 0 || !(verifyVector.stdout ?? "").includes("vector")) {
    console.error("Vector extension is still unavailable after linking and restart.");
    printPgVectorManualCommands({ brewPath, psqlPath, dbMode });
    return false;
  }

  return true;
}

async function main() {
  if (process.platform !== "darwin") {
    console.error("db:setup currently supports macOS Homebrew workflow only.");
    process.exit(1);
  }

  const brewPath = BREW_CANDIDATES.find((candidate) => {
    if (candidate.includes("/")) {
      return existsSync(candidate);
    }
    return run(candidate, ["--version"]).status === 0;
  });

  if (!brewPath) {
    console.error("Homebrew executable not found. Install Homebrew first: https://brew.sh");
    process.exit(1);
  }

  const brewPrefixResult = run(brewPath, ["--prefix"]);
  if (brewPrefixResult.status !== 0) {
    printCommandResult("brew --prefix", brewPrefixResult);
    console.error("Homebrew not available. Install Homebrew first: https://brew.sh");
    process.exit(1);
  }

  const brewPrefix = brewPrefixResult.stdout.trim();
  const pgBin = join(brewPrefix, "opt/postgresql@16/bin");
  const psqlPath = join(pgBin, "psql");
  const createdbPath = join(pgBin, "createdb");
  const pgIsReadyPath = join(pgBin, "pg_isready");

  if (!existsSync(psqlPath) || !existsSync(createdbPath) || !existsSync(pgIsReadyPath)) {
    console.error(`Postgres binaries not found in ${pgBin}`);
    console.error("Install/link with:");
    console.error("  brew install postgresql@16");
    console.error("  brew services start postgresql@16");
    process.exit(1);
  }

  const serviceStart = run(brewPath, ["services", "start", "postgresql@16"]);
  printCommandResult("brew services start postgresql@16", serviceStart);

  console.log("\nWaiting for Postgres readiness...");
  const startedAt = Date.now();
  let selectedMode = null;
  let lastReadinessOutput = "";

  while (Date.now() - startedAt < READY_TIMEOUT_MS) {
    for (const check of getReadinessChecks(pgBin)) {
      const [command, ...args] = check.args;
      const ready = run(command, args, { env: check.env });
      const output = `${(ready.stdout ?? "").trim()} ${(ready.stderr ?? "").trim()}`.trim();
      lastReadinessOutput = output || `(status=${ready.status ?? "unknown"})`;
      console.log(`- ${check.name}: ${lastReadinessOutput}`);

      if (ready.status === 0) {
        selectedMode = check.name;
        break;
      }
    }

    if (selectedMode) {
      break;
    }

    await sleep(READY_POLL_MS);
  }

  if (!selectedMode) {
    console.error("\nPostgres did not become ready in time.");
    console.error(`Last readiness output: ${lastReadinessOutput}`);

    const servicesList = run("bash", [
      "-lc",
      `${brewPath} services list | (rg postgresql || grep postgresql || cat)`
    ]);
    printCommandResult("brew services list | rg postgresql", servicesList);
    const listen = run("bash", ["-lc", "lsof -nP -iTCP:5432 -sTCP:LISTEN || true"]);
    printCommandResult("lsof -nP -iTCP:5432 -sTCP:LISTEN || true", listen);
    const brewInfo = run(brewPath, ["info", "postgresql@16"]);
    printCommandResult("brew info postgresql@16", brewInfo);
    await maybePrintBrewLogs(brewPrefix);
    process.exit(1);
  }

  console.log(`\nPostgres ready via ${selectedMode}.`);

  const connectionChecks =
    selectedMode === "tcp"
      ? [
          {
            name: "tcp",
            env: process.env,
            args: [psqlPath, "-h", "127.0.0.1", "-d", "postgres", "-tAc", "select 1"]
          },
          {
            name: "socket",
            env: { ...process.env, PGHOST: "/tmp" },
            args: [psqlPath, "-d", "postgres", "-tAc", "select 1"]
          }
        ]
      : [
          {
            name: "socket",
            env: { ...process.env, PGHOST: "/tmp" },
            args: [psqlPath, "-d", "postgres", "-tAc", "select 1"]
          },
          {
            name: "tcp",
            env: process.env,
            args: [psqlPath, "-h", "127.0.0.1", "-d", "postgres", "-tAc", "select 1"]
          }
        ];

  let dbMode = null;
  for (const check of connectionChecks) {
    const [command, ...args] = check.args;
    const result = run(command, args, { env: check.env });
    if (result.status === 0) {
      dbMode = check.name;
      break;
    }
  }

  if (!dbMode) {
    console.error("Unable to connect to postgres DB using TCP or /tmp socket.");
    process.exit(1);
  }

  const queryArgs =
    dbMode === "tcp"
      ? [psqlPath, "-h", "127.0.0.1", "-d", "postgres", "-tAc"]
      : [psqlPath, "-d", "postgres", "-tAc"];
  const queryEnv = dbMode === "tcp" ? process.env : { ...process.env, PGHOST: "/tmp" };

  const dbExists = run(queryArgs[0], [...queryArgs.slice(1), `select 1 from pg_database where datname='${TARGET_DB}'`], {
    env: queryEnv
  });

  if (dbExists.status !== 0) {
    printCommandResult(`${queryArgs.join(" ")} \"select ...\"`, dbExists);
    console.error("Failed checking database existence.");
    process.exit(1);
  }

  if ((dbExists.stdout ?? "").trim() !== "1") {
    const createArgs =
      dbMode === "tcp"
        ? [createdbPath, "-h", "127.0.0.1", TARGET_DB]
        : [createdbPath, TARGET_DB];
    const createEnv = dbMode === "tcp" ? process.env : { ...process.env, PGHOST: "/tmp" };
    const created = run(createArgs[0], createArgs.slice(1), { env: createEnv });
    printCommandResult(createArgs.join(" "), created);
    if (created.status !== 0) {
      console.error(`Failed creating database ${TARGET_DB}.`);
      process.exit(1);
    }
  } else {
    console.log(`Database ${TARGET_DB} already exists.`);
  }

  const databaseUrl = buildDatabaseUrl(dbMode);
  console.log(`\nDATABASE_URL ready:\nexport DATABASE_URL="${databaseUrl}"`);

  const migrateEnv = { ...process.env, DATABASE_URL: databaseUrl };
  let migrate = run("pnpm", ["-w", "db:migrate"], { env: migrateEnv });
  printCommandResult("pnpm -w db:migrate", migrate);

  const migrateOutput = `${migrate.stdout ?? ""}\n${migrate.stderr ?? ""}`;
  const missingVector = migrateOutput.includes('extension "vector" is not available');

  if (migrate.status !== 0 && missingVector) {
    console.log("\nDetected missing pgvector extension. Attempting Homebrew install...");
    const installPgVector = run(brewPath, ["install", "pgvector"]);
    printCommandResult("brew install pgvector", installPgVector);
    if (installPgVector.status !== 0) {
      console.error("Unable to auto-install pgvector.");
      printPgVectorManualCommands({ brewPath, psqlPath, dbMode });
      process.exit(1);
    }

    console.log("Linking pgvector extension files into postgresql@16 extension dir...");
    const linked = linkPgVectorExtension({ brewPath, psqlPath, dbMode, queryEnv });
    if (!linked) {
      process.exit(1);
    }

    console.log("Retrying migrations after pgvector install/link/verification...");
    migrate = run("pnpm", ["-w", "db:migrate"], { env: migrateEnv });
    printCommandResult("pnpm -w db:migrate (retry)", migrate);
  }

  if (migrate.status !== 0) {
    console.error("Migration command failed.");
    process.exit(1);
  }

  const sanityArgs =
    dbMode === "tcp"
      ? [psqlPath, "-h", "127.0.0.1", "-d", TARGET_DB, "-tAc", "select 1"]
      : [psqlPath, "-d", TARGET_DB, "-tAc", "select 1"];
  const sanityEnv = dbMode === "tcp" ? process.env : { ...process.env, PGHOST: "/tmp" };
  const sanity = run(sanityArgs[0], sanityArgs.slice(1), { env: sanityEnv });
  printCommandResult(sanityArgs.join(" "), sanity);
  if (sanity.status !== 0) {
    console.error("Postgres sanity query failed.");
    process.exit(1);
  }

  console.log("\ndb:setup completed successfully.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
