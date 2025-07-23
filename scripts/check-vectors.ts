#!/usr/bin/env npx tsx

/**
 * Simple script to check if any semantic vectors exist in the database
 */

import { config as dotenvConfig } from "dotenv";
import { PrismaClient } from "@prisma/client";

// Load environment variables
dotenvConfig();

async function checkVectors() {
	console.log("🔍 Checking Semantic Vectors in Database\n");

	try {
		const prisma = new PrismaClient();

		// Check how many semantic vectors exist
		const vectorCount = await prisma.semanticVector.count();
		console.log(`📊 Total semantic vectors: ${vectorCount}`);

		// Check how many knowledge triples exist
		const tripleCount = await prisma.knowledgeTriple.count();
		console.log(`📊 Total knowledge triples: ${tripleCount}`);

		if (vectorCount > 0) {
			// Get a sample of the semantic vectors
			const sampleVectors = await prisma.semanticVector.findMany({
				take: 5,
				include: {
					knowledge_triple: {
						select: {
							subject: true,
							predicate: true,
							object: true,
							type: true,
						}
					}
				}
			});

			console.log(`\n📝 Sample semantic vectors (${sampleVectors.length}):`);
			sampleVectors.forEach((vector, i) => {
				console.log(`   ${i + 1}. Triple: "${vector.knowledge_triple.subject}" → "${vector.knowledge_triple.predicate}" → "${vector.knowledge_triple.object}"`);
				console.log(`      Vector ID: ${vector.vectorId}`);
				console.log(`      Text: "${vector.text}"`);
				console.log(`      Embedding length: ${vector.embedding ? JSON.parse(vector.embedding).length : 0}`);
			});

			console.log("\n✅ Semantic vectors found! The integration should be working.");
		} else {
			console.log("\n❌ No semantic vectors found. Vector generation may have failed.");
		}

		await prisma.$disconnect();

	} catch (error) {
		console.error("❌ Check failed:", error);
		process.exit(1);
	}
}

// Run the check
checkVectors().catch(console.error);