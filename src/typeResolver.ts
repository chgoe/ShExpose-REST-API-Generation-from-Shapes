import { Schema } from "shexj";
import fs from "node:fs";

export interface FieldTypeInfo {
    // type (e.g., "string", "number", "string[]", shape)
    type: string;
    baseType: string;
    isArray: boolean;
    // whether the type is a reference to another shape
    isReference: boolean;
    // datatype URI
    datatype?: string;
    // only true for xsd:string and rdf:langString
    allowsLanguageTag: boolean;
}

// list of all XSD types that allow language tags
const LANGUAGE_TAG_TYPES = [
    "http://www.w3.org/2001/XMLSchema#string",
    "http://www.w3.org/1999/02/22-rdf-syntax-ns#langString",
];

const PRIMITIVES = ["string", "number", "boolean"];
const LDO_BASE_PATH = "resources/ldo";

/**
 * creates a type resolver for a given ShEx schema
 * reads types directly from the *.typings.ts files
 * 
 * @param schema - The ShEx schema
 */
export function createTypeResolver(schema: Schema) {
    
    // map for parsed typings files: interfaceName -> { propertyName -> type }
    const typingsMap = new Map<string, Map<string, string>>();
    
    /**
     * get the shape class name (e.g., "Testclass") from a shape URI
     */
    function getShapeClassName(shapeUri: string): string | null {
        const shapeDecl = schema.shapes?.find((s: any) => s.id === shapeUri);
        if (!shapeDecl) return null;
        
        const findTypeConstraint = (expr: any): string | null => {
            if (!expr) return null;
            if (expr.type === "TripleConstraint" && 
                expr.predicate === "http://www.w3.org/1999/02/22-rdf-syntax-ns#type") {
                const value = expr.valueExpr?.values?.[0];
                return value.includes("#")
                    ? value.split("#").pop() || null
                    : value.split("/").pop() || null;
            }
            if (expr.expressions) {
                for (const e of expr.expressions) {
                    const result = findTypeConstraint(e);
                    if (result) return result;
                }
            }
            return null;
        };
        
        return findTypeConstraint((shapeDecl as any).shapeExpr?.expression);
    }
    
    /**
     * parse a typings file and save its interface properties
     */
    function parseTypingsFile(className: string): void {
        const baseName = className.replace(/class$/i, "").toLowerCase();
        const typingsPath = `${LDO_BASE_PATH}/${baseName}.typings.ts`;
        
        try {
            const content = fs.readFileSync(typingsPath, "utf-8");
            
            // match all interface definitions
            const interfaceRegex = /export interface (\w+) \{([^}]+)\}/gs;
            let match;
            
            while ((match = interfaceRegex.exec(content)) !== null) {
                const [, interfaceName, body] = match;
                const properties = new Map<string, string>();
                
                // match property definitions: propertyName?: type;
                const propRegex = /["']?(@?\w+)"?\??:\s([^;]+);/g;
                let propMatch;
                
                while ((propMatch = propRegex.exec(body)) !== null) {
                    const [, propName, propType] = propMatch;
                    if (!propName.startsWith("@") && propName !== "type") {
                        properties.set(propName, propType.trim());
                    }
                }
                
                typingsMap.set(interfaceName, properties);
            }
        } catch (e) {
            throw new Error(`Failed to parse typings file at ${typingsPath}: ${e}`);
        }
    }
    
    /**
     * get the type for a field from the typings file
     */
    function getFieldType(className: string, fieldName: string): string | null {
        const interfaceName = className.replace(/class$/i, "");
        
        // Parse typings file if not cached
        if (!typingsMap.has(interfaceName)) {
            parseTypingsFile(className);
        }
        
        const properties = typingsMap.get(interfaceName);
        return properties?.get(fieldName) || null;
    }
    
    /**
     * get the target shape URI for a reference property from the schema
     */
    function getReferencedShapeUri(shapeUri: string, predicateUri: string): string | null {
        const shapeDecl = schema.shapes?.find((s: any) => s.id === shapeUri);
        if (!shapeDecl) return null;
        
        const findPredicate = (expr: any): string | null => {
            if (!expr) return null;
            if (expr.type === "TripleConstraint" && expr.predicate === predicateUri) {
                return typeof expr.valueExpr === "string" ? expr.valueExpr : null;
            }
            if (expr.expressions) {
                for (const e of expr.expressions) {
                    const result = findPredicate(e);
                    if (result) return result;
                }
            }
            return null;
        };
        
        return findPredicate((shapeDecl as any).shapeExpr?.expression);
    }
    
    /**
     * get the datatype for a predicate from the schema
     */
    function getDatatypeForPredicate(shapeUri: string, predicateUri: string): string | null {
        const shapeDecl = schema.shapes?.find((s: any) => s.id === shapeUri);
        if (!shapeDecl) return null;
        
        const findPredicateType = (expr: any): string | null => {
            if (!expr) return null;
            if (expr.type === "TripleConstraint" && expr.predicate === predicateUri) {
                // NodeConstraint with datatype
                if (expr.valueExpr?.datatype) {
                    return expr.valueExpr.datatype;
                }
                // Direct datatype reference (shorthand)
                if (typeof expr.valueExpr === "object" && expr.valueExpr?.type === "NodeConstraint") {
                    return expr.valueExpr.datatype || null;
                }
                return null;
            }
            if (expr.expressions) {
                for (const e of expr.expressions) {
                    const result = findPredicateType(e);
                    if (result) return result;
                }
            }
            return null;
        };
        
        return findPredicateType((shapeDecl as any).shapeExpr?.expression);
    }
    
    function parseTypeString(typeStr: string, datatype?: string): FieldTypeInfo {
        const isArray = typeStr.endsWith("[]");
        const baseType = isArray ? typeStr.slice(0, -2) : typeStr;
        const isReference = !PRIMITIVES.includes(baseType);
        const allowsLanguageTag = datatype ? LANGUAGE_TAG_TYPES.includes(datatype) : false;
        
        return {
            type: typeStr,
            baseType,
            isArray,
            isReference,
            datatype,
            allowsLanguageTag
        };
    }
    
    /**
     * get type info for a property path starting from a shape.
     * traverses through intermediate reference shapes to resolve the final property type.
     * 
     * @param startShapeUri - The URI of the starting shape
     * @param path - Array of predicate URIs forming the path
     * @returns Type info for the final property, or null if path cannot be resolved
     */
    function getTypeInfoForPath(startShapeUri: string, path: string[]): FieldTypeInfo | null {
        let currentShapeUri = startShapeUri;
        let currentClassName = getShapeClassName(currentShapeUri);
        if (!currentClassName) return null;
        
        for (let i = 0; i < path.length; i++) {
            const predicateUri = path[i];
            const propertyName = predicateUri.split("/").pop() || predicateUri;
            
            // get the type directly from the typings file
            const typeStr = getFieldType(currentClassName, propertyName);
            if (!typeStr) return null;
            
            // get datatype from schema for the final property
            const datatype = (i === path.length - 1) 
                ? getDatatypeForPredicate(currentShapeUri, predicateUri) || undefined
                : undefined;
            
            const typeInfo = parseTypeString(typeStr, datatype);
            
            // if this is the last property in the path, return its type info
            if (i === path.length - 1) {
                return typeInfo;
            }
            
            // otherwise, it must be a reference, so we follow it to the next shape
            if (!typeInfo.isReference) {
                return null; // something wrong, reference expected
            }
            
            const nextShapeUri = getReferencedShapeUri(currentShapeUri, predicateUri);
            if (!nextShapeUri) return null; // something wrong, we hit a dead end
            
            currentShapeUri = nextShapeUri;
            currentClassName = getShapeClassName(currentShapeUri);
            if (!currentClassName) return null; // should not be possible ...probably :-)
        }
        
        return null;
    }
    
    return {
        getShapeClassName,
        getReferencedShapeUri,
        getXsdTypeForPredicate: getDatatypeForPredicate,
        getTypeInfoForPath,
        getFieldType
    };
}
