# # TODO(you): base image.
# # Constraints: Node 20, and needs a real Debian userland (not Alpine/musl) —
# # youtube-dl-exec's Linux yt-dlp is a Python zipapp needing python3.11+,
# # and Alpine's package set makes that painful. Bookworm already proved
# # itself in this repo's own git history (commit 03c9c73). Pick the slim variant.
# FROM node:20-bookworm-slim

# WORKDIR /app

# # TODO(you): system packages — ffmpeg (+ ffprobe, same package) and python3.
# # fluent-ffmpeg calls ffprobe too; there's no setFfmpegPath() in this codebase,
# # so both binaries must be on PATH by name.
# # Three rules, you already know two:
# #   1. update + install in ONE RUN  (why: separate RUNs cache the stale index layer)
# #   2. --no-install-recommends (why: recommends drag in ~50-100MB of stuff you don't use)
# #   3. clean up apt's lists in the SAME RUN (why: a later RUN can't shrink an earlier layer)
# RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg python3 \
#     && apt-get clean && rm -rf /var/lib/apt/lists/*

# # TODO(you): enable the pinned pnpm via corepack.
# # package.json says "packageManager": "pnpm@10.28.0" — corepack reads that
# # and materializes the exact version. Two lines: corepack enable, corepack prepare.
# RUN corepack enable && corepack prepare pnpm@10.28.0 --activate

# # TODO(you): copy ONLY what's needed to resolve dependencies, not the app code.
# # Which two files let pnpm compute the exact dependency tree without seeing src/?
# # (This is the layer-ordering payoff: editing src/ later won't invalidate this layer.)
# COPY package.json pnpm-lock.yaml ./

# # TODO(you): install with the lockfile, not "whatever resolves today".
# # pnpm's flag for "fail if the lockfile doesn't exactly match package.json"
# # is the one that makes builds reproducible.
# # Do NOT add --ignore-scripts here — say in a comment why, referencing
# # package.json's pnpm.onlyBuiltDependencies block and what breaks silently
# # at runtime (not build time) if scripts are skipped.
# RUN pnpm install --frozen-lockfile 
# #No ignore scripts because builtDependencies have the ytdlp and etc files which are downloaded when we do pnpm i

# # TODO(you): now bring in the rest of the source.
# COPY . .

# # TODO(you): generate the Prisma client.
# # No DATABASE_URL exists at build time — is that a problem for `generate`
# # specifically? (Compare with `migrate deploy`, which we're deliberately
# # NOT running here — that's a Stage 3 decision, not a build-time one.)
# RUN npx prisma generate 
#  #I can do an optimization here by having the prisma schema in a separate folder and only copying that folder to the image, but I don't think it's worth it for now  gdfg dsfg fdsg fdg dfg
# EXPOSE 5000

# # TODO(you): default command.
# # Stage 3 will override this per-service in compose (api vs worker run
# # different files from the SAME image) — so what's the sane default here?
# # Hint: it should be the one that makes `docker run` alone do something useful.
# CMD ["node", "src/server.js"]

# ---------- deps ----------
FROM node:20-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
    && apt-get clean && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@10.28.0 --activate
COPY package.json pnpm-lock.yaml ./
ENV YOUTUBE_DL_SKIP_PYTHON_CHECK=1
RUN pnpm install --frozen-lockfile 

# ---------- build ----------
# Kept un-pruned on purpose: the `migrate` compose service builds this exact
# stage (not `runtime`) so it still has the `prisma` CLI to run `migrate deploy`.
FROM deps AS build
COPY prisma ./prisma
RUN pnpm exec prisma generate
COPY . .

# ---------- pruned ----------
# Separate stage so pruning devDependencies (prisma CLI included) doesn't
# poison the `build` stage that `migrate` depends on.
FROM build AS pruned
RUN pnpm prune --prod

# ---------- runtime ----------
FROM node:20-bookworm-slim AS runtime
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg python3 openssl ca-certificates curl unzip\
    && apt-get clean && rm -rf /var/lib/apt/lists/*

# yt-dlp needs a JS runtime to solve YouTube's signature/n-challenge puzzle,
# same fix as the EC2 box (see memory: ytdlp-ec2-deploy-gotchas). Installs to
# /usr/local/bin so it's on PATH for every user, not just root.
ENV DENO_INSTALL=/usr/local
RUN curl -fsSL https://deno.land/install.sh | sh

COPY --from=pruned /app/node_modules ./node_modules
COPY --from=pruned /app/src ./src

RUN mkdir -p uploads && chown node:node uploads
USER node

EXPOSE 5000
CMD ["node", "src/server.js"]
