FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG GIT_SHA=unknown
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV APP_GIT_SHA=$GIT_SHA
RUN npm run build

FROM alpine:3.21 AS runner
RUN apk add --no-cache libstdc++
COPY --from=deps /usr/local/bin/node /usr/local/bin/node
WORKDIR /app
ARG GIT_SHA=unknown
ENV NODE_ENV=production
ENV APP_GIT_SHA=$GIT_SHA
RUN addgroup --system nextjs && adduser --system --ingroup nextjs nextjs
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
EXPOSE 3000
USER nextjs
CMD ["node", "server.js"]
