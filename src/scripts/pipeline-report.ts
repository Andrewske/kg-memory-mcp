/**
 * Pipeline Report & Benchmarking Tool
 * Standalone TypeScript script that tests the knowledge processing pipeline
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import {
	type ConceptNode,
	JobStatus,
	JobType,
	type KnowledgeTriple,
	type ProcessingJob,
	VectorType,
} from '@prisma/client';
import { z } from 'zod';
import { executeConcepts } from '~/features/knowledge-processing/handlers/concept-function.js';
import { executeDeduplication } from '~/features/knowledge-processing/handlers/deduplication-function.js';
import { executeExtraction } from '~/features/knowledge-processing/handlers/extraction-function.js';
import { db } from '~/shared/database/client.js';
import { env } from '~/shared/env.js';
import type { Concept, TokenUsage, Triple } from '~/shared/types/core.js';
import { redirectConsoleToFiles } from '~/shared/utils/console-redirect.js';
import {
	createContext,
	log,
	logDataFlow,
	logError,
	logQueryResult,
	logSourceTransformation,
	withTiming,
} from '~/shared/utils/debug-logger.js';

// Configuration validation schema
const PipelineConfigSchema = z.object({
	testText: z.string().min(1),
	source: z.string().optional(),
	sourceType: z.string().optional(),
	model: z.string().optional(),
	extractionMethod: z.enum(['single-pass', 'four-stage']).optional(),
	enableDedup: z.boolean().optional(),
	outputDir: z.string().optional(),
});

type PipelineConfig = z.infer<typeof PipelineConfigSchema>;

// Track created records for cleanup
interface CleanupTracker {
	processingJobIds: Set<string>;
	tripleIds: Set<string>;
	conceptIds: Set<string>;
	vectorIds: Set<string>;
	tokenUsageIds: Set<string>;
}

function createCleanupTracker(): CleanupTracker {
	return {
		processingJobIds: new Set(),
		tripleIds: new Set(),
		conceptIds: new Set(),
		vectorIds: new Set(),
		tokenUsageIds: new Set(),
	};
}

// Define types for job execution results
interface JobExecutionResult {
	success: boolean;
	data?: {
		triples?: Triple[];
		concepts?: Concept[];
		duplicateRemovalCount?: number;
		[key: string]: unknown;
	};
	error?: {
		message: string;
		operation: string;
		cause?: unknown;
	};
}

interface StageResult {
	duration: number;
	result: JobExecutionResult;
}

interface ExtractionData extends StageResult {
	triples: Triple[];
}

interface ConceptData extends StageResult {
	concepts: Concept[];
}

interface DeduplicationData extends StageResult {}

/**
 * Main pipeline execution function
 */
async function runPipelineReport(config: PipelineConfig) {
	const tracker = createCleanupTracker();
	const startTime = Date.now();
	const logDir = path.join(process.cwd(), 'logs', 'pipeline-reports');
	await fs.mkdir(logDir, { recursive: true });

	// Setup unique log capture for this run
	const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

	// Create pipeline context for structured logging
	const pipelineContext = createContext('PIPELINE_REPORT', 'full_pipeline_test', {
		source: config.source,
		testTextLength: config.testText.length,
		model: config.model || env.AI_MODEL,
		extractionMethod: config.extractionMethod || env.EXTRACTION_METHOD,
		enableDedup: config.enableDedup || false,
		timestamp,
	});

	// FIXED: Create subdirectories that redirectConsoleToFiles expects
	await fs.mkdir(path.join(logDir, 'logs'), { recursive: true });
	await fs.mkdir(path.join(logDir, 'errors'), { recursive: true });

	const restoreConsole = redirectConsoleToFiles(logDir);

	try {
		log('INFO', pipelineContext, 'Pipeline report test started', { config });

		// Stage 1: Create mock job and run extraction
		const extractionContext = createContext('PIPELINE_REPORT', 'extraction_stage', {
			source: config.source,
			jobType: JobType.EXTRACT_KNOWLEDGE_BATCH,
		});

		const mockExtractionJob = await createMockJob(
			JobType.EXTRACT_KNOWLEDGE_BATCH,
			config.testText,
			config
		);
		tracker.processingJobIds.add(mockExtractionJob.id);

		log('INFO', extractionContext, 'Stage 1: Running extraction', { jobId: mockExtractionJob.id });

		const extractionTiming = await withTiming(
			extractionContext,
			async () => {
				return await executeExtraction(mockExtractionJob, true);
			},
			'Extraction execution'
		);

		const extractionResult = extractionTiming.result;
		const extractionDuration = extractionTiming.duration;

		if (!extractionResult.success) {
			logError(extractionContext, `Extraction failed: ${extractionResult.error?.message}`);
			throw new Error(`Extraction failed: ${extractionResult.error?.message}`);
		}

		// Wait for post-transaction operations to complete (vector generation)
		log('DEBUG', extractionContext, 'Waiting for post-transaction operations to complete', {
			waitTime: '2s',
		});
		await new Promise(resolve => setTimeout(resolve, 2000));

		// Query created triples (need to account for chunk suffixes added by extraction)
		const tripleQuery = {
			where: {
				source: {
					startsWith: config.source,
				},
			},
		};

		log('DEBUG', extractionContext, 'Querying triples with source pattern', {
			sourcePattern: `${config.source}*`,
			query: tripleQuery,
		});

		const createdTriples = await db.knowledgeTriple.findMany(tripleQuery);

		logQueryResult(
			extractionContext,
			{
				source_pattern: `${config.source}*`,
				operation: 'findMany_triples',
			},
			createdTriples,
			'Triple query completed'
		);

		// Log source transformations to detect mismatches
		if (createdTriples.length > 0) {
			const uniqueSources = [...new Set(createdTriples.map(t => t.source))];
			uniqueSources.forEach(source => {
				if (source !== config.source && config.source) {
					logSourceTransformation(extractionContext, config.source, source, 'chunk_suffix_added');
				}
			});
		}

		createdTriples.forEach(t => tracker.tripleIds.add(t.id));

		// Stage 2: Run concept generation
		const conceptContext = createContext('PIPELINE_REPORT', 'concept_stage', {
			source: config.source,
			jobType: JobType.GENERATE_CONCEPTS,
		});

		const mockConceptJob = await createMockJob(JobType.GENERATE_CONCEPTS, config.testText, config);
		tracker.processingJobIds.add(mockConceptJob.id);

		log('INFO', conceptContext, 'Stage 2: Running concept generation', {
			jobId: mockConceptJob.id,
		});

		const conceptTiming = await withTiming(
			conceptContext,
			async () => {
				return await executeConcepts(mockConceptJob, true);
			},
			'Concept generation execution'
		);

		const conceptResult = conceptTiming.result;
		const conceptDuration = conceptTiming.duration;

		// Query created concepts (account for potential source variations)
		const conceptQuery = {
			where: {
				source: {
					startsWith: config.source,
				},
			},
		};

		log('DEBUG', conceptContext, 'Querying concepts with source pattern', {
			sourcePattern: `${config.source}*`,
			query: conceptQuery,
		});

		const createdConcepts = await db.conceptNode.findMany(conceptQuery);

		logQueryResult(
			conceptContext,
			{
				source_pattern: `${config.source}*`,
				operation: 'findMany_concepts',
			},
			createdConcepts,
			'Concept query completed'
		);

		createdConcepts.forEach(c => tracker.conceptIds.add(c.id));

		// Stage 3: Optional deduplication
		let dedupDuration = 0;
		let dedupResult: JobExecutionResult = { success: true };

		if (config.enableDedup) {
			const dedupContext = createContext('PIPELINE_REPORT', 'deduplication_stage', {
				source: config.source,
				jobType: JobType.DEDUPLICATE_KNOWLEDGE,
			});

			const mockDedupJob = await createMockJob(
				JobType.DEDUPLICATE_KNOWLEDGE,
				config.testText,
				config
			);
			tracker.processingJobIds.add(mockDedupJob.id);

			log('INFO', dedupContext, 'Stage 3: Running deduplication', { jobId: mockDedupJob.id });

			const dedupTiming = await withTiming(
				dedupContext,
				async () => {
					return await executeDeduplication(mockDedupJob, true);
				},
				'Deduplication execution'
			);

			dedupResult = dedupTiming.result;
			dedupDuration = dedupTiming.duration;

			if (!dedupResult.success) {
				logError(
					dedupContext,
					'Deduplication failed, continuing with partial results',
					dedupResult.error
				);
			}
		}

		const result = {
			extraction: {
				duration: extractionDuration,
				triples: createdTriples,
				result: extractionResult,
			} as ExtractionData,
			concepts: {
				duration: conceptDuration,
				concepts: createdConcepts,
				result: conceptResult,
			} as ConceptData,
			deduplication: config.enableDedup
				? ({
						duration: dedupDuration,
						result: dedupResult,
					} as DeduplicationData)
				: undefined,
		};

		// Query token usage and vectors outside transaction
		const analysisContext = createContext('PIPELINE_REPORT', 'post_processing_analysis', {
			source: config.source,
			startTime: new Date(startTime).toISOString(),
		});

		const tokenUsageQuery = {
			where: {
				source: {
					startsWith: config.source,
				},
				timestamp: { gte: new Date(startTime) },
			},
			orderBy: { timestamp: 'asc' } as const,
		};

		log('DEBUG', analysisContext, 'Querying token usage with source pattern', {
			sourcePattern: `${config.source}*`,
			afterTime: new Date(startTime).toISOString(),
			query: tokenUsageQuery,
		});

		const tokenUsage = await db.tokenUsage.findMany(tokenUsageQuery);

		logQueryResult(
			analysisContext,
			{
				source_pattern: `${config.source}*`,
				operation: 'findMany_tokenUsage',
				afterTime: new Date(startTime).toISOString(),
			},
			tokenUsage,
			'Token usage query completed'
		);

		tokenUsage.forEach(t => tracker.tokenUsageIds.add(t.id));

		// FIXED: Query unified VectorEmbedding table with correct schema and source pattern
		const vectorQuery = {
			where: {
				vector_type: {
					in: [VectorType.ENTITY, VectorType.RELATIONSHIP, VectorType.SEMANTIC, VectorType.CONCEPT],
				},
				OR: [
					{
						knowledge_triple_id: {
							in: createdTriples.map(t => t.id),
						},
					},
					{
						concept_node_id: {
							in: createdConcepts.map(c => c.id),
						},
					},
				],
			},
		};

		log('DEBUG', analysisContext, 'Querying vectors with unified schema', {
			vectorTypes: ['ENTITY', 'RELATIONSHIP', 'SEMANTIC', 'CONCEPT'],
			tripleIds: createdTriples.map(t => t.id).slice(0, 5), // Sample for logging
			conceptIds: createdConcepts.map(c => c.id).slice(0, 5), // Sample for logging
			query: vectorQuery,
		});

		const vectors = await db.vectorEmbedding.findMany(vectorQuery);

		logQueryResult(
			analysisContext,
			{
				vector_types: 'ENTITY,RELATIONSHIP,SEMANTIC,CONCEPT',
				operation: 'findMany_vectorEmbeddings',
				tripleCount: createdTriples.length,
				conceptCount: createdConcepts.length,
			},
			vectors,
			'Vector query completed'
		);

		// Log data flow to track relationship between triples/concepts and vectors
		logDataFlow(
			analysisContext,
			{
				input: { tripleCount: createdTriples.length, conceptCount: createdConcepts.length },
				output: { vectorCount: vectors.length },
				transformations: ['vector_generation_post_transaction'],
			},
			'Vector generation data flow'
		);

		vectors.forEach(v => tracker.vectorIds.add(v.id));

		// Generate report
		const report = await generateReport({
			config,
			extraction: result.extraction,
			concepts: result.concepts,
			deduplication: result.deduplication,
			tokenUsage: tokenUsage.map(usage => ({
				...usage,
				thinking_tokens: usage.thinking_tokens ?? undefined,
				reasoning_tokens: usage.reasoning_tokens ?? undefined,
				cached_read_tokens: usage.cached_read_tokens ?? undefined,
				cached_write_tokens: usage.cached_write_tokens ?? undefined,
				reasoning_steps:
					usage.reasoning_steps && Array.isArray(usage.reasoning_steps)
						? (usage.reasoning_steps as any[])
						: undefined,
				operation_context:
					usage.operation_context && typeof usage.operation_context === 'object'
						? (usage.operation_context as Record<string, string | number | boolean>)
						: undefined,
				estimated_cost: usage.estimated_cost ? Number(usage.estimated_cost) : undefined,
				timestamp: usage.timestamp.toISOString(),
			})),
			vectors,
			totalDuration: Date.now() - startTime,
			logDir,
		});

		// Save report
		const reportPath = path.join(logDir, `report-${timestamp}.md`);
		await fs.writeFile(reportPath, report);
		log('INFO', pipelineContext, 'Report generated successfully', { reportPath });

		// Cleanup created records
		const cleanupContext = createContext('PIPELINE_REPORT', 'cleanup', {
			source: config.source,
			processingJobsCount: tracker.processingJobIds.size,
			triplesCount: tracker.tripleIds.size,
			conceptsCount: tracker.conceptIds.size,
			vectorsCount: tracker.vectorIds.size,
			tokenUsageCount: tracker.tokenUsageIds.size,
		});

		await withTiming(
			cleanupContext,
			async () => {
				await cleanup(tracker);
			},
			'Cleanup execution'
		);

		log('INFO', pipelineContext, 'Pipeline test completed successfully', {
			totalDuration: Date.now() - startTime,
			reportPath,
		});

		return { success: true, reportPath };
	} catch (error) {
		logError(pipelineContext, error instanceof Error ? error : new Error(String(error)));

		// Attempt cleanup on failure
		try {
			const cleanupContext = createContext('PIPELINE_REPORT', 'cleanup_on_failure', {
				source: config.source,
			});
			await cleanup(tracker);
			log('INFO', cleanupContext, 'Cleanup completed after failure');
		} catch (cleanupError) {
			logError(
				pipelineContext,
				cleanupError instanceof Error ? cleanupError : new Error('Cleanup failed')
			);
		}

		throw error;
	} finally {
		restoreConsole();
	}
}

/**
 * Create mock processing job
 */
async function createMockJob(
	jobType: JobType,
	text: string,
	config: PipelineConfig
): Promise<ProcessingJob> {
	return await db.processingJob.create({
		data: {
			job_type: jobType,
			text,
			status: JobStatus.PROCESSING,
			metadata: {
				source: config.source || `test-${Date.now()}`,
				source_type: config.sourceType || 'pipeline-test',
				source_date: new Date().toISOString(),
				model: config.model || env.AI_MODEL,
				extraction_method: config.extractionMethod || env.EXTRACTION_METHOD,
			},
		},
	});
}

/**
 * Comprehensive cleanup - removes all test data
 */
async function cleanup(tracker: CleanupTracker): Promise<void> {
	const cleanupContext = createContext('PIPELINE_REPORT', 'cleanup_database', {
		processingJobsCount: tracker.processingJobIds.size,
		triplesCount: tracker.tripleIds.size,
		conceptsCount: tracker.conceptIds.size,
		vectorsCount: tracker.vectorIds.size,
		tokenUsageCount: tracker.tokenUsageIds.size,
	});

	log('INFO', cleanupContext, 'Starting cleanup', {
		totalRecords:
			tracker.processingJobIds.size +
			tracker.tripleIds.size +
			tracker.conceptIds.size +
			tracker.vectorIds.size +
			tracker.tokenUsageIds.size,
	});

	try {
		// Delete in reverse dependency order using transactions
		const deleteOperations = [
			// Delete vectors first (no foreign key dependencies)
			...(tracker.vectorIds.size > 0
				? [
						db.vectorEmbedding.deleteMany({
							where: { id: { in: Array.from(tracker.vectorIds) } },
						}),
					]
				: []),

			// Delete concept relationships
			...(tracker.conceptIds.size > 0
				? [
						db.conceptualizationRelationship.deleteMany({
							where: { concept_node_id: { in: Array.from(tracker.conceptIds) } },
						}),
					]
				: []),

			// Delete concepts
			...(tracker.conceptIds.size > 0
				? [
						db.conceptNode.deleteMany({
							where: { id: { in: Array.from(tracker.conceptIds) } },
						}),
					]
				: []),

			// Delete triples
			...(tracker.tripleIds.size > 0
				? [
						db.knowledgeTriple.deleteMany({
							where: { id: { in: Array.from(tracker.tripleIds) } },
						}),
					]
				: []),

			// Delete token usage
			...(tracker.tokenUsageIds.size > 0
				? [
						db.tokenUsage.deleteMany({
							where: { id: { in: Array.from(tracker.tokenUsageIds) } },
						}),
					]
				: []),

			// Delete processing jobs last
			...(tracker.processingJobIds.size > 0
				? [
						db.processingJob.deleteMany({
							where: { id: { in: Array.from(tracker.processingJobIds) } },
						}),
					]
				: []),
		];

		log('DEBUG', cleanupContext, 'Executing cleanup transaction', {
			operationCount: deleteOperations.length,
		});

		await db.$transaction(deleteOperations);

		log('INFO', cleanupContext, 'Cleanup completed successfully');
	} catch (error) {
		logError(cleanupContext, error instanceof Error ? error : new Error(String(error)));
		throw error;
	}
}

/**
 * Generate comprehensive markdown report
 */
async function generateReport(data: {
	config: PipelineConfig;
	extraction: ExtractionData;
	concepts: ConceptData;
	deduplication?: DeduplicationData;
	tokenUsage: TokenUsage[];
	vectors: Array<{ id: string; text: string; vector_type: VectorType; vector_id: string }>;
	totalDuration: number;
	logDir: string;
}): Promise<string> {
	// Read captured logs from the actual log file (latest timestamped file)
	let logContent = 'No logs captured';
	try {
		// Find the most recent log file in the logs subdirectory
		const logsDir = path.join(data.logDir, 'logs');
		const logFiles = await fs.readdir(logsDir);
		const mcpLogFiles = logFiles
			.filter(f => f.startsWith('mcp-') && f.endsWith('.log'))
			.sort()
			.reverse(); // Get most recent first

		if (mcpLogFiles.length > 0) {
			const latestLogFile = path.join(logsDir, mcpLogFiles[0]);
			logContent = await fs.readFile(latestLogFile, 'utf-8');
		}
	} catch (error) {
		logContent = `Error reading logs: ${error}`;
	}

	// Calculate token usage statistics
	const tokenStats = calculateTokenStats(data.tokenUsage);

	// Group triples by type
	const triplesByType = groupTriplesByType(data.extraction.triples);

	// Group concepts by abstraction level
	const conceptsByLevel = groupConceptsByLevel(data.concepts.concepts);

	return `# Knowledge Processing Pipeline Report

## ⚙️ Configuration
- **Model**: ${data.config.model || env.AI_MODEL}
- **Extraction Method**: ${data.config.extractionMethod || env.EXTRACTION_METHOD}
- **Semantic Deduplication**: ${data.config.enableDedup || false}
- **Test Text Length**: ${data.config.testText.length} characters
- **Timestamp**: ${new Date().toISOString()}

## 🔍 Stage 1: Knowledge Extraction
### Performance
- **Duration**: ${data.extraction.duration}ms
- **Triples Extracted**: ${data.extraction.triples.length}

### Triples by Type
${Object.entries(triplesByType)
	.map(([type, triples]) => `- **${type}**: ${triples.length}`)
	.join('\n')}

### Sample Triples
\`\`\`json
${JSON.stringify(data.extraction.triples.slice(0, 5), null, 2)}
\`\`\`

## 🧠 Stage 2: Concept Generation
### Performance
- **Duration**: ${data.concepts.duration}ms
- **Concepts Generated**: ${data.concepts.concepts.length}

### Concepts by Abstraction Level
${Object.entries(conceptsByLevel)
	.map(([level, concepts]) => `- **${level}**: ${concepts.length}`)
	.join('\n')}

### Sample Concepts
\`\`\`json
${JSON.stringify(data.concepts.concepts.slice(0, 5), null, 2)}
\`\`\`

${
	data.deduplication
		? `
## 🔄 Stage 3: Deduplication
### Performance
- **Duration**: ${data.deduplication.duration}ms
- **Status**: ${data.deduplication.result.success ? 'Success' : 'Failed'}
`
		: ''
}

## 💰 Token Usage Analysis
### Per Operation
${data.tokenUsage
	.map(
		usage => `
#### ${usage.operation_type} (${usage.model})
- **Input Tokens**: ${usage.input_tokens}
- **Output Tokens**: ${usage.output_tokens}
- **Total Tokens**: ${usage.total_tokens}
- **Estimated Cost**: $${usage.estimated_cost || 0}
- **Duration**: ${usage.duration_ms}ms
`
	)
	.join('\n')}

### Summary
- **Total Input Tokens**: ${tokenStats.totalInput}
- **Total Output Tokens**: ${tokenStats.totalOutput}
- **Total Tokens**: ${tokenStats.total}
- **Total Cost**: $${tokenStats.totalCost}
- **AI Calls**: ${data.tokenUsage.length}

## 🎯 Vector Embeddings
- **Total Vectors Generated**: ${data.vectors.length}
- **Vector Types**: ${[...new Set(data.vectors.map(v => v.vector_type))].join(', ')}

## ⚡ Overall Performance
- **Total Duration**: ${data.totalDuration}ms
- **Average Token/ms**: ${(tokenStats.total / data.totalDuration).toFixed(2)}

## 📋 Database Validation
- **Triples Stored**: ${data.extraction.triples.length}
- **Concepts Stored**: ${data.concepts.concepts.length}
- **Vectors Stored**: ${data.vectors.length}
- **Token Usage Records**: ${data.tokenUsage.length}

## 📝 Execution Logs
\`\`\`
${logContent.slice(-5000)} // Last 5000 characters to avoid huge reports
\`\`\`
`;
}

// Helper functions for report generation
function calculateTokenStats(tokenUsage: TokenUsage[]): {
	byType: Record<string, { total: number; cost: number }>;
	byLevel: Record<string, { total: number; cost: number }>;
	overall: { total: number; cost: number };
	totalInput: number;
	totalOutput: number;
	total: number;
	totalCost: number;
} {
	const stats = tokenUsage.reduce(
		(acc, usage) => ({
			totalInput: acc.totalInput + usage.input_tokens,
			totalOutput: acc.totalOutput + usage.output_tokens,
			total: acc.total + usage.total_tokens,
			totalCost: acc.totalCost + (Number(usage.estimated_cost) || 0),
		}),
		{ totalInput: 0, totalOutput: 0, total: 0, totalCost: 0 }
	);

	// Group by type and operation
	const byType: Record<string, { total: number; cost: number }> = {};
	const byLevel: Record<string, { total: number; cost: number }> = {};

	for (const usage of tokenUsage) {
		// By operation type
		if (!byType[usage.operation_type]) {
			byType[usage.operation_type] = { total: 0, cost: 0 };
		}
		byType[usage.operation_type].total += usage.total_tokens;
		byType[usage.operation_type].cost += Number(usage.estimated_cost) || 0;

		// By provider
		if (!byLevel[usage.provider]) {
			byLevel[usage.provider] = { total: 0, cost: 0 };
		}
		byLevel[usage.provider].total += usage.total_tokens;
		byLevel[usage.provider].cost += Number(usage.estimated_cost) || 0;
	}

	return {
		byType,
		byLevel,
		overall: { total: stats.total, cost: stats.totalCost },
		totalInput: stats.totalInput,
		totalOutput: stats.totalOutput,
		total: stats.total,
		totalCost: stats.totalCost,
	};
}

function groupTriplesByType(triples: Array<{ type?: string; triple_type?: string }>) {
	return triples.reduce(
		(acc, triple) => {
			const type = triple.triple_type || triple.type || 'unknown';
			if (!acc[type]) acc[type] = [];
			acc[type].push(triple);
			return acc;
		},
		{} as Record<string, Array<{ type?: string; triple_type?: string }>>
	);
}

function groupConceptsByLevel(concepts: Array<{ abstraction_level?: string }>) {
	return concepts.reduce(
		(acc, concept) => {
			const level = concept.abstraction_level || 'unknown';
			if (!acc[level]) acc[level] = [];
			acc[level].push(concept);
			return acc;
		},
		{} as Record<string, Array<{ abstraction_level?: string }>>
	);
}

function getDefaultTestText(): string {
	return `The evolution of artificial intelligence represents one of the most significant technological revolutions of the 21st century. From its early beginnings in academic research labs to its current widespread application across industries, AI has fundamentally changed how we approach complex problems and automate tasks.

Machine learning, a subset of AI, has proven particularly transformative. Supervised learning algorithms enable systems to recognize patterns in labeled training data, making predictions on new, unseen examples. Unsupervised learning techniques discover hidden structures in data without explicit labels. Reinforcement learning allows agents to learn optimal behaviors through interaction with their environment, receiving rewards or penalties for their actions.

Deep learning, inspired by the structure and function of biological neural networks, has achieved remarkable breakthroughs in recent years. Convolutional Neural Networks (CNNs) excel at computer vision tasks, enabling accurate image classification, object detection, and semantic segmentation. Recurrent Neural Networks (RNNs) and their advanced variants like Long Short-Term Memory (LSTM) networks have revolutionized natural language processing, enabling sophisticated text generation, machine translation, and sentiment analysis.

The transformer architecture, introduced in the "Attention Is All You Need" paper, has become the foundation for modern large language models. These models, trained on vast amounts of text data, demonstrate remarkable capabilities in understanding context, generating coherent text, and even exhibiting emergent reasoning abilities. GPT models, BERT, and their successors have transformed how we interact with AI systems.

Computer vision applications span numerous domains. In healthcare, AI systems analyze medical images to detect tumors, identify fractures, and assist in diagnosis. Autonomous vehicles rely on computer vision to navigate safely, recognizing traffic signs, pedestrians, and other vehicles. Retail companies use visual recognition for inventory management and customer behavior analysis.

Natural language processing has enabled the development of sophisticated chatbots, virtual assistants, and translation services. These systems can understand context, maintain conversations, and provide relevant responses. Search engines use NLP to better understand user queries and deliver more accurate results. Content moderation systems automatically identify and flag inappropriate content across social media platforms.

The democratization of AI tools has accelerated innovation across industries. Cloud-based AI services from major technology companies make advanced capabilities accessible to organizations without extensive AI expertise. Open-source frameworks like TensorFlow, PyTorch, and scikit-learn have lowered barriers to entry for AI development.

However, the rapid advancement of AI also presents significant challenges. Algorithmic bias can perpetuate or amplify existing social inequalities. Privacy concerns arise when AI systems process personal data. The potential for job displacement as AI automates various tasks requires careful consideration and planning for workforce transitions.

Ethical AI development has become a critical focus area. Researchers and practitioners emphasize the importance of fairness, accountability, transparency, and explainability in AI systems. Regulatory frameworks are evolving to provide guidelines for responsible AI deployment while fostering continued innovation.

The future of AI promises even more transformative applications. Advances in quantum computing may enable new AI algorithms. Brain-computer interfaces could create direct connections between human cognition and AI systems. As we continue to push the boundaries of what's possible with artificial intelligence, careful consideration of its societal impact remains paramount.`;
}

/**
 * Main execution function
 */
async function main() {
	const args = process.argv.slice(2);

	// Parse command line arguments
	const rawConfig = {
		testText: args[0] || getDefaultTestText(),
		source: `pipeline-test-${Date.now()}`,
		sourceType: 'benchmark',
		model: process.env.AI_MODEL,
		extractionMethod: process.env.EXTRACTION_METHOD as 'single-pass' | 'four-stage',
		enableDedup: process.env.ENABLE_SEMANTIC_DEDUP === 'true',
	};

	// Parse flags
	for (let i = 0; i < args.length; i++) {
		if (args[i] === '--model') rawConfig.model = args[++i];
		if (args[i] === '--extraction-method')
			rawConfig.extractionMethod = args[++i] as 'single-pass' | 'four-stage';
		if (args[i] === '--enable-dedup') rawConfig.enableDedup = true;
	}

	// Validate configuration
	const config = PipelineConfigSchema.parse(rawConfig);

	const mainContext = createContext('PIPELINE_REPORT', 'main', {
		source: config.source,
		args: args.length,
		modelFlag: rawConfig.model || 'default',
		extractionMethodFlag: rawConfig.extractionMethod || 'default',
		enableDedupFlag: rawConfig.enableDedup || false,
	});

	log('INFO', mainContext, 'Starting Pipeline Report Test', { config });

	try {
		const result = await runPipelineReport(config);
		log('INFO', mainContext, 'Pipeline test completed successfully', {
			reportPath: result.reportPath,
		});
		process.exit(0);
	} catch (error) {
		logError(mainContext, error instanceof Error ? error : new Error(String(error)));
		process.exit(1);
	}
}

// Execute if run directly
if (import.meta.url === `file://${process.argv[1]}`) {
	main().catch(console.error);
}

export { runPipelineReport, type PipelineConfig };
