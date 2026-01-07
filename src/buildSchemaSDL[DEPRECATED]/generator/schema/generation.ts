import {
    getTableColumns,
    Table,
    is,
    Relations,
    Relation,
    createTableRelationsHelpers,
} from "drizzle-orm";
import type { BaseSQLiteDatabase, SQLiteColumn } from "drizzle-orm/sqlite-core";
import type { TableInfo, TableNamedRelations } from "../types";

export const generateTypes = (
    db: BaseSQLiteDatabase<any, any, any, any>,
    schema: Record<string, unknown>
): {
    tables: Record<string, TableInfo>;
    relations: Record<string, Record<string, TableNamedRelations>>;
} => {
    const tables: Record<string, TableInfo> = {};
    const schemaEntries = Object.entries(schema);

    // Collect all tables from schema
    const tableEntries: [string, Table][] = [];
    for (const [key, value] of schemaEntries) {
        if (value && typeof value === "object" && "getSQL" in value) {
            const table = value as Table;
            // Use the JavaScript variable name (key) for db.query access,
            // not the SQL table name from getTableName
            const tableName = key;
            const columns = getTableColumns(table);

            tables[tableName] = {
                name: tableName,
                table,
                columns: columns as Record<string, SQLiteColumn>,
            };
            tableEntries.push([tableName, table]);
        }
    }

    // Collect relations
    const rawRelations = schemaEntries
        .filter(([key, value]) => is(value, Relations))
        .map<[string, Relations]>(([key, value]) => [
            tableEntries.find(
                ([tableName, tableValue]) => tableValue === (value as Relations).table
            )![0] as string,
            value as Relations,
        ])
        .map<[string, Record<string, Relation>]>(([tableName, relValue]) => [
            tableName,
            relValue.config(createTableRelationsHelpers(tables[tableName]!.table)),
        ]);

    const namedRelations = Object.fromEntries(
        rawRelations.map(([relName, config]) => {
            const namedConfig: Record<string, TableNamedRelations> =
                Object.fromEntries(
                    Object.entries(config).map(([innerRelName, innerRelValue]) => [
                        innerRelName,
                        {
                            relation: innerRelValue,
                            targetTableName: tableEntries.find(
                                ([tableName, tableValue]) =>
                                    tableValue === innerRelValue.referencedTable
                            )![0],
                        },
                    ])
                );

            return [relName, namedConfig];
        })
    );

    return { tables, relations: namedRelations };
};
