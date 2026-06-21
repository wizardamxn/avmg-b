import express from "express";
import cors from "cors";
import avmgRoutes from "./routes/avmg.js";

const app = express();

app.use(cors());
app.use(express.json());

// Mounted under /api so it matches the public path (nginx forwards
// https://<domain>/api/* to this backend). Locally, call http://localhost:PORT/api/*.
app.use("/api", avmgRoutes);

export default app;