/** Encode a team filter key for use as a MongoDB map subkey. */
export function encodeTeamQueueProgressKey(queueKey: string): string {
  return encodeURIComponent(queueKey).replace(
    /[.!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/** Restore a team filter key from its MongoDB-safe map subkey. */
export function decodeTeamQueueProgressKey(storageKey: string): string {
  return decodeURIComponent(storageKey);
}
