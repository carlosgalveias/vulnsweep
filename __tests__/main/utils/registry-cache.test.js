/**
 * Tests for RegistryCache
 *
 * Tests the npm registry response caching functionality
 */

const { CACHE_CONFIG } = require('../../../src/main/config/constants');
const RegistryCache = require('../../../src/main/utils/registry-cache');

describe('RegistryCache', () => {
  let cache;

  beforeEach(() => {
    cache = new RegistryCache(5000); // 5 second TTL for tests
  });

  afterEach(() => {
    cache.clear();
  });

  describe('constructor', () => {
    it('should create a cache instance with default TTL', () => {
      const defaultCache = new RegistryCache();
      expect(defaultCache).toBeInstanceOf(RegistryCache);
      expect(defaultCache.ttl).toBe(CACHE_CONFIG.TTL_MS);
    });

    it('should create a cache instance with custom TTL', () => {
      const customCache = new RegistryCache(10000);
      expect(customCache.ttl).toBe(10000);
    });
  });

  describe('getLatestVersion', () => {
    it('should fetch and cache latest version on cache miss', async () => {
      const mockFetch = jest.fn().mockResolvedValue('1.2.3');

      const result = await cache.getLatestVersion('test-package', mockFetch);

      expect(result.success).toBe(true);
      expect(result.content).toBe('1.2.3');
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledWith('test-package');
    });

    it('should return cached version on cache hit', async () => {
      const mockFetch = jest.fn().mockResolvedValue('1.2.3');

      // First call - cache miss
      await cache.getLatestVersion('test-package', mockFetch);

      // Second call - cache hit
      const result = await cache.getLatestVersion('test-package', mockFetch);

      expect(result.success).toBe(true);
      expect(result.content).toBe('1.2.3');
      expect(mockFetch).toHaveBeenCalledTimes(1); // Should only be called once
    });

    it('should cache null values to avoid repeated failures', async () => {
      const mockFetch = jest.fn().mockResolvedValue(null);

      const result1 = await cache.getLatestVersion('non-existent-package', mockFetch);
      const result2 = await cache.getLatestVersion('non-existent-package', mockFetch);

      expect(result1.success).toBe(false);
      expect(result1.error).toContain('Failed to fetch');
      expect(result2.success).toBe(false);
      expect(result2.error).toContain('cached error');
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should refetch after TTL expires', async () => {
      const shortTtlCache = new RegistryCache(100); // 100ms TTL
      const mockFetch = jest.fn().mockResolvedValueOnce('1.0.0').mockResolvedValueOnce('2.0.0');

      const result1 = await shortTtlCache.getLatestVersion('test-package', mockFetch);
      expect(result1.success).toBe(true);
      expect(result1.content).toBe('1.0.0');

      // Wait for TTL to expire
      await new Promise((resolve) => setTimeout(resolve, 150));

      const result2 = await shortTtlCache.getLatestVersion('test-package', mockFetch);
      expect(result2.success).toBe(true);
      expect(result2.content).toBe('2.0.0');
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });

  describe('getAllVersions', () => {
    it('should fetch and cache all versions on cache miss', async () => {
      const mockFetch = jest.fn().mockResolvedValue(['1.0.0', '1.1.0', '2.0.0']);

      const result = await cache.getAllVersions('test-package', mockFetch);

      expect(result.success).toBe(true);
      expect(result.content).toEqual(['1.0.0', '1.1.0', '2.0.0']);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should return cached versions on cache hit', async () => {
      const mockFetch = jest.fn().mockResolvedValue(['1.0.0', '1.1.0', '2.0.0']);

      await cache.getAllVersions('test-package', mockFetch);
      const result = await cache.getAllVersions('test-package', mockFetch);

      expect(result.success).toBe(true);
      expect(result.content).toEqual(['1.0.0', '1.1.0', '2.0.0']);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should handle null responses', async () => {
      const mockFetch = jest.fn().mockResolvedValue(null);

      const result = await cache.getAllVersions('bad-package', mockFetch);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Failed to fetch');
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('clear', () => {
    it('should clear all cached entries', async () => {
      const mockFetch = jest.fn().mockResolvedValue('1.0.0');

      await cache.getLatestVersion('package1', mockFetch);
      await cache.getLatestVersion('package2', mockFetch);

      cache.clear();

      const stats = cache.getStats();
      expect(stats.total).toBe(0);
    });
  });

  describe('getStats', () => {
    it('should return correct statistics', async () => {
      const mockFetch = jest.fn().mockResolvedValue('1.0.0');

      await cache.getLatestVersion('package1', mockFetch);
      await cache.getLatestVersion('package2', mockFetch);

      const stats = cache.getStats();

      expect(stats.total).toBe(2);
      expect(stats.active).toBe(2);
      expect(stats.expired).toBe(0);
      expect(stats.ttl).toBe(5000);
      expect(stats.ttlSeconds).toBe(5);
    });

    it('should track expired entries', async () => {
      const shortTtlCache = new RegistryCache(100);
      const mockFetch = jest.fn().mockResolvedValue('1.0.0');

      await shortTtlCache.getLatestVersion('package1', mockFetch);

      // Wait for expiry
      await new Promise((resolve) => setTimeout(resolve, 150));

      const stats = shortTtlCache.getStats();
      expect(stats.expired).toBe(1);
      expect(stats.active).toBe(0);
    });
  });

  describe('pruneExpired', () => {
    it('should remove expired entries', async () => {
      const shortTtlCache = new RegistryCache(100);
      const mockFetch = jest.fn().mockResolvedValue('1.0.0');

      await shortTtlCache.getLatestVersion('package1', mockFetch);
      await shortTtlCache.getLatestVersion('package2', mockFetch);

      // Wait for expiry
      await new Promise((resolve) => setTimeout(resolve, 150));

      const pruned = shortTtlCache.pruneExpired();

      expect(pruned).toBe(2);
      expect(shortTtlCache.getStats().total).toBe(0);
    });

    it('should not remove active entries', async () => {
      const mockFetch = jest.fn().mockResolvedValue('1.0.0');

      await cache.getLatestVersion('package1', mockFetch);

      const pruned = cache.pruneExpired();

      expect(pruned).toBe(0);
      expect(cache.getStats().total).toBe(1);
    });
  });

  describe('cache key separation', () => {
    it('should maintain separate caches for latest vs all versions', async () => {
      const mockLatestFetch = jest.fn().mockResolvedValue('2.0.0');
      const mockAllFetch = jest.fn().mockResolvedValue(['1.0.0', '1.1.0', '2.0.0']);

      const latestResult = await cache.getLatestVersion('test-package', mockLatestFetch);
      const allResult = await cache.getAllVersions('test-package', mockAllFetch);

      expect(latestResult.success).toBe(true);
      expect(latestResult.content).toBe('2.0.0');
      expect(allResult.success).toBe(true);
      expect(allResult.content).toEqual(['1.0.0', '1.1.0', '2.0.0']);
      expect(mockLatestFetch).toHaveBeenCalledTimes(1);
      expect(mockAllFetch).toHaveBeenCalledTimes(1);

      const stats = cache.getStats();
      expect(stats.total).toBe(2); // One for latest, one for all
    });
  });
});
