import { describe, it, expect } from "vitest";
import {
  isExportVariable,
  getVariableName,
  hasExportVariables,
  resolveExportVariables,
} from "./utils";
import { ExportStore } from "./ExportStore";

describe("Debug Variable Resolution", () => {
  it("should detect export variables correctly", () => {
    // Test basic detection - both syntaxes
    expect(isExportVariable("$_authorIds")).toBe(true);
    expect(isExportVariable("$_userIds")).toBe(true);
    expect(isExportVariable("EXPORT_VAR:authorIds")).toBe(true);
    expect(isExportVariable("EXPORT_VAR:userIds")).toBe(true);

    expect(isExportVariable("normalString")).toBe(false);
    expect(isExportVariable("$normalVar")).toBe(false);
    expect(isExportVariable("EXPORT_VAR")).toBe(false); // Too short

    // Test variable name extraction
    expect(getVariableName("$_authorIds")).toBe("authorIds");
    expect(getVariableName("$_userIds")).toBe("userIds");
    expect(getVariableName("EXPORT_VAR:authorIds")).toBe("authorIds");
    expect(getVariableName("EXPORT_VAR:userIds")).toBe("userIds");
  });

  it("should detect export variables in complex objects", () => {
    const queryArgs1 = {
      where: {
        id: { in: "$_authorIds" },
      },
    };

    expect(hasExportVariables(queryArgs1)).toBe(true);

    const queryArgs2 = {
      where: {
        id: { in: "EXPORT_VAR:authorIds" },
      },
    };

    expect(hasExportVariables(queryArgs2)).toBe(true);

    const queryArgs3 = {
      where: {
        name: { eq: "Alice" },
      },
    };

    expect(hasExportVariables(queryArgs3)).toBe(false);
  });

  it("should resolve export variables with store", async () => {
    const store = new ExportStore();

    // Pre-populate the store with some values
    store.set("authorIds", ["id1", "id2", "id3"]);
    store.set("userNames", ["Alice", "Bob"]);

    const queryArgs = {
      where: {
        id: { in: "$_authorIds" },
        name: { in: "$_userNames" },
      },
    };

    const resolved = await resolveExportVariables(queryArgs, store);

    expect(resolved).toEqual({
      where: {
        id: { in: ["id1", "id2", "id3"] },
        name: { in: ["Alice", "Bob"] },
      },
    });
  });

  it("should handle the exact GraphQL query structure we use", async () => {
    const store = new ExportStore();
    store.set("authorIds", ["author1", "author2"]);

    // This is exactly what should come from the GraphQL query
    const graphqlArgs = {
      where: {
        id: {
          inArray: "EXPORT_VAR:authorIds",
        },
      },
    };

    console.log("Original args:", JSON.stringify(graphqlArgs, null, 2));
    console.log("Has export variables:", hasExportVariables(graphqlArgs));

    const resolved = await resolveExportVariables(graphqlArgs, store);
    console.log("Resolved args:", JSON.stringify(resolved, null, 2));

    expect(resolved.where.id.inArray).toEqual(["author1", "author2"]);
  });
});
