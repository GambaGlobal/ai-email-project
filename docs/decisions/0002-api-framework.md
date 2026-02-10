# 0002 - API Framework

## Context
We need a minimal HTTP server to expose health checks and later API endpoints. The stack requires a single chosen framework to avoid churn.

## Decision
Use Fastify for the API service.

## Alternatives
- Hono (rejected for now to keep alignment with the chosen default).

## Consequences
- API endpoints will be implemented on Fastify.
- New services should follow the same framework unless a new Decision Record amends this choice.

## Date
2026-02-10
