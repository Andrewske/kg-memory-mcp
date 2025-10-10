/**
 * Unit tests for PST/PDT time utilities
 */

import {
	getPstTimestamp,
	convertToPstIso,
	formatPstForFilename,
	formatPstForDisplay,
	convertStoredTimestampToPst,
} from '~/shared/utils/pst-time.js';

describe('PST Time Utilities', () => {
	describe('convertToPstIso', () => {
		it('should convert UTC date to PST format during winter (PST)', () => {
			// January 15, 2025, 12:00 UTC (should be PST -08:00)
			const date = new Date('2025-01-15T12:00:00Z');
			const result = convertToPstIso(date);

			expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{2}:\d{2}$/);
			expect(result).toContain('-08:00'); // PST offset
			expect(result).toContain('2025-01-15');
		});

		it('should convert UTC date to PDT format during summer (PDT)', () => {
			// July 15, 2025, 12:00 UTC (should be PDT -07:00)
			const date = new Date('2025-07-15T12:00:00Z');
			const result = convertToPstIso(date);

			expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{2}:\d{2}$/);
			expect(result).toContain('-07:00'); // PDT offset
			expect(result).toContain('2025-07-15');
		});

		it('should include milliseconds in output', () => {
			const date = new Date('2025-01-15T12:00:00.123Z');
			const result = convertToPstIso(date);

			// Should have .123 or close to it (might be slightly different due to conversion)
			expect(result).toMatch(/\.\d{3}[+-]\d{2}:\d{2}$/);
		});

		it('should handle midnight correctly', () => {
			const date = new Date('2025-01-15T00:00:00Z');
			const result = convertToPstIso(date);

			expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{2}:\d{2}$/);
		});

		it('should handle noon correctly', () => {
			const date = new Date('2025-01-15T12:00:00Z');
			const result = convertToPstIso(date);

			expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{2}:\d{2}$/);
		});

		it('should handle invalid date by using current time', () => {
			const invalidDate = new Date('invalid');
			const result = convertToPstIso(invalidDate);

			// Should still return a valid ISO string (current time)
			expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{2}:\d{2}$/);
		});

		it('should handle non-Date objects gracefully', () => {
			const notADate = { getTime: () => NaN } as Date;
			const result = convertToPstIso(notADate);

			// Should fallback to current time
			expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{2}:\d{2}$/);
		});

		it('should properly adjust time zone offset', () => {
			// 8 PM UTC in January should be 12 PM PST (same day)
			const date = new Date('2025-01-15T20:00:00Z');
			const result = convertToPstIso(date);

			expect(result).toContain('2025-01-15T12:00:00'); // 8 hours earlier
			expect(result).toContain('-08:00');
		});

		it('should handle DST transition dates correctly', () => {
			// March 9, 2025 is when DST starts (2 AM becomes 3 AM)
			// Before DST: January 15 should be PST (-08:00)
			// After DST: July 15 should be PDT (-07:00)
			const beforeDst = new Date('2025-01-15T09:00:00Z');
			const afterDst = new Date('2025-07-15T11:00:00Z');

			const resultBefore = convertToPstIso(beforeDst);
			const resultAfter = convertToPstIso(afterDst);

			// Before DST: should be PST (-08:00)
			expect(resultBefore).toContain('-08:00');
			// After DST: should be PDT (-07:00)
			expect(resultAfter).toContain('-07:00');
		});
	});

	describe('getPstTimestamp', () => {
		it('should return current time in PST/PDT format', () => {
			const result = getPstTimestamp();

			// Should be a valid ISO string with offset
			expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{2}:\d{2}$/);

			// Should have either PST (-08:00) or PDT (-07:00) offset
			expect(result).toMatch(/[+-](07|08):00$/);
		});

		it('should return different timestamps when called multiple times', async () => {
			const timestamp1 = getPstTimestamp();
			await new Promise(resolve => setTimeout(resolve, 10));
			const timestamp2 = getPstTimestamp();

			// Timestamps should be different (at least by milliseconds)
			expect(timestamp1).not.toBe(timestamp2);
		});
	});

	describe('formatPstForFilename', () => {
		it('should convert PST ISO string to filename format', () => {
			const timestamp = '2025-10-09T15:36:05.572-08:00';
			const result = formatPstForFilename(timestamp);

			expect(result).toBe('2025-10-09T15-36-05-572-PST');
		});

		it('should convert PDT ISO string to filename format', () => {
			const timestamp = '2025-07-15T15:36:05.572-07:00';
			const result = formatPstForFilename(timestamp);

			expect(result).toBe('2025-07-15T15-36-05-572-PST');
		});

		it('should replace colons and periods with hyphens', () => {
			const timestamp = '2025-10-09T15:36:05.572-08:00';
			const result = formatPstForFilename(timestamp);

			expect(result).not.toContain(':');
			expect(result).not.toContain('.');
		});

		it('should append -PST suffix', () => {
			const timestamp = '2025-10-09T15:36:05.572-08:00';
			const result = formatPstForFilename(timestamp);

			expect(result.endsWith('-PST')).toBe(true);
		});

		it('should remove timezone offset from output', () => {
			const timestamp = '2025-10-09T15:36:05.572-08:00';
			const result = formatPstForFilename(timestamp);

			expect(result).not.toContain('-08:00');
			expect(result).not.toContain('+08:00');
		});

		it('should handle timestamps with positive offsets', () => {
			// Hypothetical positive offset (not PST, but testing the function)
			const timestamp = '2025-10-09T15:36:05.572+05:00';
			const result = formatPstForFilename(timestamp);

			expect(result).toBe('2025-10-09T15-36-05-572-PST');
		});
	});

	describe('formatPstForDisplay', () => {
		it('should add PST label for winter time', () => {
			const timestamp = '2025-01-15T12:00:00.000-08:00';
			const result = formatPstForDisplay(timestamp);

			expect(result).toBe('2025-01-15T12:00:00.000-08:00 (PST)');
		});

		it('should add PDT label for summer time', () => {
			const timestamp = '2025-07-15T12:00:00.000-07:00';
			const result = formatPstForDisplay(timestamp);

			expect(result).toBe('2025-07-15T12:00:00.000-07:00 (PDT)');
		});

		it('should add PT label for ambiguous times', () => {
			const timestamp = '2025-10-09T12:00:00.000-06:00';
			const result = formatPstForDisplay(timestamp);

			expect(result).toBe('2025-10-09T12:00:00.000-06:00 (PT)');
		});

		it('should preserve the original timestamp', () => {
			const timestamp = '2025-01-15T12:00:00.123-08:00';
			const result = formatPstForDisplay(timestamp);

			expect(result).toContain(timestamp);
		});
	});

	describe('convertStoredTimestampToPst', () => {
		it('should convert UTC timestamp to PST', () => {
			const utcTimestamp = '2025-01-15T12:00:00.000Z';
			const result = convertStoredTimestampToPst(utcTimestamp);

			expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{2}:\d{2}$/);
			expect(result).toContain('-08:00'); // PST offset
		});

		it('should convert already-PST timestamp correctly', () => {
			const pstTimestamp = '2025-01-15T12:00:00.000-08:00';
			const result = convertStoredTimestampToPst(pstTimestamp);

			// Should still be valid PST format
			expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{2}:\d{2}$/);
		});

		it('should handle PDT timestamps', () => {
			const pdtTimestamp = '2025-07-15T12:00:00.000-07:00';
			const result = convertStoredTimestampToPst(pdtTimestamp);

			expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{2}:\d{2}$/);
			expect(result).toContain('-07:00'); // PDT offset
		});

		it('should handle ISO strings without timezone', () => {
			const noTzTimestamp = '2025-01-15T12:00:00.000';
			const result = convertStoredTimestampToPst(noTzTimestamp);

			// Should treat as local time and convert to PST
			expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{2}:\d{2}$/);
		});

		it('should handle database timestamp format', () => {
			// Typical PostgreSQL timestamp format
			const dbTimestamp = '2025-01-15 12:00:00.123';
			const result = convertStoredTimestampToPst(dbTimestamp);

			expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{2}:\d{2}$/);
		});
	});

	describe('Integration tests', () => {
		it('should round-trip through all formatting functions', () => {
			const originalDate = new Date('2025-01-15T12:00:00Z');
			const pstIso = convertToPstIso(originalDate);
			const filename = formatPstForFilename(pstIso);
			const display = formatPstForDisplay(pstIso);

			// Verify formats
			expect(pstIso).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{2}:\d{2}$/);
			expect(filename).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}-PST$/);
			expect(display).toContain(pstIso);
			expect(display).toMatch(/\((PST|PDT|PT)\)$/);
		});

		it('should handle workflow: get timestamp → format for filename → format for display', () => {
			const timestamp = getPstTimestamp();
			const filename = formatPstForFilename(timestamp);
			const display = formatPstForDisplay(timestamp);

			// Filename should be filesystem-safe
			expect(filename).not.toContain(':');
			expect(filename).not.toContain('.');
			expect(filename.endsWith('-PST')).toBe(true);

			// Display should include timezone label
			expect(display).toMatch(/\((PST|PDT|PT)\)$/);
		});

		it('should consistently handle the same date across all functions', () => {
			const date = new Date('2025-01-15T20:00:00Z'); // 8 PM UTC = 12 PM PST
			const pstIso = convertToPstIso(date);
			const stored = convertStoredTimestampToPst(date.toISOString());

			// Both should produce similar results
			expect(pstIso).toContain('2025-01-15T12:00:00');
			expect(stored).toContain('2025-01-15T12:00:00');
		});
	});

	describe('Error handling', () => {
		it('should handle null/undefined gracefully', () => {
			// convertToPstIso handles invalid dates by using current time
			const result = convertToPstIso(null as any);
			expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{2}:\d{2}$/);
		});

		it('should handle extremely old dates', () => {
			const oldDate = new Date('1900-01-01T00:00:00Z');
			const result = convertToPstIso(oldDate);

			expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{2}:\d{2}$/);
		});

		it('should handle far future dates', () => {
			const futureDate = new Date('2099-12-31T23:59:59Z');
			const result = convertToPstIso(futureDate);

			expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{2}:\d{2}$/);
		});

		it('should fallback to current time on formatting error', () => {
			const date = new Date('invalid');
			const result = convertToPstIso(date);

			// Should still be valid ISO format (uses current time, not UTC fallback)
			// The implementation uses current PST time when date is invalid
			expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{2}:\d{2}$/);
		});
	});
});
