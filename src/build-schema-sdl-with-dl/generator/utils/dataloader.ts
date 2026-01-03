import DataLoader from 'dataloader';
import { eq, inArray, and, SQL } from 'drizzle-orm';
import type { RelationalQueryBuilder } from 'drizzle-orm/sqlite-core/query-builders/query';
import type { TableInfo, TableNamedRelations } from '../types';
import { buildWhereClause, type WhereInput } from './filters';
import { buildOrderByClause, extractSelectedColumns, type OrderByInput } from './selection';
import type { ResolveTree } from 'graphql-parse-resolve-info';

export interface RelationLoaderKey {
  relationName: string;
  parentIds: any[];
  foreignKey: string;
  isReversedRelation: boolean;
  where?: WhereInput;
  orderBy?: OrderByInput;
  limit?: number;
  offset?: number;
  columns?: Record<string, boolean>;
}

export interface RelationLoaderResult {
  parentId: any;
  data: any[];
}

export class RelationDataLoader {
  private loaders: Map<string, DataLoader<RelationLoaderKey, RelationLoaderResult[]>> = new Map();

  constructor(
    private queryBase: RelationalQueryBuilder<any, any, any, any>,
    private tableInfo: TableInfo,
    private relations: Record<string, TableNamedRelations>,
    private context?: any,  // Add context parameter
    private debugConfig?: { dataLoader?: boolean; exportVariables?: boolean }  // Add debug config
  ) {}

  private createLoaderKey(key: RelationLoaderKey): string {
    return JSON.stringify({
      relationName: key.relationName,
      foreignKey: key.foreignKey,
      isReversedRelation: key.isReversedRelation,
      where: key.where,
      orderBy: key.orderBy,
      limit: key.limit,
      offset: key.offset,
      columns: key.columns,
    });
  }

  private getOrCreateLoader(loaderKey: string): DataLoader<RelationLoaderKey, RelationLoaderResult[]> {
    if (!this.loaders.has(loaderKey)) {
      const loader = new DataLoader<RelationLoaderKey, RelationLoaderResult[]>(
        async (keys) => this.batchLoadRelations(keys)
      );
      this.loaders.set(loaderKey, loader);
    }
    return this.loaders.get(loaderKey)!;
  }

  private async batchLoadRelations(keys: readonly RelationLoaderKey[]): Promise<RelationLoaderResult[][]> {
    // Group keys by relation configuration (same where, orderBy, etc.)
    const groupedKeys = new Map<string, RelationLoaderKey[]>();
    
    for (const key of keys) {
      const configKey = this.createLoaderKey(key);
      if (!groupedKeys.has(configKey)) {
        groupedKeys.set(configKey, []);
      }
      groupedKeys.get(configKey)!.push(key);
    }

    const results: RelationLoaderResult[][] = [];

    // Process each group
    for (const [configKey, groupKeys] of Array.from(groupedKeys)) {
      const firstKey = groupKeys[0];
      if (!firstKey) {
        // If no keys in group, skip
        continue;
      }
      
      // Collect all parent IDs from this group
      const allParentIds = groupKeys.flatMap(key => key.parentIds);
      const uniqueParentIds = Array.from(new Set(allParentIds));

      // RESOLVE EXPORT VARIABLES BEFORE BUILDING QUERY
      let resolvedWhere = firstKey.where;
      if (resolvedWhere && this.context?.exportStore) {
        const { hasExportVariables, resolveExportVariables } = await import('../../../export-tool/utils');
        if (hasExportVariables(resolvedWhere)) {
          try {
            if (this.debugConfig?.exportVariables) {
              console.log(`🔍 DataLoader: Resolving export variables in where clause:`, resolvedWhere);
            }
            resolvedWhere = await resolveExportVariables(resolvedWhere, this.context.exportStore);
            if (this.debugConfig?.exportVariables) {
              console.log(`✅ DataLoader: Successfully resolved to:`, resolvedWhere);
            }
          } catch (error) {
            if (this.debugConfig?.exportVariables) {
              console.warn(`❌ DataLoader: Failed to resolve export variables:`, error);
            }
            // Continue with original where clause
          }
        }
      }

      // Build the query with resolved where clause
      const whereClause = this.buildBatchWhereClause(
        uniqueParentIds, 
        firstKey.isReversedRelation, 
        firstKey.foreignKey,
        resolvedWhere  // Use resolved where clause
      );
      if (!whereClause) {
        // If we can't build a where clause, return empty results
        results.push(...groupKeys.map(() => []));
        continue;
      }

      let query = this.queryBase.findMany({
        columns: {
          ...firstKey.columns || {},
          // Always include the foreign key column for mapping
          [firstKey.foreignKey]: true,
        },
        where: whereClause,
        orderBy: firstKey.orderBy ? buildOrderByClause(this.tableInfo, firstKey.orderBy) : undefined,
        limit: firstKey.limit,
        offset: firstKey.offset,
      });

      if (this.debugConfig?.dataLoader) {
        console.log(`DataLoader executing query for relation ${firstKey.relationName} with foreign key ${firstKey.foreignKey}`);
      }
      const batchResults = await query;
      if (this.debugConfig?.dataLoader) {
        console.log(`DataLoader got ${batchResults.length} results:`, batchResults);
      }

      // Group results by parent ID
      const resultsByParentId = new Map<any, any[]>();
      for (const result of batchResults) {
        // The parent ID is always the value of the foreign key column in the result
        const parentId = (result as any)[firstKey.foreignKey];
        
        if (!resultsByParentId.has(parentId)) {
          resultsByParentId.set(parentId, []);
        }
        resultsByParentId.get(parentId)!.push(result);
      }

      // Map results back to each key's parent IDs
      for (const key of groupKeys) {
        const keyResults: RelationLoaderResult[] = key.parentIds.map(parentId => ({
          parentId,
          data: resultsByParentId.get(parentId) || [],
        }));
        results.push(keyResults);
      }
    }

    return results;
  }

  private buildBatchWhereClause(
    parentIds: any[],
    isReversedRelation: boolean,
    foreignKeyName: string,
    additionalWhere?: WhereInput
  ): SQL | undefined {
    const foreignKeyColumn = this.tableInfo.columns[foreignKeyName];
    if (!foreignKeyColumn) {
      console.error(`Foreign key column ${foreignKeyName} not found in table ${this.tableInfo.name}`);
      console.error(`Available columns:`, Object.keys(this.tableInfo.columns));
      return undefined;
    }

    const parentIdClause = inArray(foreignKeyColumn, parentIds);
    
    if (!additionalWhere) {
      return parentIdClause;
    }

    const additionalClause = buildWhereClause(this.tableInfo, additionalWhere);
    return additionalClause ? and(parentIdClause, additionalClause) : parentIdClause;
  }

  async loadRelation(
    relationName: string,
    parentIds: any[],
    foreignKey: string,
    options: {
      where?: WhereInput;
      orderBy?: OrderByInput;
      limit?: number;
      offset?: number;
      columns?: Record<string, boolean>;
    } = {},
    isReversedRelation: boolean = false
  ): Promise<RelationLoaderResult[]> {
    const key: RelationLoaderKey = {
      relationName,
      parentIds,
      foreignKey,
      isReversedRelation,
      ...options,
    };

    const loaderKey = this.createLoaderKey(key);
    const loader = this.getOrCreateLoader(loaderKey);
    
    const result = await loader.load(key);
    return result;
  }

  // Clear all loaders (call this at the end of each request)
  clearAll(): void {
    for (const loader of Array.from(this.loaders.values())) {
      loader.clearAll();
    }
    this.loaders.clear();
  }
}

// Context interface for DataLoader
export interface DataLoaderContext {
  relationLoaders: Map<string, RelationDataLoader>;
}

// Helper to get or create relation loader for a table
export function getRelationLoader(
  context: DataLoaderContext,
  tableName: string,
  queryBase: RelationalQueryBuilder<any, any, any, any>,
  tableInfo: TableInfo,
  relations: Record<string, TableNamedRelations>,
  debugConfig?: { dataLoader?: boolean; exportVariables?: boolean }
): RelationDataLoader {
  if (!context.relationLoaders.has(tableName)) {
    context.relationLoaders.set(
      tableName,
      new RelationDataLoader(queryBase, tableInfo, relations, context, debugConfig)  // Pass debug config
    );
  }
  return context.relationLoaders.get(tableName)!;
}