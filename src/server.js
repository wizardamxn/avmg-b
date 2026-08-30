import dotenv from "dotenv";
dotenv.config();

import app from "./app.js";
import prisma from "./lib/prisma.js";

const PORT = process.env.PORT || 5000;

async function startServer() {
  try {
    await prisma.$connect(); // ✅ correct method
    console.log("Connected to PostgreSQL ✅");

    const server = app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });

    // Stop taking new connections, let in-flight requests drain, then exit.
    // Without this, SIGTERM cuts active uploads dead mid-request.
    let shuttingDown = false;
    const shutdown = (signal) => {
      if (shuttingDown) return;
      shuttingDown = true;
      console.log(`\n🛑 ${signal} received — closing server.`);
      server.close(async () => {
        await prisma.$disconnect();
        console.log("✅ Server closed cleanly.");
        process.exit(0);
      });
      // A wedged keep-alive connection shouldn't hold shutdown open forever.
      setTimeout(() => process.exit(1), 10_000).unref();
    };

    process.on("SIGTERM", () => shutdown("SIGTERM"));
    process.on("SIGINT", () => shutdown("SIGINT"));
  } catch (err) {
    console.error("DB connection failed ❌", err);
    process.exit(1);
  }
}

startServer();