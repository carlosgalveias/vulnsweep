'use strict';

const { mergeSeverity } = require('../../../../src/main/modules/enrichment/severity-merger');

describe('severity-merger mergeSeverity()', () => {
  describe('boundary condition: UNKNOWN vs null', () => {
    it('mergeSeverity("unknown", null, null) returns mergedSeverity of "UNKNOWN"', () => {
      const result = mergeSeverity('unknown', null, null);
      expect(result.mergedSeverity).toBe('UNKNOWN');
    });

    it('mergeSeverity(null, null, null) returns mergedSeverity of null (no candidates)', () => {
      const result = mergeSeverity(null, null, null);
      expect(result.mergedSeverity).toBeNull();
    });
  });

  describe('4th parameter (ghaSeverity)', () => {
    it('mergeSeverity(null, null, null, "high") returns mergedSeverity of "HIGH"', () => {
      const result = mergeSeverity(null, null, null, 'high');
      expect(result.mergedSeverity).toBe('HIGH');
    });

    it('mergeSeverity("moderate", null, null, "high") returns mergedSeverity of "HIGH"', () => {
      const result = mergeSeverity('moderate', null, null, 'high');
      expect(result.mergedSeverity).toBe('HIGH');
    });

    it('ghaSeverity does not override a higher existing severity', () => {
      const result = mergeSeverity('critical', null, null, 'high');
      expect(result.mergedSeverity).toBe('CRITICAL');
    });
  });

  describe('backward compatibility', () => {
    it('calling with 3 args still works correctly', () => {
      const result = mergeSeverity('high', 'medium', null);
      expect(result.mergedSeverity).toBe('HIGH');
    });

    it('calling with 3 args and nvdCvssScore works', () => {
      const result = mergeSeverity('low', null, 9.5);
      expect(result.mergedSeverity).toBe('CRITICAL');
      expect(result.nvdCategory).toBe('CRITICAL');
    });
  });
});
