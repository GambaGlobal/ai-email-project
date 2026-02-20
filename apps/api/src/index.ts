import Fastify from "fastify";
import multipart from "@fastify/multipart";
import gmailAuthRoutes from "./routes/gmail-auth.js";
import gmailConnectionRoutes from "./routes/gmail-connection.js";
import gmailNotificationRoutes from "./routes/gmail-notifications.js";
import docsRoutes from "./routes/docs.js";
import docVersionStorageRoutes from "./routes/doc-version-storage.js";
import retrievalRoutes from "./routes/retrieval.js";
import generatePreviewRoutes from "./routes/generate-preview.js";
import { validateS3ConfigOnBoot } from "./lib/s3.js";

async function main() {
  validateS3ConfigOnBoot();

  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? "info"
    }
  });

  await app.register(multipart, {
    limits: {
      fileSize: 10 * 1024 * 1024
    }
  });

  app.get("/healthz", async () => {
    return { ok: true, service: "api", ts: new Date().toISOString() };
  });

  await app.register(gmailAuthRoutes);
  await app.register(gmailConnectionRoutes);
  await app.register(gmailNotificationRoutes);
  await app.register(docsRoutes);
  await app.register(docVersionStorageRoutes);
  await app.register(retrievalRoutes);
  await app.register(generatePreviewRoutes);

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
}

main();
