import { withTransaction } from "./transactions";

export type StoryboardEntrypointLock = <T>(
  projectId: string,
  operation: () => Promise<T>
) => Promise<T>;

/** Serialize the storyboard find-or-create decision across API instances. */
export function createStoryboardEntrypointLock(
  transaction: typeof withTransaction = withTransaction
): StoryboardEntrypointLock {
  return (projectId, operation) =>
    transaction("storyboard.entrypoint.find_or_create", async (client) => {
      await client.query(
        "select pg_advisory_xact_lock(hashtextextended($1,0))",
        [`storyboard-entrypoint:${projectId}`]
      );
      return operation();
    });
}

export const withStoryboardEntrypointLock = createStoryboardEntrypointLock();
