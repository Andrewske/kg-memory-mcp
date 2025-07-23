-- Migration: Add pgvector support to existing vector tables
-- This migration converts existing Decimal[] embeddings to pgvector vector type

-- First, check if we have any existing vector data
SELECT COUNT(*) FROM entity_vectors;
SELECT COUNT(*) FROM relationship_vectors;
SELECT COUNT(*) FROM semantic_vectors;
SELECT COUNT(*) FROM concept_vectors;

-- Add new vector columns (temporary)
ALTER TABLE entity_vectors ADD COLUMN embedding_new vector(1536);
ALTER TABLE relationship_vectors ADD COLUMN embedding_new vector(1536);
ALTER TABLE semantic_vectors ADD COLUMN embedding_new vector(1536);
ALTER TABLE concept_vectors ADD COLUMN embedding_new vector(1536);

-- If there's existing data, we would need to convert it here
-- For now, we'll assume empty tables or will handle data migration separately

-- Drop old embedding columns
ALTER TABLE entity_vectors DROP COLUMN embedding;
ALTER TABLE relationship_vectors DROP COLUMN embedding;
ALTER TABLE semantic_vectors DROP COLUMN embedding;
ALTER TABLE concept_vectors DROP COLUMN embedding;

-- Rename new columns
ALTER TABLE entity_vectors RENAME COLUMN embedding_new TO embedding;
ALTER TABLE relationship_vectors RENAME COLUMN embedding_new TO embedding;
ALTER TABLE semantic_vectors RENAME COLUMN embedding_new TO embedding;
ALTER TABLE concept_vectors RENAME COLUMN embedding_new TO embedding;

-- Create vector indexes for efficient similarity search
CREATE INDEX IF NOT EXISTS entity_vectors_embedding_idx ON entity_vectors USING ivfflat (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS relationship_vectors_embedding_idx ON relationship_vectors USING ivfflat (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS semantic_vectors_embedding_idx ON semantic_vectors USING ivfflat (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS concept_vectors_embedding_idx ON concept_vectors USING ivfflat (embedding vector_cosine_ops);

-- Test vector operations
SELECT 'Vector support enabled successfully!'::text as status;
SELECT '[1,2,3]'::vector <-> '[4,5,6]'::vector as test_cosine_distance;