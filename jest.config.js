/**
 * Jest Configuration for VulnSweep
 *
 * Configured for testing both:
 * - Node.js backend modules (audit, git, discovery, registry-cache)
 * - React frontend components
 */

module.exports = {
  // Test environment - using node as default, components will override
  testEnvironment: 'node',

  // Test file patterns
  testMatch: [
    '**/__tests__/**/*.test.js',
    '**/__tests__/**/*.spec.js',
    '**/__tests__/**/*.test.jsx',
    '**/__tests__/**/*.spec.jsx',
  ],

  // Coverage collection
  collectCoverageFrom: [
    'src/**/*.{js,jsx}',
    '!src/**/*.test.{js,jsx}',
    '!src/**/*.spec.{js,jsx}',
    '!**/node_modules/**',
    '!**/dist/**',
    '!**/dist-renderer/**',
    '!**/build/**',
    '!**/__tests__/**',
  ],

  // Coverage thresholds - 30% minimum as per requirements
  coverageThreshold: {
    global: {
      branches: 30,
      functions: 30,
      lines: 30,
      statements: 30,
    },
  },

  // Coverage reporters
  coverageReporters: ['text', 'text-summary', 'html', 'lcov'],

  // Coverage directory
  coverageDirectory: 'coverage',

  // Module paths
  roots: ['<rootDir>/src', '<rootDir>/__tests__'],

  // Setup files for React Testing Library
  setupFilesAfterEnv: ['<rootDir>/__tests__/setup.js'],

  // Transform configuration for JSX
  transform: {
    '^.+\\.jsx?$': [
      'babel-jest',
      {
        presets: [
          ['@babel/preset-env', { targets: { node: 'current' } }],
          ['@babel/preset-react', { runtime: 'automatic' }],
        ],
      },
    ],
  },

  // Module name mapper for CSS and assets
  moduleNameMapper: {
    '\\.(css|less|scss|sass)$': '<rootDir>/__tests__/utils/style-mock.js',
    '\\.(jpg|jpeg|png|gif|svg)$': '<rootDir>/__tests__/utils/file-mock.js',
    '^lucide-react$': '<rootDir>/__tests__/utils/lucide-mock.js',
  },

  // Ignore patterns
  testPathIgnorePatterns: ['/node_modules/', '/dist/', '/dist-renderer/', '/build/'],

  // Clear mocks between tests
  clearMocks: true,

  // Restore mocks between tests
  restoreMocks: true,

  // Verbose output
  verbose: true,

  // Test timeout (10 seconds)
  testTimeout: 10000,

  // Projects configuration for different environments
  projects: [
    {
      displayName: 'backend',
      testEnvironment: 'node',
      testMatch: ['**/__tests__/main/**/*.test.js', '**/__tests__/main/**/*.spec.js'],
    },
    {
      displayName: 'frontend',
      testEnvironment: 'jsdom',
      testMatch: ['**/__tests__/renderer/**/*.test.jsx', '**/__tests__/renderer/**/*.spec.jsx'],
      setupFilesAfterEnv: ['<rootDir>/__tests__/setup.js'],
      transform: {
        '^.+\\.jsx?$': [
          'babel-jest',
          {
            presets: [
              ['@babel/preset-env', { targets: { node: 'current' } }],
              ['@babel/preset-react', { runtime: 'automatic' }],
            ],
          },
        ],
      },
      moduleNameMapper: {
        '\\.(css|less|scss|sass)$': '<rootDir>/__tests__/utils/style-mock.js',
        '\\.(jpg|jpeg|png|gif|svg)$': '<rootDir>/__tests__/utils/file-mock.js',
        '^lucide-react$': '<rootDir>/__tests__/utils/lucide-mock.js',
      },
    },
  ],
};
