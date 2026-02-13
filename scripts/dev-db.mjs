import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const TARGET_DB = "ai_email_dev";
const POSTGRES_FORMULA = "postgresql@16";
const PG_VECTOR_VERIFY_SQL = "select name from pg_available_extensions where name='vector'";
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

function detectPostgresMajor(psqlPath) {
  const versionResult = run(psqlPath, ["--version"]);
  printCommandResult(`${psqlPath} --version`, versionResult);
  if (versionResult.status !== 0) {
    return null;
  }

  const match = (versionResult.stdout ?? "").match(/(\d+)\.\d+/);
  if (!match) {
    return null;
  }

  return Number.parseInt(match[1], 10);
}

function verifyVectorExtension(psqlPath) {
  const verifyArgs = [psqlPath, "-h", "127.0.0.1", "-d", "postgres", "-c", PG_VECTOR_VERIFY_SQL];
  const verifyResult = run(verifyArgs[0], verifyArgs.slice(1));
  printCommandResult(`${verifyArgs.join(" ")}`, verifyResult);
  if (verifyResult.status !== 0) {
    return false;
  }

  const hasVector = (verifyResult.stdout ?? "")
    .split("\n")
    .some((line) => line.trim() === "vector");

  return hasVector;
}

function printPgVectorBuildManualCommands({ brewPath, psqlPath, pgConfigPath, postgresFormula }) {
  const listVectorCmd = `${brewPath} list pgvector | rg 'vector\\.control|vector--|extension'`;

  console.error("\nRun these commands manually, then rerun: pnpm -w db:setup");
  console.error(`  ${brewPath} install pgvector`);
  console.error(`  ${listVectorCmd}`);
  console.error("  workdir=\"$(mktemp -d ${TMPDIR:-/tmp}/pgvector-build-XXXXXX)\"");
  console.error("  git clone --depth 1 https://github.com/pgvector/pgvector.git \"$workdir/pgvector\"");
  console.error(`  cd \"$workdir/pgvector\" && make PG_CONFIG=\"${pgConfigPath}\"`);
  console.error(`  make install PG_CONFIG=\"${pgConfigPath}\"`);
  console.error(`  ${brewPath} services restart ${postgresFormula}`);
  console.error(`  ${psqlPath} -h 127.0.0.1 -d postgres -c "${PG_VECTOR_VERIFY_SQL}"`);
  console.error("If Homebrew pgvector files look wrong, try: brew reinstall pgvector");
  console.error(
    "Alternative: use a Docker Postgres image that already includes pgvector for local development."
  );
}

function installPgvectorFromSourceForPg16({ brewPath, psqlPath, pgConfigPath, postgresFormula }) {
  const brewListResult = run(brewPath, ["list", "pgvector"]);
  printCommandResult("brew list pgvector", brewListResult);
  const brewListFiltered = run("bash", [
    "-lc",
    `${brewPath} list pgvector | (rg 'vector\\.control|vector--|extension' || true)`
  ]);
  printCommandResult("brew list pgvector | rg 'vector\\.control|vector--|extension'", brewListFiltered);
  if (brewListResult.status !== 0) {
    console.error("Unable to list Homebrew pgvector files.");
    printPgVectorBuildManualCommands({ brewPath, psqlPath, pgConfigPath, postgresFormula });
    return false;
  }

  const vectorControlPath = (brewListResult.stdout ?? "")
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.endsWith("/vector.control"));
  if (!vectorControlPath) {
    console.error("No vector.control file found in Homebrew pgvector files.");
    console.error(`Troubleshoot with: ${brewPath} list pgvector | rg 'vector\\.control|vector--|extension'`);
    console.error("Try: brew reinstall pgvector");
    console.error("Alternative: use a Docker Postgres image that bundles pgvector.");
    printPgVectorBuildManualCommands({ brewPath, psqlPath, pgConfigPath, postgresFormula });
    return false;
  }

  const buildResult = run("bash", [
    "-lc",
    [
      "set -euo pipefail",
      "workdir=\"$(mktemp -d ${TMPDIR:-/tmp}/pgvector-build-XXXXXX)\"",
      "trap 'rm -rf \"$workdir\"' EXIT",
      "git clone --depth 1 https://github.com/pgvector/pgvector.git \"$workdir/pgvector\"",
      "cd \"$workdir/pgvector\"",
      `make PG_CONFIG="${pgConfigPath}"`,
      `make install PG_CONFIG="${pgConfigPath}"`
    ].join("; ")
  ]);
  printCommandResult(
    `git clone --depth 1 https://github.com/pgvector/pgvector.git <tmp>/pgvector && make PG_CONFIG="${pgConfigPath}" && make install PG_CONFIG="${pgConfigPath}"`,
    buildResult
  );
  if (buildResult.status !== 0) {
    console.error("Building/installing pgvector from source failed.");
    printPgVectorBuildManualCommands({ brewPath, psqlPath, pgConfigPath, postgresFormula });
    return false;
  }

  const restartService = run(brewPath, ["services", "restart", postgresFormula]);
  printCommandResult(`brew services restart ${postgresFormula}`, restartService);
  if (restartService.status !== 0) {
    console.error(`Failed to restart ${postgresFormula} after pgvector build/install.`);
    printPgVectorBuildManualCommands({ brewPath, psqlPath, pgConfigPath, postgresFormula });
    return false;
  }

  const vectorAvailable = verifyVectorExtension(psqlPath);
  if (!vectorAvailable) {
    console.error("Vector extension is still unavailable after source build and restart.");
    printPgVectorBuildManualCommands({ brewPath, psqlPath, pgConfigPath, postgresFormula });
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
  const pgConfigPath = join(pgBin, "pg_config");

  if (!existsSync(psqlPath) || !existsSync(createdbPath) || !existsSync(pgIsReadyPath) || !existsSync(pgConfigPath)) {
    console.error(`Postgres binaries not found in ${pgBin}`);
    console.error("Install/link with:");
    console.error("  brew install postgresql@16");
    console.error("  brew services start postgresql@16");
    process.exit(1);
  }

  const detectedMajor = detectPostgresMajor(psqlPath);
  if (!detectedMajor) {
    console.error("Unable to detect Postgres major version from psql --version.");
    process.exit(1);
  }
  console.log(`Detected Postgres major version: ${detectedMajor}`);

  const serviceStart = run(brewPath, ["services", "start", POSTGRES_FORMULA]);
  printCommandResult(`brew services start ${POSTGRES_FORMULA}`, serviceStart);

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
    const brewInfo = run(brewPath, ["info", POSTGRES_FORMULA]);
    printCommandResult(`brew info ${POSTGRES_FORMULA}`, brewInfo);
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
      printPgVectorBuildManualCommands({
        brewPath,
        psqlPath,
        pgConfigPath,
        postgresFormula: POSTGRES_FORMULA
      });
      process.exit(1);
    }

    console.log("Verifying pgvector availability before remediation...");
    const vectorAvailableBefore = verifyVectorExtension(psqlPath);
    if (vectorAvailableBefore) {
      console.log("vector extension is already available; retrying migrations.");
    } else if (detectedMajor === 16) {
      console.log("Building pgvector from source using postgresql@16 pg_config...");
      const installed = installPgvectorFromSourceForPg16({
        brewPath,
        psqlPath,
        pgConfigPath,
        postgresFormula: POSTGRES_FORMULA
      });
      if (!installed) {
        process.exit(1);
      }
    } else {
      console.error(
        `Postgres major ${detectedMajor} detected; auto-remediation is only implemented for ${POSTGRES_FORMULA}.`
      );
      printPgVectorBuildManualCommands({
        brewPath,
        psqlPath,
        pgConfigPath,
        postgresFormula: POSTGRES_FORMULA
      });
      process.exit(1);
    }

    console.log("Retrying migrations after pgvector remediation...");
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
