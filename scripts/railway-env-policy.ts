/**
 * Which credentials a Railway service may hold (SEC-05).
 *
 * The sync derives a service's variables from the keys its config reads. That
 * is convenient and wrong for secrets: a key a config happens to read is not a
 * key the service should be handed. Every sensitive key therefore has to be on
 * the service's reviewed list, or on its explicit withheld list, or the sync
 * refuses to run. Adding a secret to a config is a deliberate edit here.
 */

const SENSITIVE =
  /PRIVATE_KEY|SECRET|(^|_)TOKEN$|PASSWORD|XPUB|SEED|API_KEY$|ENCRYPTION_KEY|TOKEN_KEY|ACCESS_KEY_ID/;

export function isSensitive(key: string): boolean {
  return SENSITIVE.test(key);
}

export interface SecretPolicy {
  /** Sensitive keys this service has been reviewed to need. */
  readonly allowed: ReadonlySet<string>;
  /** Sensitive keys the config reads but this service must never hold. */
  readonly withheld: ReadonlySet<string>;
}

/** Sensitive keys the config reads that nobody has decided about. */
export function unreviewedKeys(
  configKeys: readonly string[],
  policy: SecretPolicy,
): readonly string[] {
  return configKeys
    .filter((key) => isSensitive(key) && !policy.allowed.has(key) && !policy.withheld.has(key))
    .sort();
}

/** Sensitive variables already on the service that its policy does not allow. */
export function unexpectedRemoteSecrets(
  remoteKeys: readonly string[],
  policy: SecretPolicy,
): readonly string[] {
  return remoteKeys.filter((key) => isSensitive(key) && !policy.allowed.has(key)).sort();
}
