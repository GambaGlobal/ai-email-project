import { spawn } from "node:child_process";

const extraArgs = process.argv.slice(2);

if (extraArgs.length > 0) {
  console.error("typecheck guard: extra arguments are not allowed.");
  console.error("typecheck guard: Do not run `pnpm -w typecheck -- ...`.");
  console.error("typecheck guard: Use one of the wrapper scripts instead:");
  console.error("  pnpm -w typecheck:full");
  console.error("  pnpm -w typecheck:errors");
  console.error("  pnpm -w typecheck:new");
  console.error("  pnpm -w typecheck:hash");
  console.error("  pnpm -w typecheck:debug");
  console.error("  pnpm -w typecheck:filter:shared");
  console.error("typecheck guard: Or run Turbo directly, for example:");
  console.error("  pnpm -w turbo run typecheck --output-logs=full");
  console.error(
    "  pnpm -w turbo run typecheck --filter=@ai-email/shared --output-logs=full"
  );
  process.exit(1);
}

const pnpmBin = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const child = spawn(pnpmBin, ["-w", "turbo", "run", "typecheck"], {
  stdio: "inherit"
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 1);
});

child.on("error", () => {
  process.exit(1);
});
