PM2 process config for the AVMG backend.
// NOTE: filename ends in .cjs because package.json has "type": "module".
// Run from this folder:  pm2 start ecosystem.config.cjs
const path = require("path");

module.exports = {
  apps: [
    {
      // ---- The API server (the "waiter") ----
      name: "avmg-server",
      script: "src/server.js",
      cwd: __dirname, // so dotenv finds .env in this folder
      exec_mode: "fork",
      instances: 1,
      autorestart: true,
      max_memory_restart: "400M",
      env: {
        NODE_ENV: "production",
      },
    },
    {
      // ---- The background worker (the "cook") ----
      // Keep this at ONE instance: it both processes jobs and runs the
      // hourly Supabase cleanup cron. Multiple instances = duplicate sweeps.
      name: "avmg-worker",
      script: "src/workers/mediaWorker.js",
      cwd: __dirname,
      exec_mode: "fork",
      instances: 1,
      autorestart: true,
      // ffmpeg + downloads are memory-heavy; restart if it balloons.
      max_memory_restart: "700M",
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
