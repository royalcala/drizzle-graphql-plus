import { createServer } from 'node:http'
import { 
    GraphQLList, 
    GraphQLNonNull, 
    GraphQLObjectType, 
    GraphQLSchema, 
    GraphQLString,
    GraphQLScalarType,
    Kind 
} from 'graphql'
import { createYoga } from 'graphql-yoga'
import { buildSchema } from 'drizzle-graphql'
import { db } from './database' // Your drizzle instance

// Option 1: Custom JSON Array Scalar
const GraphQLJSONArray = new GraphQLScalarType({
    name: 'JSONArray',
    description: 'JSON Array scalar type',
    serialize(value) {
        // Convert stored JSON string to actual array
        if (typeof value === 'string') {
            try {
                return JSON.parse(value);
            } catch {
                return [];
            }
        }
        return Array.isArray(value) ? value : [];
    },
    parseValue(value) {
        return Array.isArray(value) ? value : [];
    },
    parseLiteral(ast) {
        if (ast.kind === Kind.STRING && 'value' in ast) {
            try {
                return JSON.parse(ast.value);
            } catch {
                return [];
            }
        }
        if (ast.kind === Kind.LIST) {
            return ast.values.map(v => v.kind === Kind.STRING ? v.value : null);
        }
        return [];
    }
});

// Generate the base schema and entities
const { entities } = buildSchema(db)

// Option 2: Custom Table Type with Array Field
const CustomPostType = new GraphQLObjectType({
    name: 'CustomPostItem', // Assuming your table is called 'posts'
    fields: {
        // Copy all existing fields from the generated type
        ...entities.types.PostsItem.getFields(),
        
        // Override the multimediaUrls field
        multimediaUrls: {
            type: new GraphQLList(GraphQLString), // Array of strings
            description: 'Array of multimedia URLs',
            resolve: (parent) => {
                // Parse the JSON string into an array
                if (typeof parent.multimediaUrls === 'string') {
                    try {
                        return JSON.parse(parent.multimediaUrls);
                    } catch {
                        return [];
                    }
                }
                return parent.multimediaUrls || [];
            }
        }
    }
});

// Option 3: Using the JSONArray scalar instead
const CustomPostTypeWithScalar = new GraphQLObjectType({
    name: 'CustomPostItemWithScalar',
    fields: {
        // Copy all existing fields
        ...entities.types.PostsItem.getFields(),
        
        // Override with custom scalar
        multimediaUrls: {
            type: GraphQLJSONArray,
            description: 'Array of multimedia URLs (JSON)',
            resolve: (parent) => parent.multimediaUrls
        }
    }
});

// Custom query that uses your modified type
const customQueries = {
    // Reuse existing queries but with custom types
    posts: {
        type: new GraphQLList(new GraphQLNonNull(CustomPostType)),
        args: entities.queries.posts.args, // Reuse existing args
        resolve: entities.queries.posts.resolve // Reuse existing resolver
    },
    
    postsSingle: {
        type: CustomPostType,
        args: entities.queries.postsSingle.args,
        resolve: entities.queries.postsSingle.resolve
    },
    
    // Or create completely custom queries
    postsWithArrays: {
        type: new GraphQLList(new GraphQLNonNull(CustomPostType)),
        args: {
            where: { type: entities.inputs.PostsFilters }
        },
        resolve: async (source, args, context, info) => {
            // Your custom logic here
            const result = await db.query.posts.findMany({
                where: args.where ? /* convert filters */ : undefined
            });
            
            // The resolve function in CustomPostType will handle the JSON parsing
            return result;
        }
    }
};

// Build your custom schema
const customSchema = new GraphQLSchema({
    query: new GraphQLObjectType({
        name: 'Query',
        fields: {
            // Use your custom queries
            ...customQueries,
            
            // Keep other generated queries as-is
            users: entities.queries.users,
            // ... other queries you want to keep
        }
    }),
    
    mutation: new GraphQLObjectType({
        name: 'Mutation',
        fields: {
            // You can customize mutations too
            ...entities.mutations,
            
            // Custom mutation that handles JSON arrays
            createPostWithArrays: {
                type: CustomPostType,
                args: {
                    // Custom input that accepts arrays
                    data: {
                        type: new GraphQLNonNull(new GraphQLInputObjectType({
                            name: 'CreatePostInput',
                            fields: {
                                // Copy fields from generated input
                                ...entities.inputs.PostsInsertInput.getFields(),
                                
                                // Override multimediaUrls to accept array
                                multimediaUrls: {
                                    type: new GraphQLList(GraphQLString),
                                    description: 'Array of multimedia URLs'
                                }
                            }
                        }))
                    }
                },
                resolve: async (source, args, context, info) => {
                    // Convert array back to JSON string for database
                    const dataToInsert = {
                        ...args.data,
                        multimediaUrls: JSON.stringify(args.data.multimediaUrls || [])
                    };
                    
                    const result = await db.insert(schema.posts).values(dataToInsert).returning();
                    return result[0];
                }
            }
        }
    }),
    
    // Include all types
    types: [
        ...Object.values(entities.types),
        ...Object.values(entities.inputs),
        CustomPostType,
        GraphQLJSONArray
    ]
});

// Create your server
const yoga = createYoga({ schema: customSchema })
const server = createServer(yoga)

server.listen(4000, () => {
    console.info('Server is running on http://localhost:4000/graphql')
})

export { customSchema };
