/**
 * Test fixtures and sample data for Knowledge Graph MCP Server tests
 */

import { Decimal } from '@prisma/client/runtime/library';
import type { ProcessKnowledgeArgs } from '~/server/transport-manager.js';
import type { Concept, Triple } from '~/shared/types/core.js';

// Sample text content for testing
export const testTexts = {
	tiny: 'John works at Tech Corp.',

	small: 'John Smith is a software engineer at Tech Corp. He works on AI projects.',

	medium: `
    John Smith is a senior software engineer at Tech Corp, a leading technology company based in San Francisco.
    He has been working on artificial intelligence projects for the past five years, specializing in machine learning algorithms.
    The company recently launched a revolutionary AI product that analyzes customer behavior patterns in real-time.
    John feels excited and optimistic about the project's potential impact on the industry.
    The product launch event happened last month and was extremely successful, attracting investors and media attention.
    Sarah Johnson, the product manager, collaborated closely with John throughout the development process.
    They worked together to ensure the AI system met all performance requirements and user experience standards.
  `,

	large: `
    Tech Corp is a multinational technology corporation founded in 2010 by innovative entrepreneurs.
    The company has grown from a small startup to employing over 5,000 people worldwide.
    Their headquarters in San Francisco houses the main research and development teams.
    
    John Smith joined Tech Corp in 2020 as a software engineer and quickly advanced to senior positions.
    He leads the artificial intelligence division, which focuses on machine learning and deep learning technologies.
    John graduated from Stanford University with a PhD in Computer Science, specializing in neural networks.
    His dissertation on transformer architectures has been cited over 500 times in academic literature.
    
    The AI product that John's team developed uses advanced natural language processing techniques.
    It can analyze customer feedback, social media posts, and survey responses to extract meaningful insights.
    The system processes over 100,000 documents per day with 95% accuracy in sentiment classification.
    
    Sarah Johnson, who serves as the product manager for this initiative, has extensive experience in product development.
    She previously worked at Google for eight years, managing various consumer products.
    Sarah feels passionate about creating technology that solves real-world problems for businesses.
    
    The collaboration between John and Sarah resulted in a product that exceeded all initial expectations.
    They conducted extensive testing with beta customers before the official launch.
    The launch event in December attracted over 500 attendees, including venture capitalists and industry experts.
    
    Following the successful launch, Tech Corp's stock price increased by 25% in the following quarter.
    The company is now planning to expand the AI division and hire 100 additional engineers.
    John has been promoted to VP of Artificial Intelligence and will oversee this expansion.
    
    The success story demonstrates how effective teamwork and innovative thinking can create breakthrough products.
    Both John and Sarah attribute their success to the supportive culture at Tech Corp.
    The company encourages experimentation and provides resources for employees to pursue ambitious projects.
  `,
};

// Helper function to create consistent test triples
function createTriple(
	subject: string,
	predicate: string,
	object: string,
	type: 'ENTITY_ENTITY' | 'ENTITY_EVENT' | 'EVENT_EVENT' | 'EMOTIONAL_CONTEXT',
	confidence: number = 0.9
): Triple {
	return {
		subject,
		predicate,
		object,
		type,
		source: 'test-source',
		source_type: 'test',
		source_date: new Date('2025-01-01T00:00:00.000Z'),
		extracted_at: new Date('2025-01-01T00:00:00.000Z'),
		confidence: new Decimal(confidence),
	};
}

// Sample triples for different relationship types
export const sampleTriples: Record<string, Triple[]> = {
	entityEntity: [
		createTriple('John Smith', 'is a', 'software engineer', 'ENTITY_ENTITY', 0.95),
		createTriple('John Smith', 'works at', 'Tech Corp', 'ENTITY_ENTITY', 0.9),
		createTriple('Tech Corp', 'is based in', 'San Francisco', 'ENTITY_ENTITY', 0.85),
	],

	entityEvent: [
		{
			subject: 'John Smith',
			predicate: 'participated in',
			object: 'product launch event',
			confidence: new Decimal(0.8),
			type: 'ENTITY_EVENT',
			source: 'test-source',
			source_type: 'test',
			source_date: new Date('2025-01-01T00:00:00.000Z'),
			extracted_at: new Date('2025-01-01T00:00:00.000Z'),
		},
		{
			subject: 'Tech Corp',
			predicate: 'hosted',
			object: 'product launch event',
			confidence: new Decimal(0.9),
			type: 'ENTITY_EVENT',
			source: 'test-source',
			source_type: 'test',
			source_date: new Date('2025-01-01T00:00:00.000Z'),
			extracted_at: new Date('2025-01-01T00:00:00.000Z'),
		},
	],

	eventEvent: [
		{
			subject: 'product development',
			predicate: 'preceded',
			object: 'product launch event',
			confidence: new Decimal(0.85),
			type: 'EVENT_EVENT',
			source: 'test-source',
			source_type: 'test',
			source_date: new Date('2025-01-01T00:00:00.000Z'),
			extracted_at: new Date('2025-01-01T00:00:00.000Z'),
		},
		{
			subject: 'product launch event',
			predicate: 'caused',
			object: 'stock price increase',
			confidence: new Decimal(0.75),
			type: 'EVENT_EVENT',
			source: 'test-source',
			source_type: 'test',
			source_date: new Date('2025-01-01T00:00:00.000Z'),
			extracted_at: new Date('2025-01-01T00:00:00.000Z'),
		},
	],

	emotionalContext: [
		{
			subject: 'John Smith',
			predicate: 'feels',
			object: 'excited about AI projects',
			confidence: new Decimal(0.8),
			type: 'EMOTIONAL_CONTEXT',
			source: 'test-source',
			source_type: 'test',
			source_date: new Date('2025-01-01T00:00:00.000Z'),
			extracted_at: new Date('2025-01-01T00:00:00.000Z'),
		},
		{
			subject: 'Sarah Johnson',
			predicate: 'feels',
			object: 'passionate about technology solutions',
			confidence: new Decimal(0.85),
			type: 'EMOTIONAL_CONTEXT',
			source: 'test-source',
			source_type: 'test',
			source_date: new Date('2025-01-01T00:00:00.000Z'),
			extracted_at: new Date('2025-01-01T00:00:00.000Z'),
		},
	],
};

// Sample concepts at different abstraction levels
export const sampleConcepts: Concept[] = [
	// High-level concepts
	{
		concept: 'Technology Industry',
		abstraction_level: 'HIGH',
		confidence: new Decimal(0.95),
		source: 'test-source',
		source_type: 'test',
		extracted_at: new Date(),
	},
	{
		concept: 'Professional Relationships',
		abstraction_level: 'HIGH',
		confidence: new Decimal(0.93),
		source: 'test-source',
		source_type: 'test',
		extracted_at: new Date(),
	},
	{
		concept: 'Business Operations',
		abstraction_level: 'HIGH',
		confidence: new Decimal(0.91),
		source: 'test-source',
		source_type: 'test',
		extracted_at: new Date(),
	},

	// Medium-level concepts
	{
		concept: 'Software Engineering',
		abstraction_level: 'MEDIUM',
		confidence: new Decimal(0.97),
		source: 'test-source',
		source_type: 'test',
		extracted_at: new Date(),
	},
	{
		concept: 'Artificial Intelligence',
		abstraction_level: 'MEDIUM',
		confidence: new Decimal(0.96),
		source: 'test-source',
		source_type: 'test',
		extracted_at: new Date(),
	},
	{
		concept: 'Product Management',
		abstraction_level: 'MEDIUM',
		confidence: new Decimal(0.94),
		source: 'test-source',
		source_type: 'test',
		extracted_at: new Date(),
	},

	// Low-level concepts
	{
		concept: 'Machine Learning Engineer',
		abstraction_level: 'LOW',
		confidence: new Decimal(0.98),
		source: 'test-source',
		source_type: 'test',
		extracted_at: new Date(),
	},
	{
		concept: 'Product Launch Event',
		abstraction_level: 'LOW',
		confidence: new Decimal(0.92),
		source: 'test-source',
		source_type: 'test',
		extracted_at: new Date(),
	},
	{
		concept: 'Natural Language Processing',
		abstraction_level: 'LOW',
		confidence: new Decimal(0.95),
		source: 'test-source',
		source_type: 'test',
		extracted_at: new Date(),
	},
];

// Test arguments for different scenarios
export const testScenarios: Record<string, ProcessKnowledgeArgs> = {
	simple: {
		text: testTexts.small,
		source: 'simple-test-doc',
		source_type: 'document',
		source_date: '2025-01-01T00:00:00.000Z',
	},

	complex: {
		text: testTexts.large,
		source: 'complex-test-doc',
		source_type: 'article',
		source_date: '2025-01-01T00:00:00.000Z',
	},

	chunked: {
		text: testTexts.large,
		source: 'chunked-test-doc',
		source_type: 'long_document',
		source_date: '2025-01-01T00:00:00.000Z',
	},

	minimal: {
		text: testTexts.tiny,
		source: 'minimal-test',
		source_type: 'snippet',
		source_date: '2025-01-01T00:00:00.000Z',
	},
};

// Expected extraction results for validation
export const expectedResults = {
	simple: {
		minimumTriples: 2,
		expectedEntities: ['John Smith', 'Tech Corp', 'software engineer'],
		expectedRelations: ['works at', 'is a'],
		expectedConcepts: 3,
	},

	complex: {
		minimumTriples: 10,
		expectedEntities: ['John Smith', 'Sarah Johnson', 'Tech Corp', 'Stanford University'],
		expectedRelations: ['works at', 'collaborated with', 'graduated from'],
		expectedConcepts: 8,
	},
};

// Mock AI responses for different extraction methods
export const mockAIExtractions = {
	singlePass: {
		response: JSON.stringify({
			triples: [
				...sampleTriples.entityEntity,
				...sampleTriples.entityEvent.slice(0, 1),
				...sampleTriples.emotionalContext.slice(0, 1),
			],
		}),
		usage: {
			promptTokens: 500,
			completionTokens: 300,
			totalTokens: 800,
		},
	},

	fourStage: {
		entityEntity: {
			response: JSON.stringify({ triples: sampleTriples.entityEntity }),
			usage: { promptTokens: 200, completionTokens: 150, totalTokens: 350 },
		},
		entityEvent: {
			response: JSON.stringify({ triples: sampleTriples.entityEvent }),
			usage: { promptTokens: 200, completionTokens: 100, totalTokens: 300 },
		},
		eventEvent: {
			response: JSON.stringify({ triples: sampleTriples.eventEvent }),
			usage: { promptTokens: 200, completionTokens: 120, totalTokens: 320 },
		},
		emotionalContext: {
			response: JSON.stringify({ triples: sampleTriples.emotionalContext }),
			usage: { promptTokens: 200, completionTokens: 80, totalTokens: 280 },
		},
	},
};

// Error scenarios for testing
export const errorScenarios = {
	malformedJSON: {
		response: '{ invalid json structure',
		expectedError: 'PARSE_ERROR',
	},

	emptyResponse: {
		response: '',
		expectedError: 'PARSE_ERROR',
	},

	invalidSchema: {
		response: JSON.stringify({
			wrong_field: 'invalid structure',
		}),
		expectedError: 'VALIDATION_ERROR',
	},

	partialFailure: {
		response: JSON.stringify({
			triples: [
				sampleTriples.entityEntity[0], // Valid triple
				{ subject: '', predicate: 'invalid', object: '' }, // Invalid triple
			],
		}),
		expectedFilteredCount: 1,
	},
};

// Performance test data
export const performanceData = {
	batchSizes: [1, 10, 50, 100],
	concurrencyLevels: [1, 2, 4, 8],
	textSizes: {
		small: testTexts.small,
		medium: testTexts.medium,
		large: testTexts.large,
		xlarge: testTexts.large.repeat(5),
	},
};

// Database seed data
export const seedData = {
	processingJobs: [
		{
			job_type: 'EXTRACT_KNOWLEDGE_BATCH' as const,
			text: testTexts.small,
			status: 'COMPLETED' as const,
			progress: 100,
		},
		{
			job_type: 'GENERATE_CONCEPTS' as const,
			text: '',
			status: 'PROCESSING' as const,
			progress: 50,
		},
	],

	knowledgeTriples: sampleTriples.entityEntity.slice(0, 2),

	conceptNodes: sampleConcepts.slice(0, 3),
};
