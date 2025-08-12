/**
 * Pipeline Report & Benchmarking Tool
 * Standalone TypeScript script that tests the knowledge processing pipeline
 */

import { JobType, JobStatus, type ProcessingJob } from '@prisma/client';
import { executeExtraction } from '~/features/knowledge-processing/handlers/extraction-function.js';
import { executeConcepts } from '~/features/knowledge-processing/handlers/concept-function.js';
import { executeDeduplication } from '~/features/knowledge-processing/handlers/deduplication-function.js';
import { db } from '~/shared/database/client.js';
import { env } from '~/shared/env.js';
import { redirectConsoleToFiles } from '~/shared/utils/console-redirect.js';
import fs from 'fs/promises';
import path from 'path';
import { z } from 'zod';

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

interface StageResult {
	duration: number;
	result: any;
}

interface ExtractionData extends StageResult {
	triples: any[];
}

interface ConceptData extends StageResult {
	concepts: any[];
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

	// FIXED: Create subdirectories that redirectConsoleToFiles expects
	await fs.mkdir(path.join(logDir, 'logs'), { recursive: true });
	await fs.mkdir(path.join(logDir, 'errors'), { recursive: true });

	const restoreConsole = redirectConsoleToFiles(logDir);

	try {
		console.log('=== Pipeline Report Test Started ===');
		console.log('Configuration:', JSON.stringify(config, null, 2));

		// Stage 1: Create mock job and run extraction
		const extractionStartTime = Date.now();
		const mockExtractionJob = await createMockJob(
			JobType.EXTRACT_KNOWLEDGE_BATCH,
			config.testText,
			config
		);
		tracker.processingJobIds.add(mockExtractionJob.id);

		console.log('Stage 1: Running extraction...');
		const extractionResult = await executeExtraction(mockExtractionJob, true);
		const extractionDuration = Date.now() - extractionStartTime;

		if (!extractionResult.success) {
			throw new Error(`Extraction failed: ${extractionResult.error?.message}`);
		}

		// Wait for post-transaction operations to complete (vector generation)
		console.log('[PIPELINE REPORT] Waiting 2s for all database operations to complete...');
		await new Promise(resolve => setTimeout(resolve, 2000));

		// Query created triples (need to account for chunk suffixes added by extraction)
		console.log(`[PIPELINE REPORT] Querying triples with source pattern: ${config.source}*`);
		const createdTriples = await db.knowledgeTriple.findMany({
			where: {
				source: {
					startsWith: config.source,
				},
			},
		});
		console.log(`[PIPELINE REPORT] Found ${createdTriples.length} triples matching source pattern`);
		if (createdTriples.length > 0) {
			const sampleSources = [...new Set(createdTriples.slice(0, 5).map(t => t.source))];
			console.log(`[PIPELINE REPORT] Sample triple sources found:`, sampleSources);
		}
		createdTriples.forEach(t => tracker.tripleIds.add(t.id));

		// Stage 2: Run concept generation
		const conceptStartTime = Date.now();
		const mockConceptJob = await createMockJob(JobType.GENERATE_CONCEPTS, config.testText, config);
		tracker.processingJobIds.add(mockConceptJob.id);

		console.log('Stage 2: Running concept generation...');
		const conceptResult = await executeConcepts(mockConceptJob, true);
		const conceptDuration = Date.now() - conceptStartTime;

		// Query created concepts (account for potential source variations)
		console.log(`[PIPELINE REPORT] Querying concepts with source pattern: ${config.source}*`);
		const createdConcepts = await db.conceptNode.findMany({
			where: {
				source: {
					startsWith: config.source,
				},
			},
		});
		console.log(
			`[PIPELINE REPORT] Found ${createdConcepts.length} concepts matching source pattern`
		);
		createdConcepts.forEach(c => tracker.conceptIds.add(c.id));

		// Stage 3: Optional deduplication
		let dedupDuration = 0;
		let dedupResult: any = { success: true };

		if (config.enableDedup) {
			const dedupStartTime = Date.now();
			const mockDedupJob = await createMockJob(
				JobType.DEDUPLICATE_KNOWLEDGE,
				config.testText,
				config
			);
			tracker.processingJobIds.add(mockDedupJob.id);

			console.log('Stage 3: Running deduplication...');
			dedupResult = await executeDeduplication(mockDedupJob, true);
			dedupDuration = Date.now() - dedupStartTime;

			if (!dedupResult.success) {
				console.error('Deduplication failed, continuing with partial results:', dedupResult.error);
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
		console.log(
			`[PIPELINE REPORT] Querying token usage with source pattern: ${config.source}* after ${new Date(startTime).toISOString()}`
		);
		const tokenUsage = await db.tokenUsage.findMany({
			where: {
				source: {
					startsWith: config.source,
				},
				timestamp: { gte: new Date(startTime) },
			},
			orderBy: { timestamp: 'asc' },
		});
		console.log(
			`[PIPELINE REPORT] Found ${tokenUsage.length} token usage records matching criteria`
		);
		tokenUsage.forEach(t => tracker.tokenUsageIds.add(t.id));

		// FIXED: Query unified VectorEmbedding table with correct schema and source pattern
		console.log(`[PIPELINE REPORT] Querying vectors with source pattern: ${config.source}*`);
		const vectors = await db.vectorEmbedding.findMany({
			where: {
				vector_type: { in: ['ENTITY', 'RELATIONSHIP', 'SEMANTIC', 'CONCEPT'] },
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
		});
		console.log(
			`[PIPELINE REPORT] Found ${vectors.length} vectors matching stored triples/concepts`
		);
		vectors.forEach(v => tracker.vectorIds.add(v.id));

		// Generate report
		const report = await generateReport({
			config,
			extraction: result.extraction,
			concepts: result.concepts,
			deduplication: result.deduplication,
			tokenUsage,
			vectors,
			totalDuration: Date.now() - startTime,
			logDir,
		});

		// Save report
		const reportPath = path.join(logDir, `report-${timestamp}.md`);
		await fs.writeFile(reportPath, report);
		console.log(`✅ Report generated: ${reportPath}`);

		// Cleanup created records
		await cleanup(tracker);

		return { success: true, reportPath };
	} catch (error) {
		console.error('❌ Pipeline test failed:', error);

		// Attempt cleanup on failure
		try {
			await cleanup(tracker);
		} catch (cleanupError) {
			console.error('Cleanup failed:', cleanupError);
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
	console.log('🧹 Starting cleanup...');

	try {
		// Delete in reverse dependency order using transactions
		await db.$transaction([
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
		]);

		console.log('✅ Cleanup completed successfully');
	} catch (error) {
		console.error('❌ Cleanup failed:', error);
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
	tokenUsage: any[];
	vectors: any[];
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
function calculateTokenStats(tokenUsage: any[]) {
	return tokenUsage.reduce(
		(acc, usage) => ({
			totalInput: acc.totalInput + usage.input_tokens,
			totalOutput: acc.totalOutput + usage.output_tokens,
			total: acc.total + usage.total_tokens,
			totalCost: acc.totalCost + (Number(usage.estimated_cost) || 0),
		}),
		{ totalInput: 0, totalOutput: 0, total: 0, totalCost: 0 }
	);
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

	console.log('🚀 Starting Pipeline Report Test...');

	try {
		const result = await runPipelineReport(config);
		console.log(`✅ Report generated: ${result.reportPath}`);
		process.exit(0);
	} catch (error) {
		console.error('❌ Pipeline test failed:', error);
		process.exit(1);
	}
}

// Execute if run directly
if (import.meta.url === `file://${process.argv[1]}`) {
	main().catch(console.error);
}

export { runPipelineReport, PipelineConfig };
