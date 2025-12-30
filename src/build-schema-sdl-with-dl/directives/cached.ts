import { mapSchema, getDirective, MapperKind } from '@graphql-tools/utils';
import { GraphQLSchema, defaultFieldResolver, GraphQLResolveInfo } from 'graphql';

export interface PopulateFromParentConfig {
  source: string;           // The parent field to get data from (e.g., "comments")
  filter?: any;            // Filter to apply to parent data
  single?: boolean;        // Return single item vs array
}

export function populateFromParentDirectiveTransformer(schema: GraphQLSchema, directiveName = 'populateFromParent') {
  return mapSchema(schema, {
    [MapperKind.OBJECT_FIELD]: (fieldConfig, fieldName, typeName) => {
      const populateDirective = getDirective(schema, fieldConfig, directiveName)?.[0] as PopulateFromParentConfig;
      
      if (populateDirective) {
        const { resolve = defaultFieldResolver } = fieldConfig;
        
        fieldConfig.resolve = async (source, args, context, info: GraphQLResolveInfo) => {
          // Check if this field has arguments (WHERE, LIMIT, etc.)
          const hasComplexArgs = Object.keys(args).some(key => 
            ['where', 'orderBy', 'limit', 'offset'].includes(key)
          );
          
          // If complex args exist, use original resolver (fresh DB query)
          if (hasComplexArgs) {
            console.log(`🔄 Using fresh query for ${fieldName} due to complex filtering`);
            return resolve(source, args, context, info);
          }
          
          // Try to populate from parent data
          const parentData = source[populateDirective.source];
          
          if (parentData && Array.isArray(parentData)) {
            console.log(`⚡ Using parent data for ${fieldName} (avoiding DB query)`);
            const filtered = applyParentFilter(parentData, populateDirective.filter, source);
            return populateDirective.single ? filtered[0] || null : filtered;
          }
          
          // Fallback to original resolver
          console.log(`🔄 Fallback to fresh query for ${fieldName} (no parent data)`);
          return resolve(source, args, context, info);
        };
      }
      
      return fieldConfig;
    },
  });
}

function applyParentFilter(data: any[], filter: any, parent: any): any[] {
  if (!filter) return data;
  
  return data.filter(item => {
    return Object.entries(filter).every(([key, condition]: [string, any]) => {
      if (condition.eq) {
        const value = condition.eq.startsWith('$parent.') 
          ? parent[condition.eq.replace('$parent.', '')]
          : condition.eq;
        return item[key] === value;
      }
      if (condition.ne) {
        const value = condition.ne.startsWith('$parent.') 
          ? parent[condition.ne.replace('$parent.', '')]
          : condition.ne;
        return item[key] !== value;
      }
      if (condition.isNull) {
        return item[key] === null;
      }
      if (condition.isNotNull) {
        return item[key] !== null;
      }
      return true;
    });
  });
}