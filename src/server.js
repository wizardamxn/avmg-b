import dotenv from "dotenv";
dotenv.config();

import app from "./app.js";
import prisma from "./lib/prisma.js";

const PORT = process.env.PORT || 5000;

async function startServer() {
  try {
    await prisma.$connect(); // ✅ correct method
    console.log("Connected to PostgreSQL ✅");

    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  } catch (err) {
    console.error("DB connection failed ❌", err);
    process.exit(1);
  }
}

startServer();