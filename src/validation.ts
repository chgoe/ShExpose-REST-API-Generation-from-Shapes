// TODO: review and test
// HTTP status codes currently also not correct, e.g. 200 instead of 201 on creation

import { z } from "zod";
import {
    OpenAPIRegistry,
    OpenApiGeneratorV3,
    extendZodWithOpenApi,
} from "@asteasolutions/zod-to-openapi";
import { Express, Request, Response, NextFunction } from "express";
import { Schema } from "shexj";
import { createTypeResolver, FieldTypeInfo } from "./typeResolver.js";
import { createAttributeBodySchema, allowsLanguageTag, getXsdTypeDescription, getDatatypeValueSchema } from "./xsdValidation.js";

extendZodWithOpenApi(z);

// OpenAPI registry for collecting all schemas and paths
const registry = new OpenAPIRegistry();

// Map to store generated Zod schemas per shape attribute
export const zodSchemas = new Map<string, z.ZodType>();

// Type for shape attributes with type information
export interface ShapeAttrInfo {
    path: string[];
    typeInfo?: FieldTypeInfo;
}

export type ShapeAttrsWithTypes = { [key: string]: ShapeAttrInfo };

/**
 * Convert a FieldTypeInfo to a Zod schema
 */
function fieldTypeToZodSchema(typeInfo: FieldTypeInfo): z.ZodType {
    let baseSchema: z.ZodType;

    switch (typeInfo.baseType) {
        case "string":
            baseSchema = z.string();
            break;
        case "number":
            baseSchema = z.number();
            break;
        case "boolean":
            baseSchema = z.boolean();
            break;
        default:
            baseSchema = z.string();
            break;
    }

    if (typeInfo.isArray) {
        return z.array(baseSchema);
    }

    return baseSchema;
}

/**
 * Schema for error response
 */
const ErrorResponseSchema = z.object({
    error: z.string(),
    message: z.string().optional(),
}).openapi("ErrorResponse");

/**
 * Schema for URI parameter (actualyl URL)
 */
const UriParamSchema = z.string()
    .min(1, "URI parameter is required")
    .refine(
        (val) => {
            try {
                new URL(val);
                return true;
            } catch {
                return false;
            }
        },
        { message: "Invalid URI format" }
    )
    .openapi({ description: "The URI of the RDF resource (URL-encoded)" });

/**
 * Base schema for attribute value updates (PUT/POST on /:uri/:attribute)
 * Allows:
 * - {"value": ..., "language": ...}
 * - {"value": [...], "language": ...}
 * - {"value": ...}
 * - {"value": [...]}
 */
const AttributeUpdateValueSchema = z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.array(z.union([z.string(), z.number(), z.boolean()]))
]);

/**
 * Create a dynamic Zod schema for validating shape-level updates (PUT/POST on /:uri/)
 *  => only allow attributes that are valid keys in shapeAttrs
 *  => validate values according to their XSD types
 */
export function createShapeUpdateBodySchema(
    shapeAttrs: ShapeAttrsWithTypes,
    typeResolver: ReturnType<typeof createTypeResolver>,
    schema: Schema
): z.ZodType {
    const startShapeUri = schema.start as string;

    const validAttrNames = new Map<string, { path: string[]; datatype?: string }>();
    
    for (const attrKey of Object.keys(shapeAttrs)) {
        const attrPathEnding = attrKey.split(/[\/#]/).slice(-1)[0];
        const attrPath = shapeAttrs[attrKey].path;
        const typeInfo = typeResolver.getTypeInfoForPath(startShapeUri, attrPath);
        
        validAttrNames.set(attrPathEnding, { path: attrPath, datatype: typeInfo?.datatype });
    }

    // Use a permissive base schema, then validate in superRefine
    const baseValueSchema = z.object({
        value: z.union([z.string(), z.number(), z.boolean(), z.array(z.union([z.string(), z.number(), z.boolean()]))]),
        language: z.string().optional(),
    });

    return z.record(z.string(), baseValueSchema).superRefine((data, ctx) => {
        if (Object.keys(data).length === 0) {
            // Empty body is not allowed
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: `At least one of the following attributes must be provided: ${Array.from(validAttrNames.keys()).join(", ")}`,
            });
        }
        for (const [key, value] of Object.entries(data)) {
            // Check if the attribute key is valid
            if (!validAttrNames.has(key)) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    message: `Invalid attribute '${key}'. Must be one of: ${Array.from(validAttrNames.keys()).join(", ")}`,
                    path: [key],
                });
                continue;
            }

            const attrInfo = validAttrNames.get(key)!;
            const datatype = attrInfo.datatype;
            const allowsLang = allowsLanguageTag(datatype);
            
            // Check if language is only set for attributes that allow it
            if (value.language !== undefined && !allowsLang) {
                const typeDesc = getXsdTypeDescription(datatype);
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    message: `Language tag not allowed for ${typeDesc} attribute '${key}'`,
                    path: [key, "language"],
                });
            }
            
            // Validate the value against its XSD type schema
            const valueSchema = getDatatypeValueSchema(datatype, Array.isArray(value.value));
            const valueResult = valueSchema.safeParse(value.value);
            if (!valueResult.success) {
                for (const issue of valueResult.error.issues) {
                    ctx.addIssue({
                        code: z.ZodIssueCode.custom,
                        message: issue.message,
                        path: [key, "value", ...issue.path],
                    });
                }
            }
        }
    });
}

/**
 * Validation middleware factory for URI parameter
 */
export function validateUriParam(req: Request, res: Response, next: NextFunction): void {
    const result = UriParamSchema.safeParse(decodeURIComponent(req.params.uri));
    
    if (!result.success) {
        res.status(400).json({
            error: "Invalid URI parameter",
            message: result.error.issues.map((e: z.ZodIssue) => e.message).join(", "),
        });
        return;
    }
    
    next();
}

/**
 * Creates a validation middleware for attribute-level updates (PUT/POST on /:uri/:attribute)
 * that validates based on the attribute's XSD type:
 * - For xsd:string and rdf:langString: allows "language" field
 * - For xsd:integer: validates as integer
 * - For xsd:dateTime: validates against ISO 8601 format
 * - etc. => see xsdValidation.ts
 */
export function createAttributeUpdateBodyValidator(
    attrPath: string[],
    schema: Schema
): (req: Request, res: Response, next: NextFunction) => void {
    const typeResolver = createTypeResolver(schema);
    const startShapeUri = schema.start as string;
    const typeInfo = typeResolver.getTypeInfoForPath(startShapeUri, attrPath);
    const datatype = typeInfo?.datatype;
    
    // Create schema based on XSD type (handles language tags, value validation, etc.)
    const validationSchema = createAttributeBodySchema(datatype);
    const typeDescription = getXsdTypeDescription(datatype);
    const allowsLang = allowsLanguageTag(datatype);
    
    return (req: Request, res: Response, next: NextFunction): void => {
        const result = validationSchema.safeParse(req.body);
        
        if (!result.success) {
            // Customize error messages
            const issues = result.error.issues.map((e: z.ZodIssue) => {
                if (e.code === 'unrecognized_keys' && (e as any).keys?.includes('language')) {
                    return `Language tag not allowed for ${typeDescription} attribute`;
                }
                // Include path info for nested errors
                const path = e.path.length > 0 ? ` at ${e.path.join('.')}` : '';
                return `${e.message}${path}`;
            });
            
            res.status(400).json({
                error: "Invalid request body",
                message: issues.join(", "),
            });
            return;
        }
        
        next();
    };
}

/**
 * Creates a validation middleware for shape-level updates (PUT/POST on /:uri/)
 * Validates that all attribute keys in the body are valid shapeAttrs keys
 * and that language tags are only used for string-type attributes
 */
export function createShapeUpdateBodyValidator(
    shapeAttrs: ShapeAttrsWithTypes,
    schema: Schema
): (req: Request, res: Response, next: NextFunction) => void {
    const typeResolver = createTypeResolver(schema);
    const validationSchema = createShapeUpdateBodySchema(shapeAttrs, typeResolver, schema);
    
    return (req: Request, res: Response, next: NextFunction): void => {
        const result = validationSchema.safeParse(req.body);
        
        if (!result.success) {
            res.status(400).json({
                error: "Invalid request body",
                message: result.error.issues.map((e: z.ZodIssue) => e.message).join(", "),
            });
            return;
        }
        
        next();
    };
}

export function registerOpenApiPaths(
    shapeLabel: string,
    shapeAttrs: { [index: string]: { path: string[] } },
    schema: Schema
): void {
    const typeResolver = createTypeResolver(schema);

    registry.registerPath({
        method: "get",
        path: `/${shapeLabel}/{uri}`,
        summary: `Get full ${shapeLabel} resource`,
        description: `Retrieve all attributes of a ${shapeLabel} by its URI`,
        tags: [shapeLabel],
        request: {
            params: z.object({
                uri: UriParamSchema,
            }),
        },
        responses: {
            200: {
                description: `The ${shapeLabel} resource`,
                content: {
                    "application/json": {
                        schema: z.object({}).passthrough(),
                    },
                },
            },
            400: {
                description: "Invalid URI parameter",
                content: {
                    "application/json": {
                        schema: ErrorResponseSchema,
                    },
                },
            },
            404: {
                description: "Resource not found",
                content: {
                    "application/json": {
                        schema: ErrorResponseSchema,
                    },
                },
            },
        },
    });

    // Build shape-level request body schema based on valid attributes
    const startShapeUri = schema.start as string;
    const shapeUpdateProperties: Record<string, z.ZodType> = {};
    
    for (const attrKey of Object.keys(shapeAttrs)) {
        const attrPathEnding = attrKey.split(/[\/#]/).slice(-1)[0];
        const attrPath = shapeAttrs[attrKey].path;
        const typeInfo = typeResolver.getTypeInfoForPath(startShapeUri, attrPath);
        const allowsLanguageTag = typeInfo?.allowsLanguageTag ?? false;
        
        if (allowsLanguageTag) {
            shapeUpdateProperties[attrPathEnding] = z.object({
                value: z.union([z.string(), z.array(z.string())]),
                language: z.string().optional(),
            }).optional();
        } else {
            const baseSchema = typeInfo ? fieldTypeToZodSchema({ ...typeInfo, isArray: false }) : z.string();
            shapeUpdateProperties[attrPathEnding] = z.object({
                value: z.union([baseSchema, z.array(baseSchema)]),
            }).optional();
        }
    }
    
    const ShapeUpdateRequestBodySchema = z.object(shapeUpdateProperties).strict();
    //console.log(ShapeUpdateRequestBodySchema.toJSONSchema());

    registry.registerPath({
        method: "post",
        path: `/${shapeLabel}`,
        summary: `Create new ${shapeLabel}`,
        description: `Create a new ${shapeLabel} instance. Allowed attributes: ${Object.keys(shapeAttrs).map(k => k.split(/[\/#]/).slice(-1)[0]).join(", ")}`,
        tags: [shapeLabel],
        request: {
            body: {
                content: {
                    "application/json": {
                        schema: ShapeUpdateRequestBodySchema,
                    },
                },
            },
        },
        responses: {
            201: {
                description: `Created ${shapeLabel} resource`,
                content: {
                    "application/json": {
                        schema: z.object({}).passthrough(),
                    },
                },
            },
            400: {
                description: "Invalid request body",
                content: {
                    "application/json": {
                        schema: ErrorResponseSchema,
                    },
                },
            },
        },
    });
    
    // PUT on shape level (update multiple attributes)
    registry.registerPath({
        method: "put",
        path: `/${shapeLabel}/{uri}`,
        summary: `Update ${shapeLabel} attributes`,
        description: `Update multiple attributes of a ${shapeLabel}. Allowed attributes: ${Object.keys(shapeAttrs).map(k => k.split(/[\/#]/).slice(-1)[0]).join(", ")}`,
        tags: [shapeLabel],
        request: {
            params: z.object({
                uri: UriParamSchema,
            }),
            body: {
                content: {
                    "application/json": {
                        schema: ShapeUpdateRequestBodySchema,
                    },
                },
            },
        },
        responses: {
            200: {
                description: `Updated ${shapeLabel} resource`,
                content: {
                    "application/json": {
                        schema: z.object({}).passthrough(),
                    },
                },
            },
            400: {
                description: "Invalid request body",
                content: {
                    "application/json": {
                        schema: ErrorResponseSchema,
                    },
                },
            },
            404: {
                description: "Resource not found",
                content: {
                    "application/json": {
                        schema: ErrorResponseSchema,
                    },
                },
            },
        },
    });

    // Register endpoints for each attribute
    for (const attrKey of Object.keys(shapeAttrs)) {
        const attrPathEnding = attrKey.split(/[\/#]/).slice(-1)[0];
        const attrPath = shapeAttrs[attrKey].path;

        // Try to get type info from the schema
        const startShapeUri = schema.start as string;
        const typeInfo = typeResolver.getTypeInfoForPath(startShapeUri, attrPath);

        const allowsLanguageTag = typeInfo?.allowsLanguageTag ?? false;
        
        // Create appropriate response schema based on type info
        let valueSchema: z.ZodType;
        let requestBodySchema: z.ZodType;
        
        if (typeInfo) {
            const baseValueSchema = fieldTypeToZodSchema(typeInfo);
            // Response schema always includes optional language
            valueSchema = z.object({
                value: baseValueSchema,
                language: z.string().optional(),
            });
            
            if (allowsLanguageTag) {
                requestBodySchema = z.object({
                    value: z.union([baseValueSchema, z.array(z.string())]),
                    language: z.string().optional(),
                });
            } else {
                requestBodySchema = z.object({
                    value: z.union([baseValueSchema, z.array(fieldTypeToZodSchema({ ...typeInfo, isArray: false }))]),
                });
            }
        } else {
            // Fallback to string if type info is not available (allows language)
            valueSchema = z.object({
                value: z.union([z.string(), z.array(z.string())]),
                language: z.string().optional(),
            });
            requestBodySchema = z.object({
                value: z.union([z.string(), z.array(z.string())]),
                language: z.string().optional(),
            });
        }

        // Store the schema for potential reuse
        const schemaKey = `${shapeLabel}_${attrPathEnding}`;
        zodSchemas.set(schemaKey, valueSchema);

        // GET endpoint
        registry.registerPath({
            method: "get",
            path: `/${shapeLabel}/{uri}/${attrPathEnding}`,
            summary: `Get ${attrPathEnding} of ${shapeLabel}`,
            description: `Retrieve the ${attrPathEnding} attribute of a ${shapeLabel}`,
            tags: [shapeLabel],
            request: {
                params: z.object({
                    uri: UriParamSchema,
                }),
            },
            responses: {
                200: {
                    description: `The ${attrPathEnding} value`,
                    content: {
                        "application/json": {
                            schema: valueSchema,
                        },
                    },
                },
                400: {
                    description: "Invalid URI parameter",
                    content: {
                        "application/json": {
                            schema: ErrorResponseSchema,
                        },
                    },
                },
                404: {
                    description: "Resource or attribute not found",
                    content: {
                        "application/json": {
                            schema: ErrorResponseSchema,
                        },
                    },
                },
            },
        });

        // PUT endpoint
        registry.registerPath({
            method: "put",
            path: `/${shapeLabel}/{uri}/${attrPathEnding}`,
            summary: `Update ${attrPathEnding} of ${shapeLabel}`,
            description: `Update the ${attrPathEnding} attribute of a ${shapeLabel}`,
            tags: [shapeLabel],
            request: {
                params: z.object({
                    uri: UriParamSchema,
                }),
                body: {
                    content: {
                        "application/json": {
                            schema: requestBodySchema,
                        },
                    },
                },
            },
            responses: {
                200: {
                    description: "Successfully updated",
                    content: {
                        "application/json": {
                            schema: valueSchema,
                        },
                    },
                },
                400: {
                    description: "Invalid request",
                    content: {
                        "application/json": {
                            schema: ErrorResponseSchema,
                        },
                    },
                },
                404: {
                    description: "Resource not found",
                    content: {
                        "application/json": {
                            schema: ErrorResponseSchema,
                        },
                    },
                },
            },
        });

        // POST endpoint for attribute
        registry.registerPath({
            method: "post",
            path: `/${shapeLabel}/{uri}/${attrPathEnding}`,
            summary: `Add ${attrPathEnding} to ${shapeLabel}`,
            description: `Add a new value to the ${attrPathEnding} attribute of a ${shapeLabel}`,
            tags: [shapeLabel],
            request: {
                params: z.object({
                    uri: UriParamSchema,
                }),
                body: {
                    content: {
                        "application/json": {
                            schema: requestBodySchema,
                        },
                    },
                },
            },
            responses: {
                200: {
                    description: "Successfully added",
                    content: {
                        "application/json": {
                            schema: valueSchema,
                        },
                    },
                },
                400: {
                    description: "Invalid request",
                    content: {
                        "application/json": {
                            schema: ErrorResponseSchema,
                        },
                    },
                },
                404: {
                    description: "Resource not found",
                    content: {
                        "application/json": {
                            schema: ErrorResponseSchema,
                        },
                    },
                },
            },
        });

        // DELETE endpoint
        registry.registerPath({
            method: "delete",
            path: `/${shapeLabel}/{uri}/${attrPathEnding}`,
            summary: `Delete ${attrPathEnding} from ${shapeLabel}`,
            description: `Remove the ${attrPathEnding} attribute from a ${shapeLabel}`,
            tags: [shapeLabel],
            request: {
                params: z.object({
                    uri: UriParamSchema,
                }),
            },
            responses: {
                200: {
                    description: "Successfully deleted",
                    content: {
                        "application/json": {
                            schema: z.object({ success: z.boolean() }),
                        },
                    },
                },
                400: {
                    description: "Invalid URI parameter",
                    content: {
                        "application/json": {
                            schema: ErrorResponseSchema,
                        },
                    },
                },
                404: {
                    description: "Resource not found",
                    content: {
                        "application/json": {
                            schema: ErrorResponseSchema,
                        },
                    },
                },
            },
        });
    }
}

function generateOpenApiDocument(): object {
    const generator = new OpenApiGeneratorV3(registry.definitions);

    return generator.generateDocument({
        openapi: "3.0.0",
        info: {
            title: "ShExpose API",
            version: "1.0.0",
            description: "REST API endpoints dynamically generated from ShEx (Shape Expressions) schemas",
        },
        servers: [
            {
                url: "http://localhost:3000",
                description: "Development server",
            },
        ],
    });
}

export function setupOpenApiEndpoint(app: Express): void {
    app.get("/openapi.json", (_req: Request, res: Response) => {
        res.json(generateOpenApiDocument());
    });

    // Also provide a simple HTML page that redirects to Swagger UI
    app.get("/docs", (_req: Request, res: Response) => {
        res.send(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>ShExpose API Documentation</title>
                <link rel="stylesheet" type="text/css" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css">
            </head>
            <body>
                <div id="swagger-ui"></div>
                <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
                <script>
                    window.onload = function() {
                        SwaggerUIBundle({
                            url: "/openapi.json",
                            dom_id: '#swagger-ui',
                        });
                    }
                </script>
            </body>
            </html>
        `);
    });

    console.log("OpenAPI documentation available at /openapi.json and /docs");
}
