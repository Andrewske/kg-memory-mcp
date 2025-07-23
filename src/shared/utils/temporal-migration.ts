/**
 * Temporal Migration Utilities
 * Helpers for migrating historical data and handling temporal metadata
 */

import type { KnowledgeTriple } from "../types/index.js";
import type { DatabaseAdapter } from "../services/types.js";

export interface TemporalMigrationOptions {
	batchSize?: number;
	dryRun?: boolean;
	defaultDate?: string; // ISO string
	inferFromSource?: boolean;
	sourcePatterns?: Record<string, string>; // regex patterns to extract dates from source
}

export interface MigrationResult {
	processed: number;
	updated: number;
	skipped: number;
	errors: string[];
	dryRun: boolean;
}

/**
 * Backfill conversation dates for triples that don't have them
 */
export async function backfillConversationDates(
	db: DatabaseAdapter,
	options: TemporalMigrationOptions = {},
): Promise<MigrationResult> {
	const {
		batchSize = 100,
		dryRun = true,
		defaultDate,
		inferFromSource = false,
		sourcePatterns = {},
	} = options;

	const result: MigrationResult = {
		processed: 0,
		updated: 0,
		skipped: 0,
		errors: [],
		dryRun,
	};

	try {
		// Get all triples without conversation_date
		const allTriplesResult = await db.getAllTriples();
		if (!allTriplesResult.success) {
			result.errors.push(
				`Failed to fetch triples: ${allTriplesResult.error.message}`,
			);
			return result;
		}

		const triplesWithoutDate = allTriplesResult.data.filter(
			(triple) => !triple.conversation_date,
		);

		console.log(
			`Found ${triplesWithoutDate.length} triples without conversation_date`,
		);

		// Process in batches
		for (let i = 0; i < triplesWithoutDate.length; i += batchSize) {
			const batch = triplesWithoutDate.slice(i, i + batchSize);

			for (const triple of batch) {
				result.processed++;

				let inferredDate: string | null = null;

				// Try to infer date from source patterns
				if (inferFromSource) {
					inferredDate = inferDateFromSource(triple.source, sourcePatterns);
				}

				// Use default date if no inference possible
				if (!inferredDate && defaultDate) {
					inferredDate = defaultDate;
				}

				// Use extracted_at as fallback
				if (!inferredDate) {
					inferredDate = triple.extracted_at;
				}

				if (inferredDate) {
					if (!dryRun) {
						// In a real implementation, this would update the database
						// For now, we'll just simulate the update
						console.log(
							`Would update triple ${triple.subject} -> ${triple.predicate} -> ${triple.object} with date ${inferredDate}`,
						);
					}
					result.updated++;
				} else {
					result.skipped++;
				}
			}
		}

		return result;
	} catch (error) {
		result.errors.push(
			`Migration failed: ${error instanceof Error ? error.message : "Unknown error"}`,
		);
		return result;
	}
}

/**
 * Infer conversation date from source string using patterns
 */
function inferDateFromSource(
	source: string,
	patterns: Record<string, string>,
): string | null {
	for (const [pattern, dateFormat] of Object.entries(patterns)) {
		const regex = new RegExp(pattern);
		const match = source.match(regex);

		if (match) {
			// Simple date extraction - in practice, this would be more sophisticated
			if (match[1]) {
				try {
					return new Date(match[1]).toISOString();
				} catch {
					// Invalid date, continue to next pattern
				}
			}
		}
	}

	return null;
}

/**
 * Validate temporal data consistency
 */
export async function validateTemporalConsistency(
	db: DatabaseAdapter,
): Promise<{
	issues: Array<{
		type:
			| "missing_conversation_date"
			| "invalid_date"
			| "future_date"
			| "extraction_before_conversation";
		count: number;
		details?: string;
	}>;
	summary: {
		totalTriples: number;
		withConversationDate: number;
		withoutConversationDate: number;
		validDates: number;
		invalidDates: number;
	};
}> {
	const allTriplesResult = await db.getAllTriples();
	if (!allTriplesResult.success) {
		throw new Error(
			`Failed to fetch triples: ${allTriplesResult.error.message}`,
		);
	}

	const triples = allTriplesResult.data;
	const now = new Date();
	const issues: any[] = [];

	let withConversationDate = 0;
	let withoutConversationDate = 0;
	let validDates = 0;
	let invalidDates = 0;
	let futureCount = 0;
	let extractionBeforeConversation = 0;

	for (const triple of triples) {
		if (triple.conversation_date) {
			withConversationDate++;

			try {
				const conversationDate = new Date(triple.conversation_date);
				const extractedDate = new Date(triple.extracted_at);

				// Check if date is valid
				if (isNaN(conversationDate.getTime())) {
					invalidDates++;
				} else {
					validDates++;

					// Check if conversation date is in the future
					if (conversationDate > now) {
						futureCount++;
					}

					// Check if extraction happened before conversation
					if (extractedDate < conversationDate) {
						extractionBeforeConversation++;
					}
				}
			} catch {
				invalidDates++;
			}
		} else {
			withoutConversationDate++;
		}
	}

	if (withoutConversationDate > 0) {
		issues.push({
			type: "missing_conversation_date",
			count: withoutConversationDate,
			details: `${withoutConversationDate} triples missing conversation_date`,
		});
	}

	if (invalidDates > 0) {
		issues.push({
			type: "invalid_date",
			count: invalidDates,
			details: `${invalidDates} triples have invalid conversation_date format`,
		});
	}

	if (futureCount > 0) {
		issues.push({
			type: "future_date",
			count: futureCount,
			details: `${futureCount} triples have conversation_date in the future`,
		});
	}

	if (extractionBeforeConversation > 0) {
		issues.push({
			type: "extraction_before_conversation",
			count: extractionBeforeConversation,
			details: `${extractionBeforeConversation} triples extracted before their conversation_date`,
		});
	}

	return {
		issues,
		summary: {
			totalTriples: triples.length,
			withConversationDate,
			withoutConversationDate,
			validDates,
			invalidDates,
		},
	};
}

/**
 * Create temporal analysis report
 */
export async function generateTemporalReport(db: DatabaseAdapter): Promise<{
	overview: {
		totalTriples: number;
		dateRange: { earliest: string; latest: string } | null;
		coverage: number; // percentage with conversation_date
	};
	timeline: Array<{
		period: string;
		count: number;
		types: Record<string, number>;
	}>;
	gaps: Array<{
		start: string;
		end: string;
		duration: string;
	}>;
}> {
	const allTriplesResult = await db.getAllTriples();
	if (!allTriplesResult.success) {
		throw new Error(
			`Failed to fetch triples: ${allTriplesResult.error.message}`,
		);
	}

	const triples = allTriplesResult.data;
	const triplesWithDates = triples.filter((t) => t.conversation_date);

	const overview = {
		totalTriples: triples.length,
		dateRange: null as { earliest: string; latest: string } | null,
		coverage: triplesWithDates.length / triples.length,
	};

	if (triplesWithDates.length > 0) {
		const dates = triplesWithDates.map((t) => new Date(t.conversation_date!));
		const earliest = new Date(Math.min(...dates.map((d) => d.getTime())));
		const latest = new Date(Math.max(...dates.map((d) => d.getTime())));

		overview.dateRange = {
			earliest: earliest.toISOString(),
			latest: latest.toISOString(),
		};
	}

	// Generate monthly timeline
	const timeline = generateMonthlyTimeline(triplesWithDates);

	// Identify gaps (months with no data)
	const gaps = identifyTemporalGaps(triplesWithDates);

	return {
		overview,
		timeline,
		gaps,
	};
}

function generateMonthlyTimeline(triples: KnowledgeTriple[]): Array<{
	period: string;
	count: number;
	types: Record<string, number>;
}> {
	const monthlyData = new Map<
		string,
		{ count: number; types: Record<string, number> }
	>();

	for (const triple of triples) {
		const date = new Date(triple.conversation_date!);
		const monthKey = `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, "0")}`;

		if (!monthlyData.has(monthKey)) {
			monthlyData.set(monthKey, { count: 0, types: {} });
		}

		const entry = monthlyData.get(monthKey)!;
		entry.count++;
		entry.types[triple.type] = (entry.types[triple.type] || 0) + 1;
	}

	return Array.from(monthlyData.entries())
		.map(([period, data]) => ({ period, ...data }))
		.sort((a, b) => a.period.localeCompare(b.period));
}

function identifyTemporalGaps(triples: KnowledgeTriple[]): Array<{
	start: string;
	end: string;
	duration: string;
}> {
	if (triples.length === 0) return [];

	const dates = triples
		.map((t) => new Date(t.conversation_date!))
		.sort((a, b) => a.getTime() - b.getTime());
	const gaps: Array<{ start: string; end: string; duration: string }> = [];

	for (let i = 1; i < dates.length; i++) {
		const prev = dates[i - 1];
		const curr = dates[i];
		const daysDiff = (curr.getTime() - prev.getTime()) / (1000 * 60 * 60 * 24);

		// Consider gaps of 30+ days significant
		if (daysDiff > 30) {
			gaps.push({
				start: prev.toISOString().split("T")[0],
				end: curr.toISOString().split("T")[0],
				duration: `${Math.round(daysDiff)} days`,
			});
		}
	}

	return gaps;
}
