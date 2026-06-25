import {
  OP_GET_CREDENTIAL_STATUS,
  OP_SET_CREDENTIAL,
  OP_DELETE_CREDENTIAL,
} from '@shared/renderer-api-opcodes.js';
import { useState, useEffect, useCallback } from 'react';

/**
 * Custom hook for managing source credential state in the renderer.
 *
 * Security contract:
 *   - Plaintext credentials exist ONLY inside CredentialsPanel row state, never here.
 *   - This hook stores only `configured` booleans and `maskedHint` strings.
 *   - `saveCredential` receives the plaintext from the component, forwards it to the
 *     main process via IPC, then discards it — no plaintext is retained in this hook.
 *
 * @returns {{
 *   credentials: Record<string, { configured: boolean, maskedHint: string|null }>,
 *   loading: boolean,
 *   saveCredential: (sourceId: string, plaintext: string) => Promise<{ success: boolean, maskedHint?: string, error?: string }>,
 *   deleteCredential: (sourceId: string) => Promise<{ success: boolean, error?: string }>,
 * }}
 */
export default function useCredentials() {
  const [credentials, setCredentials] = useState({
    'github-advisory': { configured: false, maskedHint: null },
  });
  const [loading, setLoading] = useState(false);

  /**
   * Load configured status for all credential sources from the main process.
   * Called on mount and after any save/delete operation.
   */
  const loadCredentialStatus = useCallback(async () => {
    setLoading(true);
    try {
      const r = await window.electronAPI.invoke(OP_GET_CREDENTIAL_STATUS);
      if (r.success) {
        setCredentials(r.content);
      }
    } catch (e) {
      console.error('[useCredentials] load failed:', e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * Store an encrypted credential for the given source.
   * The plaintext is forwarded directly to the IPC call and is never stored in
   * hook state — this function accepts it as a parameter only for transport.
   *
   * On success, updates local credential state with the masked hint returned
   * by the main process (never the plaintext).
   *
   * @param {string} sourceId - Source identifier (e.g. 'github-advisory')
   * @param {string} plaintext - The credential value to encrypt and store
   * @returns {Promise<{ success: boolean, maskedHint?: string, error?: string }>}
   */
  const saveCredential = useCallback(async (sourceId, plaintext) => {
    const r = await window.electronAPI
      .invoke(OP_SET_CREDENTIAL, sourceId, plaintext)
      .catch((e) => ({ success: false, error: e.message }));

    if (r.success) {
      setCredentials((prev) => ({
        ...prev,
        [sourceId]: { configured: true, maskedHint: r.maskedHint ?? null },
      }));
    }
    return r;
  }, []);

  /**
   * Delete a stored credential for the given source.
   * On success, resets the local state entry to unconfigured.
   *
   * @param {string} sourceId - Source identifier
   * @returns {Promise<{ success: boolean, error?: string }>}
   */
  const deleteCredential = useCallback(async (sourceId) => {
    const r = await window.electronAPI
      .invoke(OP_DELETE_CREDENTIAL, sourceId)
      .catch((e) => ({ success: false, error: e.message }));

    if (r.success) {
      setCredentials((prev) => ({
        ...prev,
        [sourceId]: { configured: false, maskedHint: null },
      }));
    }
    return r;
  }, []);

  // Load credential status on mount
  useEffect(() => {
    loadCredentialStatus();
  }, [loadCredentialStatus]);

  return { credentials, loading, saveCredential, deleteCredential };
}
