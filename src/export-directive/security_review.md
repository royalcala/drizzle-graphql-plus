# Security Review: Drizzle-GraphQL Export Tool

## Overview
This document analyzes the security implications of the `@export` directive implementation, specifically focusing on the `makeScalarAcceptExports` scalar factory and the resolver middleware.

## Findings

### 1. Scope Isolation (Safe)
- **Mechanism**: The `ExportStore` is attached to the GraphQL `context` object.
- **Security Implication**: In standard GraphQL servers (like Yoga, Apollo), a new context is created for every HTTP request.
- **Conclusion**: Exported values are strictly isolated to the **current request**. User A cannot access exported variables from User B. This effectively mitigates cross-user data leakage.

### 2. Injection Attacks (Low Risk)
- **Mechanism**: `makeScalarAcceptExports` allows strings starting with `$_` to bypass scalar validation (e.g. for `Int` or `ULID` types).
- **Risk**: A malicious user could send `$_maliciousString` as an argument.
- **Mitigation**:
    - The middleware attempts to resolve this string against the `ExportStore`.
    - If the variable is NOT found (which it won't be, if the user defines the exports in the same query), the middleware allows the resolution process to wait or fail.
    - **Crucially**, the user defines the export keys in their own query (e.g., `@export(as: "myKey")`). They cannot reference internal server variables unless those variables were explicitly exposed to the `ExportStore` (which is empty by default).
    - If resolution fails, the middleware throws an error, stopping execution before the invalid string reaches the underlying resolver logic (which might expect a number).

### 3. Denial of Service (DoS) - Recursion (Medium Risk)
- **Mechanism**: `utils.ts` recursively traverses arguments (`resolveExportVariables`) and results (`processExports`).
- **Risk**: A user could construct a deeply nested input object or a query that returns deep, recursive results, potentially causing high CPU usage or stack overflow.
- **Mitigation**:
    - **Standard GraphQL Limits**: Most production GraphQL servers implement `maxDepth` and `maxComplexity` limits at the validation phase.
    - **Recommendation**: Ensure your GraphQL server (Yoga/Apollo) has `maxDepth` protection enabled. The export tool adheres to the query structure, so limiting query depth implicitly limits export recursion depth.

### 4. Direct Scalar Bypass (feature-by-design)
- **Mechanism**: The implementation intentionally bypasses `parseValue` for variable patterns.
- **Risk**: If the middleware *fails to run* (e.g. misconfigured server), raw `$_` strings might reach your business logic.
- **Mitigation**: The middleware is mandatory for the feature to work. If configured correctly, it intercepts these values. If the middleware is missing, the `FlexibleULID` scalar will still pass the string, so your resolvers *must* be prepared to handle string inputs if you reuse them outside of the middleware context (though TypeScript types usually prevent this mismatch in code).

## Summary
The export tool is secure for general production use, provided that:
1.  **Standard Security Practices** (Query Depth Limiting, Complexity Analysis) are enforced on the GraphQL server.
2.  The `ExportStore` is **not shared** across requests (default behavior).
3.  The middleware is correctly applied to all relevant resolvers.

**Verdict**: Safe to use.
