// Shared "best available model" logic so the Agent run and the Help assistant make the same
// choice: a saved/preferred model if it's actually pulled, else the configured default if pulled,
// else the first available, else none.
export function bestAvailableModel(
  models: string[],
  defaultModel?: string,
  preferred?: string | null,
): string | null {
  if (preferred && models.includes(preferred)) return preferred;
  if (defaultModel && models.includes(defaultModel)) return defaultModel;
  return models[0] ?? null;
}
