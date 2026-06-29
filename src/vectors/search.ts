/**
 * Vector Search
 *
 * Provides vector similarity search using sqlite-vec extension.
 * Falls back to brute-force cosine similarity if sqlite-vec is not available.
 */

import Database from 'better-sqlite3';
import { Node } from '../types';
import { TextEmbedder, EMBEDDING_DIMENSION } from './embedder';

/**
 * Options for vector search
 */
export interface VectorSearchOptions {
  /** Maximum number of results to return */
  limit?: number;

  /** Minimum similarity score (0-1) */
  minScore?: number;

  /** Node kinds to filter results */
  nodeKinds?: Node['kind'][];
}

/**
 * Vector Search Manager
 *
 * Handles vector storage and similarity search for semantic code search.
 */
export class VectorSearchManager {
  private db: Database.Database;
  private vecEnabled = false;
  private embeddingDimension: number;

  constructor(db: Database.Database, dimension: number = EMBEDDING_DIMENSION) {
    this.db = db;
    this.embeddingDimension = dimension;
  }

  /**
   * Initialize vector search
   *
   * Attempts to load sqlite-vec extension. Falls back to brute-force
   * search if the extension is not available.
   */
  async initialize(): Promise<void> {
    try {
      // Try to load sqlite-vec extension
      await this.loadVecExtension();
      this.vecEnabled = true;
      console.log('sqlite-vec extension loaded successfully');

      // Create the vec virtual table
      this.createVecTable();
    } catch (error) {
      // Fall back to brute-force search
      console.warn(
        'sqlite-vec extension not available, falling back to brute-force search:',
        error instanceof Error ? error.message : String(error)
      );
      this.vecEnabled = false;
    }

    // Ensure the vectors table exists (for both vec and fallback modes)
    this.ensureVectorsTable();
  }

  /**
   * Load the sqlite-vec extension
   */
  private async loadVecExtension(): Promise<void> {
    try {
      const sqliteVec = await import('sqlite-vec');

      if (typeof sqliteVec.load === 'function') {
        sqliteVec.load(this.db);
      } else if (typeof sqliteVec.default?.load === 'function') {
        sqliteVec.default.load(this.db);
      } else {
        throw new Error('sqlite-vec load function not found');
      }
    } catch (error) {
      throw new Error(`Failed to load sqlite-vec: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Create the vec virtual table for vector search
   */
  private createVecTable(): void {
    // Check if the table already exists
    const tableExists = this.db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='vec_vectors'")
      .get();

    if (!tableExists) {
      // Create vec0 virtual table with node_id as auxiliary column
      this.db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS vec_vectors USING vec0(
          node_id text,
          embedding float[${this.embeddingDimension}]
        );
      `);
    }
  }

  /**
   * Ensure the basic vectors table exists (for fallback mode)
   */
  private ensureVectorsTable(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS vectors (
        node_id TEXT PRIMARY KEY,
        embedding BLOB NOT NULL,
        model TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
    `);
  }

  /**
   * Check if vec extension is enabled
   */
  isVecEnabled(): boolean {
    return this.vecEnabled;
  }

  /**
   * Store a vector embedding for a node
   *
   * @param nodeId - ID of the node
   * @param embedding - Vector embedding
   * @param model - Model used to generate embedding
   */
  storeVector(nodeId: string, embedding: Float32Array, model: string): void {
    const now = Date.now();

    // Store in the vectors table (always, for persistence)
    const blob = Buffer.from(embedding.buffer);
    this.db
      .prepare(
        `
        INSERT OR REPLACE INTO vectors (node_id, embedding, model, created_at)
        VALUES (?, ?, ?, ?)
      `
      )
      .run(nodeId, blob, model, now);

    // Also store in vec table if enabled
    if (this.vecEnabled) {
      this.storeInVec(nodeId, embedding);
    }
  }

  /**
   * Store vector in vec virtual table
   */
  private storeInVec(nodeId: string, embedding: Float32Array): void {
    try {
      const buffer = Buffer.from(embedding.buffer, embedding.byteOffset, embedding.byteLength);

      // Delete existing entry if present, then insert
      this.db.prepare('DELETE FROM vec_vectors WHERE node_id = ?').run(nodeId);
      this.db
        .prepare('INSERT INTO vec_vectors(node_id, embedding) VALUES (?, ?)')
        .run(nodeId, buffer);
    } catch (error) {
      console.warn(
        'vec storage failed, using brute-force search:',
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  /**
   * Store multiple vectors in a batch
   *
   * @param entries - Array of node IDs and embeddings
   * @param model - Model used to generate embeddings
   */
  storeVectorBatch(
    entries: Array<{ nodeId: string; embedding: Float32Array }>,
    model: string
  ): void {
    const now = Date.now();

    // Use a transaction for better performance
    this.db.transaction(() => {
      for (const entry of entries) {
        const blob = Buffer.from(entry.embedding.buffer);
        this.db
          .prepare(
            `
            INSERT OR REPLACE INTO vectors (node_id, embedding, model, created_at)
            VALUES (?, ?, ?, ?)
          `
          )
          .run(entry.nodeId, blob, model, now);

        if (this.vecEnabled) {
          this.storeInVec(entry.nodeId, entry.embedding);
        }
      }
    })();
  }

  /**
   * Get vector for a node
   *
   * @param nodeId - ID of the node
   * @returns Embedding or null if not found
   */
  getVector(nodeId: string): Float32Array | null {
    const row = this.db
      .prepare('SELECT embedding FROM vectors WHERE node_id = ?')
      .get(nodeId) as { embedding: Buffer } | undefined;

    if (!row) {
      return null;
    }

    return new Float32Array(row.embedding.buffer.slice(
      row.embedding.byteOffset,
      row.embedding.byteOffset + row.embedding.byteLength
    ));
  }

  /**
   * Delete vector for a node
   *
   * @param nodeId - ID of the node
   */
  deleteVector(nodeId: string): void {
    this.db.prepare('DELETE FROM vectors WHERE node_id = ?').run(nodeId);

    if (this.vecEnabled) {
      this.db.prepare('DELETE FROM vec_vectors WHERE node_id = ?').run(nodeId);
    }
  }

  /**
   * Search for similar vectors
   *
   * @param queryEmbedding - Query vector to search for
   * @param options - Search options
   * @returns Array of node IDs with similarity scores
   */
  search(
    queryEmbedding: Float32Array,
    options: VectorSearchOptions = {}
  ): Array<{ nodeId: string; score: number }> {
    const { limit = 10, minScore = 0 } = options;

    if (this.vecEnabled) {
      return this.searchWithVec(queryEmbedding, limit, minScore);
    } else {
      return this.searchBruteForce(queryEmbedding, limit, minScore);
    }
  }

  /**
   * Search using sqlite-vec KNN search
   */
  private searchWithVec(
    queryEmbedding: Float32Array,
    limit: number,
    minScore: number
  ): Array<{ nodeId: string; score: number }> {
    try {
      const buffer = Buffer.from(
        queryEmbedding.buffer,
        queryEmbedding.byteOffset,
        queryEmbedding.byteLength
      );
      const safeLimit = Math.max(1, Math.floor(limit));

      // Use vec0 KNN search with MATCH syntax
      const rows = this.db
        .prepare(
          `
          SELECT node_id, distance
          FROM vec_vectors
          WHERE embedding MATCH ?
            AND k = ${safeLimit}
        `
        )
        .all(buffer) as Array<{ node_id: string; distance: number }>;

      // Convert distance to similarity score (1 / (1 + distance))
      return rows
        .map((row) => ({
          nodeId: row.node_id,
          score: 1 / (1 + row.distance),
        }))
        .filter((r) => r.score >= minScore);
    } catch (error) {
      // vec search failed, fall back to brute force
      console.warn(
        'vec search failed, using brute-force:',
        error instanceof Error ? error.message : String(error)
      );
      return this.searchBruteForce(queryEmbedding, limit, minScore);
    }
  }

  /**
   * Brute-force search using cosine similarity
   */
  private searchBruteForce(
    queryEmbedding: Float32Array,
    limit: number,
    minScore: number
  ): Array<{ nodeId: string; score: number }> {
    // Get all vectors
    const rows = this.db
      .prepare('SELECT node_id, embedding FROM vectors')
      .all() as Array<{ node_id: string; embedding: Buffer }>;

    // Calculate cosine similarity for each
    const results: Array<{ nodeId: string; score: number }> = [];

    for (const row of rows) {
      const embedding = new Float32Array(row.embedding.buffer.slice(
        row.embedding.byteOffset,
        row.embedding.byteOffset + row.embedding.byteLength
      ));

      const score = TextEmbedder.cosineSimilarity(queryEmbedding, embedding);

      if (score >= minScore) {
        results.push({ nodeId: row.node_id, score });
      }
    }

    // Sort by score descending and limit
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, limit);
  }

  /**
   * Get count of stored vectors
   */
  getVectorCount(): number {
    const result = this.db
      .prepare('SELECT COUNT(*) as count FROM vectors')
      .get() as { count: number };
    return result.count;
  }

  /**
   * Check if a node has a vector
   */
  hasVector(nodeId: string): boolean {
    const result = this.db
      .prepare('SELECT 1 FROM vectors WHERE node_id = ? LIMIT 1')
      .get(nodeId);
    return !!result;
  }

  /**
   * Get all node IDs that have vectors
   */
  getIndexedNodeIds(): string[] {
    const rows = this.db
      .prepare('SELECT node_id FROM vectors')
      .all() as Array<{ node_id: string }>;
    return rows.map((r) => r.node_id);
  }

  /**
   * Clear all vectors
   */
  clear(): void {
    this.db.prepare('DELETE FROM vectors').run();

    if (this.vecEnabled) {
      this.db.prepare('DELETE FROM vec_vectors').run();
    }
  }

  /**
   * Rebuild vec index from vectors table
   *
   * Useful after bulk operations or if vec index gets out of sync.
   */
  rebuildVecIndex(): void {
    if (!this.vecEnabled) {
      return;
    }

    // Clear vec table
    this.db.prepare('DELETE FROM vec_vectors').run();

    // Reload from vectors table
    const rows = this.db
      .prepare('SELECT node_id, embedding FROM vectors')
      .all() as Array<{ node_id: string; embedding: Buffer }>;

    this.db.transaction(() => {
      for (const row of rows) {
        const embedding = new Float32Array(row.embedding.buffer.slice(
          row.embedding.byteOffset,
          row.embedding.byteOffset + row.embedding.byteLength
        ));
        this.storeInVec(row.node_id, embedding);
      }
    })();
  }
}

/**
 * Create a vector search manager
 */
export function createVectorSearch(
  db: Database.Database,
  dimension?: number
): VectorSearchManager {
  return new VectorSearchManager(db, dimension);
}
