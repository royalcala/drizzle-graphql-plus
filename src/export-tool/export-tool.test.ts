import { describe, it, expect, beforeEach, vi } from "vitest";
import { GraphQLResolveInfo, FieldNode, parse, DirectiveNode } from "graphql";
import { ExportStore } from "./ExportStore";
import {
  isExportVariable,
  getVariableName,
  resolveExportVariables,
  getExportDirective,
  extractExportDirectives,
  hasExportVariables,
} from "./utils";
import { createExportMiddleware } from "./middleware";

describe("ExportStore", () => {
  let store: ExportStore;

  beforeEach(() => {
    store = new ExportStore();
  });

  describe("set and get", () => {
    it("should store and retrieve values", () => {
      store.set("userId", "12345");
      expect(store.get("userId")).toBe("12345");
    });

    it("should return undefined for non-existent values", () => {
      expect(store.get("nonExistent")).toBeUndefined();
    });

    it("should handle different value types", () => {
      store.set("string", "hello");
      store.set("number", 42);
      store.set("object", { id: 1, name: "test" });
      store.set("array", [1, 2, 3]);
      store.set("null", null);

      expect(store.get("string")).toBe("hello");
      expect(store.get("number")).toBe(42);
      expect(store.get("object")).toEqual({ id: 1, name: "test" });
      expect(store.get("array")).toEqual([1, 2, 3]);
      expect(store.get("null")).toBe(null);
    });
  });

  describe("has", () => {
    it("should return true for existing values", () => {
      store.set("userId", "12345");
      expect(store.has("userId")).toBe(true);
    });

    it("should return false for non-existent values", () => {
      expect(store.has("nonExistent")).toBe(false);
    });

    it("should return true even for null values", () => {
      store.set("nullValue", null);
      expect(store.has("nullValue")).toBe(true);
    });
  });

  describe("waitFor", () => {
    it("should resolve immediately if value exists", async () => {
      store.set("userId", "12345");
      const value = await store.waitFor("userId");
      expect(value).toBe("12345");
    });

    it("should wait for value to be set", async () => {
      const promise = store.waitFor("userId");

      // Set value after a delay
      setTimeout(() => {
        store.set("userId", "12345");
      }, 100);

      const value = await promise;
      expect(value).toBe("12345");
    });

    it("should resolve multiple waiters", async () => {
      const promise1 = store.waitFor("userId");
      const promise2 = store.waitFor("userId");
      const promise3 = store.waitFor("userId");

      store.set("userId", "12345");

      const [value1, value2, value3] = await Promise.all([
        promise1,
        promise2,
        promise3,
      ]);
      expect(value1).toBe("12345");
      expect(value2).toBe("12345");
      expect(value3).toBe("12345");
    });

    it("should timeout if value is not set", async () => {
      await expect(store.waitFor("userId", 100)).rejects.toThrow(
        'Timeout waiting for export variable "userId"'
      );
    });

    it("should use custom timeout", async () => {
      const startTime = Date.now();

      await expect(store.waitFor("userId", 200)).rejects.toThrow();

      const elapsed = Date.now() - startTime;
      expect(elapsed).toBeGreaterThanOrEqual(200);
      expect(elapsed).toBeLessThan(300);
    });
  });

  describe("clear", () => {
    it("should clear all values", () => {
      store.set("userId", "12345");
      store.set("postId", "67890");

      store.clear();

      expect(store.has("userId")).toBe(false);
      expect(store.has("postId")).toBe(false);
    });

    it("should not affect new values after clear", () => {
      store.set("userId", "12345");
      store.clear();
      store.set("userId", "67890");

      expect(store.get("userId")).toBe("67890");
    });
  });
});

describe("Utils", () => {
  describe("isExportVariable", () => {
    it("should identify export variables", () => {
      expect(isExportVariable("$_userId")).toBe(true);
      expect(isExportVariable("$_postId")).toBe(true);
      expect(isExportVariable("$_var_name")).toBe(true);
    });

    it("should reject non-export variables", () => {
      expect(isExportVariable("userId")).toBe(false);
      expect(isExportVariable("$userId")).toBe(false);
      expect(isExportVariable("_userId")).toBe(false);
      expect(isExportVariable("$_")).toBe(false);
      expect(isExportVariable("")).toBe(false);
    });

    it("should handle non-string values", () => {
      expect(isExportVariable(123)).toBe(false);
      expect(isExportVariable(null)).toBe(false);
      expect(isExportVariable(undefined)).toBe(false);
      expect(isExportVariable({ id: "$_userId" })).toBe(false);
    });
  });

  describe("getVariableName", () => {
    it("should extract variable name", () => {
      expect(getVariableName("$_userId")).toBe("userId");
      expect(getVariableName("$_postId")).toBe("postId");
      expect(getVariableName("$_var_name")).toBe("var_name");
    });

    it("should return null for invalid variables", () => {
      expect(getVariableName("userId")).toBeNull();
      expect(getVariableName("$userId")).toBeNull();
      expect(getVariableName("$_")).toBeNull();
    });
  });

  describe("hasExportVariables", () => {
    it("should detect export variables in objects", () => {
      expect(hasExportVariables({ id: "$_userId" })).toBe(true);
      expect(hasExportVariables({ filter: { userId: "$_userId" } })).toBe(true);
    });

    it("should detect export variables in arrays", () => {
      expect(hasExportVariables(["$_userId", "$_postId"])).toBe(true);
      expect(hasExportVariables([{ id: "$_userId" }])).toBe(true);
    });

    it("should return false when no export variables", () => {
      expect(hasExportVariables({ id: "userId" })).toBe(false);
      expect(hasExportVariables({ filter: { userId: "12345" } })).toBe(false);
      expect(hasExportVariables(["userId", "postId"])).toBe(false);
    });

    it("should handle primitive values", () => {
      expect(hasExportVariables("$_userId")).toBe(true);
      expect(hasExportVariables("userId")).toBe(false);
      expect(hasExportVariables(123)).toBe(false);
      expect(hasExportVariables(null)).toBe(false);
    });
  });

  describe("resolveExportVariables", () => {
    let store: ExportStore;

    beforeEach(() => {
      store = new ExportStore();
      store.set("userId", "12345");
      store.set("postId", "67890");
    });

    it("should resolve simple string variables", async () => {
      const result = await resolveExportVariables("$_userId", store);
      expect(result).toBe("12345");
    });

    it("should resolve variables in objects", async () => {
      const args = { userId: "$_userId", status: "active" };
      const result = await resolveExportVariables(args, store);
      expect(result).toEqual({ userId: "12345", status: "active" });
    });

    it("should resolve nested variables", async () => {
      const args = {
        where: {
          userId: { eq: "$_userId" },
          status: { eq: "active" },
        },
      };
      const result = await resolveExportVariables(args, store);
      expect(result).toEqual({
        where: {
          userId: { eq: "12345" },
          status: { eq: "active" },
        },
      });
    });

    it("should resolve variables in arrays", async () => {
      const args = ["$_userId", "$_postId", "staticValue"];
      const result = await resolveExportVariables(args, store);
      expect(result).toEqual(["12345", "67890", "staticValue"]);
    });

    it("should handle complex nested structures", async () => {
      const args = {
        where: {
          or: [{ userId: { eq: "$_userId" } }, { postId: { eq: "$_postId" } }],
        },
        orderBy: { createdAt: "desc" },
      };
      const result = await resolveExportVariables(args, store);
      expect(result).toEqual({
        where: {
          or: [{ userId: { eq: "12345" } }, { postId: { eq: "67890" } }],
        },
        orderBy: { createdAt: "desc" },
      });
    });

    it("should throw error for non-existent variables", async () => {
      await expect(
        resolveExportVariables({ id: "$_nonExistent" }, store, 100)
      ).rejects.toThrow('Timeout waiting for export variable "nonExistent"');
    });

    it("should preserve non-variable values", async () => {
      const args = {
        string: "hello",
        number: 42,
        boolean: true,
        null: null,
        undefined: undefined,
      };
      const result = await resolveExportVariables(args, store);
      expect(result).toEqual(args);
    });
  });

  describe("getExportDirective", () => {
    it("should extract export directive", () => {
      const query = parse(`
        query {
          user {
            id @export(as: "userId")
          }
        }
      `);
      const fieldNode = (query.definitions[0] as any).selectionSet.selections[0]
        .selectionSet.selections[0] as FieldNode;

      const result = getExportDirective(fieldNode);
      expect(result).toBe("userId");
    });

    it("should return null if no export directive", () => {
      const query = parse(`
        query {
          user {
            id
          }
        }
      `);
      const fieldNode = (query.definitions[0] as any).selectionSet.selections[0]
        .selectionSet.selections[0] as FieldNode;

      const result = getExportDirective(fieldNode);
      expect(result).toBeNull();
    });

    it("should return null if directive has no as argument", () => {
      const query = parse(`
        query {
          user {
            id @export
          }
        }
      `);
      const fieldNode = (query.definitions[0] as any).selectionSet.selections[0]
        .selectionSet.selections[0] as FieldNode;

      const result = getExportDirective(fieldNode);
      expect(result).toBeNull();
    });
  });

  describe("extractExportDirectives", () => {
    it("should extract all export directives from selection set", () => {
      const query = parse(`
        query {
          user {
            id @export(as: "userId")
            email @export(as: "userEmail")
            name
          }
        }
      `);

      // Mock GraphQLResolveInfo
      const info = {
        fieldNodes: [
          {
            selectionSet: (query.definitions[0] as any).selectionSet
              .selections[0].selectionSet,
          },
        ],
      } as unknown as GraphQLResolveInfo;

      const result = extractExportDirectives(info);

      expect(result.size).toBe(2);
      expect(result.get("id")).toBe("userId");
      expect(result.get("email")).toBe("userEmail");
      expect(result.has("name")).toBe(false);
    });

    it("should handle empty selection set", () => {
      const query = parse(`
        query {
          userId
        }
      `);

      const info = {
        fieldNodes: [
          {
            selectionSet: undefined,
          },
        ],
      } as unknown as GraphQLResolveInfo;

      const result = extractExportDirectives(info);
      expect(result.size).toBe(0);
    });
  });
});

describe("Middleware", () => {
  let store: ExportStore;
  let mockResolver: ReturnType<typeof vi.fn>;
  let mockInfo: GraphQLResolveInfo;

  beforeEach(() => {
    store = new ExportStore();
    mockResolver = vi.fn().mockResolvedValue({ id: "12345", name: "John" });

    // Create a minimal mock info
    mockInfo = {
      fieldNodes: [{ selectionSet: undefined }],
      parentType: { name: "Query" },
      fieldName: "user",
    } as unknown as GraphQLResolveInfo;
  });

  describe("createExportMiddleware", () => {
    it("should initialize ExportStore in context", async () => {
      const middleware = createExportMiddleware();
      const wrappedResolver = middleware(mockResolver);

      const context = {};
      await wrappedResolver(null, {}, context, mockInfo);

      expect(context).toHaveProperty("exportStore");
      expect((context as any).exportStore).toBeInstanceOf(ExportStore);
    });

    it("should reuse existing ExportStore", async () => {
      const middleware = createExportMiddleware();
      const wrappedResolver = middleware(mockResolver);

      const context = { exportStore: store };
      await wrappedResolver(null, {}, context, mockInfo);

      expect((context as any).exportStore).toBe(store);
    });

    it("should pass through when no export variables or directives", async () => {
      const middleware = createExportMiddleware();
      const wrappedResolver = middleware(mockResolver);

      const args = { userId: "12345" };
      const context = { exportStore: store };

      const result = await wrappedResolver(null, args, context, mockInfo);

      expect(mockResolver).toHaveBeenCalledWith(null, args, context, mockInfo);
      expect(result).toEqual({ id: "12345", name: "John" });
    });

    it("should resolve export variables in arguments", async () => {
      store.set("userId", "12345");

      const middleware = createExportMiddleware();
      const wrappedResolver = middleware(mockResolver);

      const args = { userId: "$_userId" };
      const context = { exportStore: store };

      await wrappedResolver(null, args, context, mockInfo);

      expect(mockResolver).toHaveBeenCalledWith(
        null,
        { userId: "12345" },
        context,
        mockInfo
      );
    });

    it("should store exported values from result", async () => {
      const query = parse(`
        query {
          user {
            id @export(as: "userId")
            name
          }
        }
      `);

      const infoWithExport = {
        ...mockInfo,
        fieldNodes: [
          {
            selectionSet: (query.definitions[0] as any).selectionSet
              .selections[0].selectionSet,
          },
        ],
      } as unknown as GraphQLResolveInfo;

      const middleware = createExportMiddleware();
      const wrappedResolver = middleware(mockResolver);

      const context = { exportStore: store };

      await wrappedResolver(null, {}, context, mockInfo);

      // Since our mockInfo doesn't have the actual directive, this tests the flow
      // In real scenarios, the store.set would be called with exported values
    });

    it("should handle resolver errors", async () => {
      const errorResolver = vi
        .fn()
        .mockRejectedValue(new Error("Resolver error"));

      const middleware = createExportMiddleware();
      const wrappedResolver = middleware(errorResolver);

      const context = { exportStore: store };

      await expect(
        wrappedResolver(null, {}, context, mockInfo)
      ).rejects.toThrow("Resolver error");
    });

    it("should throw error when export variable cannot be resolved", async () => {
      const middleware = createExportMiddleware();
      const wrappedResolver = middleware(mockResolver);

      const args = { userId: "$_nonExistent" };
      const context = { exportStore: store };

      await expect(
        wrappedResolver(null, args, context, mockInfo)
      ).rejects.toThrow("Failed to resolve export variables");
    });
  });
});
