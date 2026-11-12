FROM oven/bun:1.4.4 AS bun
FROM mcr.microsoft.com/playwright:v1.65.0-noble@sha256:9beb546099e11f52d62e505537914870e01a67e0e6b00ae41da4775324e73dbe
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
WORKDIR /work
