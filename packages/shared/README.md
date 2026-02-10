# Shared Package

Purpose: Shared types and utilities.

Boundary: No implementation yet.

## Mail provider abstraction
Exports canonical mail DTOs and the `MailProvider` interface used by provider adapters.
See `docs/architecture/contracts.md` for contract details.

## Pipeline contracts
Exports shared job, run, and audit event types for the mail processing pipeline.

## Queue contracts
Exports queue names, default retry policy, and a helper to build mail job envelopes.
