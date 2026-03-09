import express from "express";
import cors from "cors";
import avmgRoutes from "./routes/avmg.js";

const app = express();

app.use(cors());
app.use(express.json());
app.use("/", avmgRoutes);

export default app;