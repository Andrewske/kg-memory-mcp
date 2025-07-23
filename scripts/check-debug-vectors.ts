#!/usr/bin/env npx tsx

/**
 * Check specifically for the vectors we just created in our debug test
 */

import { config as dotenvConfig } from "dotenv";
import { PrismaClient } from "@prisma/client";

// Load environment variables
dotenvConfig();

async function checkDebugVectors() {
	console.log("🔍 Checking for Debug Test Vectors\n");

	try {
		const prisma = new PrismaClient();

		// Check for our debug test triples specifically
		const debugTriples = await prisma.knowledgeTriple.findMany({
			where: {
				source: "debug-test"
			},
			include: {
				semantic_vectors: true
			}
		});

		console.log(`📊 Debug test triples found: ${debugTriples.length}`);

		if (debugTriples.length > 0) {
			console.log(`\n📝 Debug test triples:`);
			debugTriples.forEach((triple, i) => {
				console.log(`   ${i + 1}. "${triple.subject}" → "${triple.predicate}" → "${triple.object}"`);
				console.log(`      ID: ${triple.id}`);
				console.log(`      Source: ${triple.source}`);
				console.log(`      Semantic vectors: ${triple.semantic_vectors.length}`);
				
				if (triple.semantic_vectors.length > 0) {
					const vector = triple.semantic_vectors[0];
					console.log(`      Vector ID: ${vector.vectorId}`);
					console.log(`      Vector text: "${vector.text}"`);
					console.log(`      Embedding length: ${vector.embedding ? JSON.parse(vector.embedding).length : 0}`);
					if (vector.embedding) {
						const embeddingArray = JSON.parse(vector.embedding);
						console.log(`      Sample values: [${embeddingArray.slice(0, 3).map((v: number) => v.toFixed(4)).join(', ')}...]`);
					}
				}
				console.log("");
			});
		} else {
			console.log("❌ No debug test triples found!");
		}

		// Check total counts
		const totalTriples = await prisma.knowledgeTriple.count();
		const totalVectors = await prisma.semanticVector.count();
		const vectorsWithEmbeddings = await prisma.semanticVector.count({
			where: {
				embedding: {
					not: null
				}
			}
		});

		console.log(`📊 Database Statistics:`);
		console.log(`   Total triples: ${totalTriples}`);
		console.log(`   Total semantic vectors: ${totalVectors}`);
		console.log(`   Vectors with embeddings: ${vectorsWithEmbeddings}`);
		console.log(`   Vectors without embeddings: ${totalVectors - vectorsWithEmbeddings}`);

		await prisma.$disconnect();

	} catch (error) {
		console.error("❌ Check failed:", error);
		process.exit(1);
	}
}

// Run the check
checkDebugVectors().catch(console.error);