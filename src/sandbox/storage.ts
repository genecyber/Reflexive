/**
 * Storage Provider for Snapshots
 *
 * Provides an interface for storing and retrieving sandbox snapshots.
 * Implementations include MemoryStorage (testing) and S3Storage (production).
 */

import type { Snapshot } from '../types/index.js';

/**
 * Storage provider interface for snapshot persistence
 */
export interface StorageProvider {
  /**
   * Save a snapshot
   */
  save(snapshot: Snapshot): Promise<void>;

  /**
   * Load a snapshot by ID
   */
  load(snapshotId: string): Promise<Snapshot | null>;

  /**
   * List all snapshots
   */
  list(): Promise<Snapshot[]>;

  /**
   * Delete a snapshot
   */
  delete(snapshotId: string): Promise<boolean>;

  /**
   * Check if a snapshot exists
   */
  exists(snapshotId: string): Promise<boolean>;
}

/**
 * In-memory storage implementation for testing and development
 */
export class MemoryStorage implements StorageProvider {
  private snapshots = new Map<string, Snapshot>();

  async save(snapshot: Snapshot): Promise<void> {
    this.snapshots.set(snapshot.id, structuredClone(snapshot));
  }

  async load(snapshotId: string): Promise<Snapshot | null> {
    const snapshot = this.snapshots.get(snapshotId);
    return snapshot ? structuredClone(snapshot) : null;
  }

  async list(): Promise<Snapshot[]> {
    return Array.from(this.snapshots.values()).map(s => structuredClone(s));
  }

  async delete(snapshotId: string): Promise<boolean> {
    return this.snapshots.delete(snapshotId);
  }

  async exists(snapshotId: string): Promise<boolean> {
    return this.snapshots.has(snapshotId);
  }

  /**
   * Clear all snapshots (for testing)
   */
  clear(): void {
    this.snapshots.clear();
  }

  /**
   * Get count of stored snapshots (for testing)
   */
  size(): number {
    return this.snapshots.size;
  }
}

/**
 * S3-compatible storage configuration
 */
export interface S3StorageConfig {
  bucket: string;
  endpoint?: string;
  region?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  prefix?: string;
}

/**
 * S3-compatible storage implementation for production use
 * Supports AWS S3, Cloudflare R2, MinIO, etc.
 */
export class S3Storage implements StorageProvider {
  private config: S3StorageConfig;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private s3Client: any = null;
  private initialized = false;

  constructor(config: S3StorageConfig) {
    this.config = {
      prefix: 'reflexive-snapshots/',
      ...config,
    };
  }

  /**
   * Lazily initialize S3 client
   */
  private async getClient(): Promise<unknown> {
    if (this.s3Client) return this.s3Client;

    try {
      // Dynamic import for optional dependency
      const { S3Client } = await import('@aws-sdk/client-s3');

      this.s3Client = new S3Client({
        endpoint: this.config.endpoint,
        region: this.config.region || 'auto',
        credentials: this.config.accessKeyId
          ? {
              accessKeyId: this.config.accessKeyId,
              secretAccessKey: this.config.secretAccessKey || '',
            }
          : undefined,
      });

      this.initialized = true;
      return this.s3Client;
    } catch {
      throw new Error(
        '@aws-sdk/client-s3 is not installed. Install it with: npm install @aws-sdk/client-s3'
      );
    }
  }

  /**
   * Get the S3 key for a snapshot
   */
  private getKey(snapshotId: string): string {
    return `${this.config.prefix}${snapshotId}.json`;
  }

  async save(snapshot: Snapshot): Promise<void> {
    const client = await this.getClient();
    const { PutObjectCommand } = await import('@aws-sdk/client-s3');

    const command = new PutObjectCommand({
      Bucket: this.config.bucket,
      Key: this.getKey(snapshot.id),
      Body: JSON.stringify(snapshot),
      ContentType: 'application/json',
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (client as any).send(command);
  }

  async load(snapshotId: string): Promise<Snapshot | null> {
    const client = await this.getClient();
    const { GetObjectCommand } = await import('@aws-sdk/client-s3');

    try {
      const command = new GetObjectCommand({
        Bucket: this.config.bucket,
        Key: this.getKey(snapshotId),
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const response = await (client as any).send(command);
      const body = await response.Body?.transformToString();

      if (!body) return null;
      return JSON.parse(body) as Snapshot;
    } catch (error: unknown) {
      // Handle not found
      if (error && typeof error === 'object' && 'name' in error && error.name === 'NoSuchKey') {
        return null;
      }
      throw error;
    }
  }

  async list(): Promise<Snapshot[]> {
    const client = await this.getClient();
    const { ListObjectsV2Command, GetObjectCommand } = await import('@aws-sdk/client-s3');

    const listCommand = new ListObjectsV2Command({
      Bucket: this.config.bucket,
      Prefix: this.config.prefix,
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = await (client as any).send(listCommand);
    const contents = response.Contents || [];

    // Load each snapshot
    const snapshots: Snapshot[] = [];

    for (const item of contents) {
      if (!item.Key?.endsWith('.json')) continue;

      try {
        const getCommand = new GetObjectCommand({
          Bucket: this.config.bucket,
          Key: item.Key,
        });

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const getResponse = await (client as any).send(getCommand);
        const body = await getResponse.Body?.transformToString();

        if (body) {
          snapshots.push(JSON.parse(body) as Snapshot);
        }
      } catch {
        // Skip invalid snapshots
      }
    }

    // Sort by timestamp descending
    return snapshots.sort((a, b) => b.timestamp - a.timestamp);
  }

  async delete(snapshotId: string): Promise<boolean> {
    const client = await this.getClient();
    const { DeleteObjectCommand } = await import('@aws-sdk/client-s3');

    try {
      const command = new DeleteObjectCommand({
        Bucket: this.config.bucket,
        Key: this.getKey(snapshotId),
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (client as any).send(command);
      return true;
    } catch {
      return false;
    }
  }

  async exists(snapshotId: string): Promise<boolean> {
    const client = await this.getClient();
    const { HeadObjectCommand } = await import('@aws-sdk/client-s3');

    try {
      const command = new HeadObjectCommand({
        Bucket: this.config.bucket,
        Key: this.getKey(snapshotId),
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (client as any).send(command);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Check if S3 client is initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }
}

/**
 * Create a storage provider based on configuration
 */
export function createStorageProvider(
  config: { provider: 's3' | 'r2' | 'memory'; bucket?: string; endpoint?: string }
): StorageProvider {
  switch (config.provider) {
    case 'memory':
      return new MemoryStorage();

    case 's3':
    case 'r2':
      if (!config.bucket) {
        throw new Error('S3/R2 storage requires a bucket configuration');
      }
      return new S3Storage({
        bucket: config.bucket,
        endpoint: config.endpoint,
      });

    default:
      throw new Error(`Unknown storage provider: ${config.provider}`);
  }
}
