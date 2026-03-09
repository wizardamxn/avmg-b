# 1. Start with a modern Linux environment (Bookworm provides Python 3.11+)
FROM node:20-bookworm-slim

# 2. Install the heavy mutation engines (FFmpeg & Python)
RUN apt-get update && apt-get install -y ffmpeg python3

# 3. Set up the working directory
WORKDIR /app

# 4. Copy over your package files and install dependencies
COPY package*.json ./
RUN npm install

# 5. Copy the rest of your backend code
COPY . .

# 6. Generate the Prisma Client for the database
RUN npx prisma generate

# 7. Expose the API port
EXPOSE 5000

# 8. Fire the dual-boot script
CMD ["npm", "start"]