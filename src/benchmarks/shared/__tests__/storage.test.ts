/**
 * Unit tests for benchmark storage functionality
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import {
	saveBenchmarkResult,
	loadBenchmarkResults,
	cleanOldResults,
} from '../storage.js';
import type { BenchmarkMetrics } from '../types.js';

// Mock the results directory
const TEST_RESULTS_DIR = path.join(process.cwd(), 'benchmarks/results');

// Helper to create a valid BenchmarkMetrics object
function createTestMetrics(overrides: Partial<BenchmarkMetrics> = {}): BenchmarkMetrics {
	return {
		id: crypto.randomUUID(),
		timestamp: new Date().toISOString(),
		benchmark_type: 'pipeline',
		config: {
			model: 'gpt-4o-mini',
			provider: 'openai',
			extraction_method: 'four-stage',
			prompt_version: 'v1.0',
		},
		performance: {
			total_duration_ms: 5000,
			tokens_per_second: 100,
			ms_per_token: 10,
			memory_used_mb: 50,
		},
		quality: {
			triples_generated: 100,
			triples_extracted: 90,
			avg_confidence: 0.85,
		},
		cost: {
			input_tokens: 500,
			output_tokens: 300,
			total_tokens: 800,
			estimated_cost_usd: 0.01,
			api_calls: 5,
		},
		notes: 'Test benchmark run',
		...overrides,
	};
}

describe('Benchmark Storage', () => {
	const testType = 'pipeline';
	const testDir = path.join(TEST_RESULTS_DIR, testType);
	const csvPath = path.join(TEST_RESULTS_DIR, 'metrics.csv');

	beforeEach(async () => {
		// Clean up test directory before each test
		try {
			await fs.rm(testDir, { recursive: true, force: true });
		} catch {
			// Directory might not exist
		}
		// Clean up CSV file
		try {
			await fs.unlink(csvPath);
		} catch {
			// File might not exist
		}
	});

	afterEach(async () => {
		// Clean up test directory after each test
		try {
			await fs.rm(testDir, { recursive: true, force: true });
		} catch {
			// Directory might not exist
		}
		// Clean up CSV file
		try {
			await fs.unlink(csvPath);
		} catch {
			// File might not exist
		}
	});

	describe('saveBenchmarkResult', () => {
		it('should save JSON, MD, and CSV files', async () => {
			const metrics = createTestMetrics();
			const result = await saveBenchmarkResult(metrics);

			// Check that result contains expected paths
			expect(result.jsonPath).toContain('.json');
			expect(result.mdPath).toContain('.md');
			expect(result.metrics).toEqual(metrics);

			// Verify files exist
			await expect(fs.access(result.jsonPath)).resolves.toBeUndefined();
			await expect(fs.access(result.mdPath)).resolves.toBeUndefined();

			// Verify JSON content
			const jsonContent = await fs.readFile(result.jsonPath, 'utf-8');
			const parsed = JSON.parse(jsonContent);
			expect(parsed.id).toBe(metrics.id);
			expect(parsed.benchmark_type).toBe(metrics.benchmark_type);

			// Verify Markdown content contains key sections
			const mdContent = await fs.readFile(result.mdPath, 'utf-8');
			expect(mdContent).toContain('# Benchmark Report');
			expect(mdContent).toContain('⚡ Performance Metrics');
			expect(mdContent).toContain('📊 Quality Metrics');
			expect(mdContent).toContain('💰 Cost Analysis');
		});

		it('should create CSV header if file does not exist', async () => {
			const metrics = createTestMetrics();
			await saveBenchmarkResult(metrics);

			const csvPath = path.join(TEST_RESULTS_DIR, 'metrics.csv');
			const csvContent = await fs.readFile(csvPath, 'utf-8');

			// Check header exists
			expect(csvContent).toContain('id,timestamp,benchmark_type');

			// Check data row exists
			expect(csvContent).toContain(metrics.id);
			expect(csvContent).toContain(metrics.benchmark_type);
		});

		it('should append to existing CSV without duplicate headers', async () => {
			const id1 = crypto.randomUUID();
			const id2 = crypto.randomUUID();
			const metrics1 = createTestMetrics({ id: id1 });
			const metrics2 = createTestMetrics({ id: id2 });

			await saveBenchmarkResult(metrics1);
			await saveBenchmarkResult(metrics2);

			const csvPath = path.join(TEST_RESULTS_DIR, 'metrics.csv');
			const csvContent = await fs.readFile(csvPath, 'utf-8');
			const lines = csvContent.trim().split('\n');

			// Should have 1 header + 2 data rows
			expect(lines.length).toBe(3);
			expect(lines[0]).toContain('id,timestamp,benchmark_type');
			expect(lines[1]).toContain(id1);
			expect(lines[2]).toContain(id2);
		});

		it('should throw error for invalid metrics (Zod validation)', async () => {
			const invalidMetrics = {
				id: 'test',
				// Missing required fields
			} as any;

			await expect(saveBenchmarkResult(invalidMetrics)).rejects.toThrow();
		});

		it('should handle notes with special characters in CSV', async () => {
			const metrics = createTestMetrics({
				notes: 'Test with "quotes" and commas, and newlines',
			});

			await saveBenchmarkResult(metrics);

			const csvPath = path.join(TEST_RESULTS_DIR, 'metrics.csv');
			const csvContent = await fs.readFile(csvPath, 'utf-8');

			// Notes should be properly quoted
			expect(csvContent).toContain('"Test with ""quotes"" and commas, and newlines"');
		});
	});

	describe('loadBenchmarkResults', () => {
		// Store IDs for assertions
		const resultIds = {
			result1: crypto.randomUUID(),
			result2: crypto.randomUUID(),
			result3: crypto.randomUUID(),
		};

		beforeEach(async () => {
			// Create test results
			const metrics1 = createTestMetrics({
				id: resultIds.result1,
				timestamp: '2025-10-08T12:00:00.000Z',
				config: { ...createTestMetrics().config, prompt_version: 'v1.0' },
			});
			const metrics2 = createTestMetrics({
				id: resultIds.result2,
				timestamp: '2025-10-09T12:00:00.000Z',
				config: { ...createTestMetrics().config, prompt_version: 'v1.0' },
			});
			const metrics3 = createTestMetrics({
				id: resultIds.result3,
				timestamp: '2025-10-10T12:00:00.000Z',
				config: { ...createTestMetrics().config, prompt_version: 'v2.0' },
			});

			await saveBenchmarkResult(metrics1);
			await saveBenchmarkResult(metrics2);
			await saveBenchmarkResult(metrics3);
		});

		it('should load all results without filters', async () => {
			const results = await loadBenchmarkResults(testType);
			expect(results.length).toBe(3);
		});

		it('should filter by last N results', async () => {
			const results = await loadBenchmarkResults(testType, { last: 2 });

			expect(results.length).toBe(2);
			// Should get most recent results
			expect(results[0].id).toBe(resultIds.result3);
			expect(results[1].id).toBe(resultIds.result2);
		});

		it('should filter by prompt version', async () => {
			const results = await loadBenchmarkResults(testType, {
				promptVersion: 'v2.0'
			});

			expect(results.length).toBe(1);
			expect(results[0].id).toBe(resultIds.result3);
		});

		it('should filter by IDs', async () => {
			const results = await loadBenchmarkResults(testType, {
				ids: [resultIds.result1, resultIds.result3]
			});

			expect(results.length).toBe(2);
			const ids = results.map(r => r.id).sort();
			const expectedIds = [resultIds.result1, resultIds.result3].sort();
			expect(ids).toEqual(expectedIds);
		});

		it('should filter by date range', async () => {
			const results = await loadBenchmarkResults(testType, {
				from: new Date('2025-10-09T00:00:00.000Z'),
				to: new Date('2025-10-10T23:59:59.999Z'),
			});

			expect(results.length).toBe(2);
			const ids = results.map(r => r.id).sort();
			const expectedIds = [resultIds.result2, resultIds.result3].sort();
			expect(ids).toEqual(expectedIds);
		});

		it('should combine multiple filters', async () => {
			const results = await loadBenchmarkResults(testType, {
				last: 2,
				promptVersion: 'v1.0',
			});

			// Last 2 results, but only v1.0 → should get result-2 only
			expect(results.length).toBe(1);
			expect(results[0].id).toBe(resultIds.result2);
		});

		it('should return empty array for non-existent benchmark type', async () => {
			const results = await loadBenchmarkResults('non-existent-type');
			expect(results).toEqual([]);
		});
	});

	describe('cleanOldResults', () => {
		const cleanupIds: string[] = [];

		beforeEach(async () => {
			// Create 15 test results
			for (let i = 1; i <= 15; i++) {
				const id = crypto.randomUUID();
				cleanupIds.push(id);
				const metrics = createTestMetrics({
					id,
					timestamp: `2025-10-${String(i).padStart(2, '0')}T12:00:00.000Z`,
				});
				await saveBenchmarkResult(metrics);
			}
		});

		afterEach(() => {
			cleanupIds.length = 0;
		});

		it('should keep only last N results', async () => {
			const deletedCount = await cleanOldResults(testType, 10);

			expect(deletedCount).toBe(5); // 15 - 10 = 5 deleted

			const remaining = await loadBenchmarkResults(testType);
			expect(remaining.length).toBe(10);

			// Should keep most recent 10
			const remainingIds = remaining.map(r => r.id);
			expect(remainingIds).toContain(cleanupIds[14]); // Most recent
			expect(remainingIds).toContain(cleanupIds[5]); // 6th from end
			expect(remainingIds).not.toContain(cleanupIds[0]); // Oldest
			expect(remainingIds).not.toContain(cleanupIds[4]); // 5th oldest
		});

		it('should delete both JSON and MD files', async () => {
			await cleanOldResults(testType, 10);

			// Check that old files are gone
			const files = await fs.readdir(testDir);
			const jsonFiles = files.filter(f => f.endsWith('.json'));
			const mdFiles = files.filter(f => f.endsWith('.md'));

			expect(jsonFiles.length).toBe(10);
			expect(mdFiles.length).toBe(10);
		});

		it('should return 0 if fewer than keepLast results exist', async () => {
			const deletedCount = await cleanOldResults(testType, 20);
			expect(deletedCount).toBe(0);
		});

		it('should return 0 for non-existent benchmark type', async () => {
			const deletedCount = await cleanOldResults('non-existent-type', 10);
			expect(deletedCount).toBe(0);
		});
	});

	describe('Markdown report generation', () => {
		it('should include fixture info when provided', async () => {
			const metrics = createTestMetrics({
				fixture_info: {
					filename: 'test-fixture.md',
					char_count: 8668,
					estimated_tokens: 2167,
				},
			});

			const result = await saveBenchmarkResult(metrics);
			const mdContent = await fs.readFile(result.mdPath, 'utf-8');

			expect(mdContent).toContain('**Input File**: test-fixture.md');
			expect(mdContent).toContain('**Input Size**: 8,668 characters');
			expect(mdContent).toContain('2,167 tokens');
		});

		it('should include stage durations when provided', async () => {
			const metrics = createTestMetrics({
				performance: {
					...createTestMetrics().performance,
					stage_durations: {
						ENTITY_ENTITY: 1000,
						ENTITY_EVENT: 1500,
						EVENT_EVENT: 2000,
					},
				},
			});

			const result = await saveBenchmarkResult(metrics);
			const mdContent = await fs.readFile(result.mdPath, 'utf-8');

			expect(mdContent).toContain('### Stage Durations');
			expect(mdContent).toContain('**ENTITY_ENTITY**: 1,000ms');
			expect(mdContent).toContain('**ENTITY_EVENT**: 1,500ms');
			expect(mdContent).toContain('**EVENT_EVENT**: 2,000ms');
		});

		it('should calculate dedup rate correctly', async () => {
			const metrics = createTestMetrics({
				quality: {
					triples_generated: 100,
					triples_extracted: 75,
				},
			});

			const result = await saveBenchmarkResult(metrics);
			const mdContent = await fs.readFile(result.mdPath, 'utf-8');

			// (100 - 75) / 100 * 100 = 25% dedup rate
			expect(mdContent).toContain('25.0% dedup rate');
		});
	});
});
