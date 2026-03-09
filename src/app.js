import express from "express";
import cors from "cors";
import testRoutes from "./routes/avmg.js";

const app = express();

app.use(cors());
app.use(express.json());
app.use("/", testRoutes);

export default app;