import { envelop, useEngine, useSchema } from '@envelop/core';
import { execute as graphqlExecute, subscribe, parse } from 'graphql';
import { useDataLoaderCleanup } from '../generator/utils/envelop-plugin';
import { createStandardSchema } from './shared-config';
import type { AnyDrizzleDB } from '../../types';

/**
 * Creates a shared envelop configuration that can be used by both
 * the server and tests. This ensures consistency between test and production environments.
 */
export function createSharedEnvelop(db: AnyDrizzleDB<any>) {
  const { schema: graphqlSchema } = createStandardSchema(db);

  return envelop({
    plugins: [
      useEngine({ execute: graphqlExecute, subscribe, parse }),
      useSchema(graphqlSchema),
      // Use the same DataLoader plugin as the server
      useDataLoaderCleanup({ db }),
    ],
  });
}

/**
 * Helper function to execute GraphQL queries using the shared envelop configuration.
 * This replaces the manual executeQuery functions in tests.
 */
export async function executeGraphQLQuery(
  getEnveloped: ReturnType<typeof envelop>,
  query: string,
  variables?: Record<string, any>,
  contextValue?: any
) {
  const { execute, parse, contextFactory, schema } = getEnveloped();
  
  const result = await execute({
    schema,
    document: parse(query),
    variableValues: variables,
    contextValue: await contextFactory(contextValue || {}),
  });

  if (result.errors) {
    throw new Error(result.errors[0].message);
  }
  
  return result.data;
}