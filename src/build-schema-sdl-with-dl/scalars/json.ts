import { GraphQLScalarType, GraphQLError } from 'graphql';
import { Kind } from 'graphql';

export const GraphQLJSON = new GraphQLScalarType({
  name: 'JSON',
  description: 'The `JSON` scalar type represents JSON values as specified by [ECMA-404](http://www.ecma-international.org/publications/files/ECMA-ST/ECMA-404.pdf).',

  serialize(value: any): any {
    return value;
  },

  parseValue(value: any): any {
    return value;
  },

  parseLiteral(ast): any {
    switch (ast.kind) {
      case Kind.STRING:
      case Kind.BOOLEAN:
        return ast.value;
      case Kind.INT:
      case Kind.FLOAT:
        return parseFloat(ast.value);
      case Kind.OBJECT: {
        const value = Object.create(null);
        ast.fields.forEach(field => {
          value[field.name.value] = this.parseLiteral(field.value);
        });
        return value;
      }
      case Kind.LIST:
        return ast.values.map(n => this.parseLiteral(n));
      case Kind.NULL:
        return null;
      default:
        throw new GraphQLError(`Can't parse JSON literal from ${ast.kind}`, { nodes: [ast] });
    }
  },
});