import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
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
      console.error("Install it manually, then rerun: pnpm -w db:setup");
      process.exit(1);
    }

    const restartService = run(brewPath, ["services", "restart", "postgresql@16"]);
    printCommandResult("brew services restart postgresql@16", restartService);
    if (restartService.status !== 0) {
      console.error("Failed to restart postgresql@16 after pgvector install.");
      process.exit(1);
    }

    console.log("Retrying migrations after pgvector installation...");
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
