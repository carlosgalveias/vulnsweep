import { OP_GET_SETTINGS, OP_SET_SETTINGS } from '@shared/renderer-api-opcodes.js';
import { useState, useEffect, useCallback, useRef } from 'react';

// Optimal = all sources except NVD (avoids rate limits while keeping broad coverage)
const OPTIMAL_SOURCES = ['npm-audit', 'osv', 'github-advisory', 'cisa-kev', 'epss'];

/** Default settings applied when no persisted settings exist */
const DEFAULTS = Object.freeze({
  enabledSources: OPTIMAL_SOURCES,
  allowReset: false,
  bumpVersion: true,
  removePackageLock: false,
  removeOverrides: false,
});

/**
 * useSettings — manages persisted scan settings (scan mode, enabled sources) via IPC.
 *
 * - Loads settings from `settings:get` IPC on mount.
 * - Merges partial persisted values with DEFAULTS so new settings keys are always present.
 * - `saveSettings(patch)` optimistically updates local state and persists via `settings:set`.
 *
 * @returns {{ settings: object, loading: boolean, saveSettings: Function, savedIndicator: boolean }}
 */
export default function useSettings() {
  const [settings, setSettings] = useState(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [savedIndicator, setSavedIndicator] = useState(false);

  // Keep a ref of current settings so saveSettings closure always captures fresh state
  const settingsRef = useRef(settings);
  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  // Dismiss the "Saved ✓" indicator after 2 s
  const savedTimerRef = useRef(null);
  const flashSaved = useCallback(() => {
    setSavedIndicator(true);
    if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
    savedTimerRef.current = setTimeout(() => setSavedIndicator(false), 2000);
  }, []);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
    };
  }, []);

  const loadSettings = useCallback(async () => {
    setLoading(true);
    try {
      const r = await window.electronAPI.invoke(OP_GET_SETTINGS);
      if (r && r.success && r.content && Object.keys(r.content).length > 0) {
        setSettings((prev) => ({ ...prev, ...r.content }));
      }
    } catch (e) {
      console.error('[useSettings] load failed:', e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * Merge `patch` into current settings, update state optimistically, and persist.
   * @param {Partial<typeof DEFAULTS>} patch
   */
  const saveSettings = useCallback(
    async (patch) => {
      const next = { ...settingsRef.current, ...patch };
      setSettings(next);
      try {
        const r = await window.electronAPI.invoke(OP_SET_SETTINGS, next);
        if (r && r.success) {
          flashSaved();
        } else {
          console.error('[useSettings] save rejected:', r?.error);
        }
      } catch (e) {
        console.error('[useSettings] save failed:', e.message);
      }
    },
    [flashSaved]
  );

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  return { settings, loading, saveSettings, savedIndicator };
}
