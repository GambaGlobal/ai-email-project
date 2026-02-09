export type DbClient = {
  readonly __brand: "DbClient";
};

export function createDbClient(): DbClient {
  throw new Error("Not implemented");
}
