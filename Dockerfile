# Build stage
FROM node:20-alpine AS builder

# Install pnpm
RUN npm install -g pnpm@9

WORKDIR /app

# Copy workspace files
COPY pnpm-workspace.yaml ./
COPY package.json ./
COPY backend/package.json ./backend/

# Copy tsconfig for backend
COPY backend/tsconfig.json ./backend/

# Copy source code
COPY backend/src ./backend/src

# Install dependencies (all workspaces)
RUN pnpm install --frozen-lockfile

# Build TypeScript
RUN cd backend && pnpm build

# Runtime stage
FROM node:20-alpine

# Install pnpm (needed for start script if it uses pnpm)
RUN npm install -g pnpm@9

WORKDIR /app

# Copy only necessary files from builder
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/backend/dist ./dist
COPY --from=builder /app/backend/package.json ./package.json

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (r) => {if (r.statusCode !== 200) throw new Error(r.statusCode)})"

# Start compiled application
CMD ["node", "dist/index.js"]

EXPOSE 3000
