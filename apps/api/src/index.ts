import Fastify from "fastify";
import gmailAuthRoutes from "./routes/gmail-auth.js";
import gmailConnectionRoutes from "./routes/gmail-connection.js";

const app = Fastify();

app.get("/healthz", async () => {
  return { ok: true, service: "api", ts: new Date().toISOString() };
});

await app.register(gmailAuthRoutes);
await app.register(gmailConnectionRoutes);

const port = Number(process.env.PORT ?? 3001);
const host = process.env.HOST ?? "0.0.0.0";

try {
  await app.listen({ port, host });
  // eslint-disable-next-line no-console
  console.log(`api ready on ${host}:${port}`);
} catch (err) {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
}
