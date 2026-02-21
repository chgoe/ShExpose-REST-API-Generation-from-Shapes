/*

Not supported datatypes:

XSD_BASE64BINARY
XSD_HEXBINARY
XSD_LANGUAGE
XSD_NAME
XSD_NCNAME
XSD_NMTOKEN
XSD_NORMALIZEDSTRING
XSD_TIME
XSD_TOKEN

*/

import { z } from "zod";

const XSD = "http://www.w3.org/2001/XMLSchema#";
const RDF = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";

export interface DatatypeConfig {
    schema: z.ZodType;
    allowsLanguageTag: boolean;
    description: string;
}

/**
 * NOTE: regexes perform weak check only and would allow months > 12, days > 31, etc.
 */

/**
 * XSD gYear pattern (YYYY with optional timezone)
 */
const GYEAR_REGEX = /^-?\d{4,}(Z|[+-]\d{2}:\d{2})?$/;

/**
 * XSD gYearMonth pattern (YYYY-MM with optional timezone)
 */
const GYEARMONTH_REGEX = /^-?\d{4,}-\d{2}(Z|[+-]\d{2}:\d{2})?$/;

const DATATYPE_CONFIGS: Record<string, DatatypeConfig> = {
    // String types => allowed language tags
    [`${XSD}string`]: {
        schema: z.string(),
        allowsLanguageTag: true,
        description: "xsd:string",
    },
    [`${RDF}langString`]: {
        schema: z.string(),
        allowsLanguageTag: true,
        description: "rdf:langString",
    },
    
    // Numeric types (use coerce to accept strings like "42")
    [`${XSD}integer`]: {
        schema: z.coerce.number().int({ message: "Must be an integer" }),
        allowsLanguageTag: false,
        description: "xsd:integer",
    },
    [`${XSD}int`]: {
        schema: z.coerce.number().int().min(-2147483648).max(2147483647),
        allowsLanguageTag: false,
        description: "xsd:int",
    },
    [`${XSD}long`]: {
        schema: z.coerce.number().int().min(-9223372036854775808).max(9223372036854775807),
        allowsLanguageTag: false,
        description: "xsd:long",
    },
    [`${XSD}short`]: {
        schema: z.coerce.number().int().min(-32768).max(32767),
        allowsLanguageTag: false,
        description: "xsd:short",
    },
    [`${XSD}byte`]: {
        schema: z.coerce.number().int().min(-128).max(127),
        allowsLanguageTag: false,
        description: "xsd:byte",
    },
    [`${XSD}nonNegativeInteger`]: {
        schema: z.number().int().min(0),
        allowsLanguageTag: false,
        description: "xsd:nonNegativeInteger",
    },
    [`${XSD}positiveInteger`]: {
        schema: z.number().int().min(1),
        allowsLanguageTag: false,
        description: "xsd:positiveInteger",
    },
    [`${XSD}nonPositiveInteger`]: {
        schema: z.number().int().max(0),
        allowsLanguageTag: false,
        description: "xsd:nonPositiveInteger",
    },
    [`${XSD}negativeInteger`]: {
        schema: z.number().int().max(-1),
        allowsLanguageTag: false,
        description: "xsd:negativeInteger",
    },
    [`${XSD}unsignedInt`]: {
        schema: z.number().int().min(0).max(4294967295),
        allowsLanguageTag: false,
        description: "xsd:unsignedInt",
    },
    [`${XSD}unsignedLong`]: {
        schema: z.number().int().min(0).max(18446744073709551615),
        allowsLanguageTag: false,
        description: "xsd:unsignedLong",
    },
    [`${XSD}unsignedShort`]: {
        schema: z.number().int().min(0).max(65535),
        allowsLanguageTag: false,
        description: "xsd:unsignedShort",
    },
    [`${XSD}unsignedByte`]: {
        schema: z.number().int().min(0).max(255),
        allowsLanguageTag: false,
        description: "xsd:unsignedByte",
    },
    [`${XSD}decimal`]: {
        schema: z.number(),
        allowsLanguageTag: false,
        description: "xsd:decimal",
    },
    [`${XSD}float`]: {
        schema: z.number(),
        allowsLanguageTag: false,
        description: "xsd:float",
    },
    [`${XSD}double`]: {
        schema: z.number(),
        allowsLanguageTag: false,
        description: "xsd:double",
    },
    
    // Date/Time types
    [`${XSD}dateTime`]: {
        schema: z.string().datetime({
            message: "Must be a valid ISO 8601 dateTime (e.g., 2024-01-15T10:30:00Z)",
        }),
        allowsLanguageTag: false,
        description: "xsd:dateTime",
    },
    [`${XSD}date`]: {
        schema: z.string().date({
            message: "Must be a valid ISO 8601 date (e.g., 2024-01-15)",
        }),
        allowsLanguageTag: false,
        description: "xsd:date",
    },
    [`${XSD}time`]: {
        schema: z.string().time({
            message: "Must be a valid ISO 8601 time (e.g., 10:30:00Z)",
        }),
        allowsLanguageTag: false,
        description: "xsd:time",
    },
    [`${XSD}gYear`]: {
        schema: z.string().regex(GYEAR_REGEX, {
            message: "Must be a valid gYear (e.g., 2024)",
        }),
        allowsLanguageTag: false,
        description: "xsd:gYear",
    },
    [`${XSD}gYearMonth`]: {
        schema: z.string().regex(GYEARMONTH_REGEX, {
            message: "Must be a valid gYearMonth (e.g., 2024-01)",
        }),
        allowsLanguageTag: false,
        description: "xsd:gYearMonth",
    },
    [`${XSD}duration`]: {
        schema: z.string().duration({
            message: "Must be a valid ISO 8601 duration (e.g., P1Y2M3DT4H5M6S)",
        }),
        allowsLanguageTag: false,
        description: "xsd:duration",
    },
    
    [`${XSD}boolean`]: {
        schema: z.boolean(),
        allowsLanguageTag: false,
        description: "xsd:boolean",
    },
    
    [`${XSD}anyURI`]: {
        schema: z.string().url({ message: "Must be a valid URI" }),
        allowsLanguageTag: false,
        description: "xsd:anyURI",
    },
};

/**
 * Default configuration for unknown datatypes
 */
const DEFAULT_TYPE_CONFIG: DatatypeConfig = {
    schema: z.union([z.string(), z.number(), z.boolean()]),
    allowsLanguageTag: false,
    description: "value",
};

export function getDatatypeConfig(datatype: string | undefined): DatatypeConfig {
    if (!datatype) return DEFAULT_TYPE_CONFIG;
    return DATATYPE_CONFIGS[datatype] ?? DEFAULT_TYPE_CONFIG;
}

export function allowsLanguageTag(datatype: string | undefined): boolean {
    return getDatatypeConfig(datatype).allowsLanguageTag;
}

export function getDatatypeValueSchema(datatype: string | undefined, isArray: boolean = false): z.ZodType {
    const config = getDatatypeConfig(datatype);
    return isArray ? z.array(config.schema) : config.schema;
}

export function createAttributeBodySchema(datatype: string | undefined): z.ZodType {
    const config = getDatatypeConfig(datatype);
    
    // Allow single value or array of values
    const valueSchema = z.union([config.schema, z.array(config.schema)]);
    
    if (config.allowsLanguageTag) {
        return z.object({
            value: valueSchema,
            language: z.string().optional(),
        });
    } else {
        return z.object({
            value: valueSchema,
        }).strict(); // Reject unknown fields like "language"
    }
}

// get human-readable description for an XSD type (for error messages)
export function getXsdTypeDescription(xsdType: string | undefined): string {
    return getDatatypeConfig(xsdType).description;
}

export const SUPPORTED_XSD_TYPES = Object.keys(DATATYPE_CONFIGS);
