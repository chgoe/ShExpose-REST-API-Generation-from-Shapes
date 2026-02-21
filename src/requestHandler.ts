import fs from "node:fs/promises";
import path from "node:path";
import { Request } from "express";
import { createLdoDataset, languagesOf, parseRdf, setLanguagePreferences, startTransaction, toSparqlUpdate } from "@ldo/ldo";
import { getShexFileForPath } from "./slotMapping";
import config from "./config.js";
import { flattenLdoContext } from "./utils.js";
import { v4 as uuidv4 } from 'uuid';
import { TurtleMerger } from "./turtleMerger.js";


/*
    Note: 
    - prefLanguage must be lowercase, e.g. "de-de" rather than "de-DE"
    - if strings without language tags are desired, use "@none"
*/

// preferred fallback languages in order of preference
// TODO: make this configurable
const FALLBACK_LANGUAGES = ["@none", "de", "de-de", "en", "en-us"];

enum SparqlReadOrUpdate {
    READ = "READ",
    UPDATE = "UPDATE"
}

export class SparqlError extends Error {
    statusCode: number;
    
    constructor(message: string, statusCode: number) {
        super(message);
        this.name = "SparqlError";
        this.statusCode = statusCode;
    }
}

type HandlerResponse = {
    status: number;
    body?: any;
};

type ResponseOptions = {
    isEmpty?: boolean;
    notFoundMessage?: string;
    successStatus: number;
    successBody?: object;
    operation: () => Promise<void>;
};

type ReadResponseOptions = {
    notFoundMessage?: string;
    operation: () => Promise<{ isEmpty: boolean; body: any }>;
};

function getNotFoundResponse(message: string): HandlerResponse {
    return {
        status: 404,
        body: {
            error: "Not found",
            message
        }
    };
}

function getSparqlFailureResponse(statusCode: number): HandlerResponse {
    return {
        status: statusCode,
        body: { error: "SPARQL execution failed" }
    };
}

function getInternalErrorResponse(): HandlerResponse {
    return {
        status: 500,
        body: { error: "Internal server error" }
    };
}

async function createModifyHandlerResponse({
    isEmpty = false,
    notFoundMessage = "Resource not found",
    successStatus,
    successBody,
    operation
}: ResponseOptions): Promise<HandlerResponse> {
    if (isEmpty) {
        return getNotFoundResponse(notFoundMessage);
    }

    try {
        await operation();
        return successBody
            ? { status: successStatus, body: successBody }
            : { status: successStatus };
    } catch (err) {
        if (err instanceof SparqlError) {
            return getSparqlFailureResponse(err.statusCode);
        }
        console.log(err);
        return getInternalErrorResponse();
    }
}

async function createReadHandlerResponse({
    notFoundMessage = "Resource not found",
    operation
}: ReadResponseOptions): Promise<HandlerResponse> {
    try {
        const { isEmpty, body } = await operation();
        if (isEmpty) {
            return getNotFoundResponse(notFoundMessage);
        }
        return { status: 200, body };
    } catch (err) {
        if (err instanceof SparqlError) {
            return getSparqlFailureResponse(err.statusCode);
        }
        console.log(err);
        return getInternalErrorResponse();
    }
}

async function getDatasetForShape(shapeName: string, uri: string, shapeAttrs: {[index: string]: {[index: string]: Array<string>}}): Promise<[boolean, any]> {
    // @ts-ignore: CommonJS module without type definitions
    const shex2sparqlModule = await import("../submodules/shex2sparql/src/neoshex2sparql/shex2sparql.js");
    const shex2sparql = shex2sparqlModule.default as (shexFilePath: string, queryForm: string, uri?: string) => string;

    const turtleMerger = new TurtleMerger();
    let visitedFiles: Set<string> = new Set();
    
    for (const attributeName in shapeAttrs) {
        const shexFragmentFileName = getShexFileForPath(shapeName, attributeName);
        if (!shexFragmentFileName) {
            throw new Error(`No .shex file found for attribute "${attributeName}" in entity "${shapeName}"`);
        }
        if (visitedFiles.has(shexFragmentFileName)) {
            continue;
        }
        //console.log(shexFragmentFileName)
        const shexFragmentFilePath = path.join(process.cwd(), "resources", "shapes", shapeName, shexFragmentFileName);
        const sparqlQuery = shex2sparql(shexFragmentFilePath, "CONSTRUCT", uri);
        const result = await executeSparql(sparqlQuery, SparqlReadOrUpdate.READ);
        if (result) {
            turtleMerger.addTurtle(result);
        }
        visitedFiles.add(shexFragmentFileName);
    }
    
    const mergedTurtle = turtleMerger.getMergedTurtle();
    const isEmpty = turtleMerger.isEmpty();
    const ldoDataset = await parseRdf(mergedTurtle, {});
    
    const shapeTypeModule = await import(`../resources/ldo/${shapeName}.shapeTypes.js`) as any;
    const ShapeType = shapeTypeModule[`${shapeName.charAt(0).toUpperCase() + shapeName.slice(1)}ShapeType`];

    const FlatShapeType = {
        ...ShapeType,
        context: flattenLdoContext(ShapeType.context)
    };

    const shapeProfile = ldoDataset
        .usingType(FlatShapeType)
        .fromSubject(uri);
    
    return [isEmpty, shapeProfile];
}

async function getDatasetForFragmentShape(shapeName: string, uri: string, attributeName: string): Promise<[boolean, any]> {
    const shexFragmentFileName = getShexFileForPath(shapeName, attributeName);
    
    if (!shexFragmentFileName) {
        throw new Error(`No .shex file found for attribute "${attributeName}" in entity "${shapeName}"`);
    }
    
    const shexFragmentFilePath = path.join(process.cwd(), "resources", "shapes", shapeName, shexFragmentFileName);
    //console.log(`Using smaller ShEx file: ${shexFragmentFilePath}`);
    
    try {
        await fs.access(shexFragmentFilePath);
    } catch (err) {
        throw new Error(`ShEx file not found: ${shexFragmentFilePath}`);
    }

    // @ts-ignore: CommonJS module without type definitions
    const shex2sparqlModule = await import("../submodules/shex2sparql/src/neoshex2sparql/shex2sparql.js");
    const shex2sparql = shex2sparqlModule.default as (shexFilePath: string, queryForm: string, uri?: string) => string;

    const sparqlQuery = shex2sparql(shexFragmentFilePath, "CONSTRUCT", uri);
    //console.log("Generated SPARQL query:", sparqlQuery);

    const turtleMerger = new TurtleMerger();
    const result = await executeSparql(sparqlQuery, SparqlReadOrUpdate.READ);
    turtleMerger.addTurtle(result);
    const isEmpty = turtleMerger.isEmpty();
    const ldoDataset = await parseRdf(result, {});

    const shapeTypeModule = await import(`../resources/ldo/${shapeName}.shapeTypes.js`) as any;
    const ShapeType = shapeTypeModule[`${shapeName.charAt(0).toUpperCase() + shapeName.slice(1)}ShapeType`];

    const FlatShapeType = {
        ...ShapeType,
        context: flattenLdoContext(ShapeType.context)
    };
    
    const shapeProfile = ldoDataset
        .usingType(FlatShapeType)
        .fromSubject(uri);

    return [isEmpty, shapeProfile];
}

async function getEmptyShape(shapeName: string) {
    const uri = config.data.base_uri + shapeName.toLowerCase() + "-" + uuidv4();

    const ldoDataset = createLdoDataset();
    const shapeTypeModule = await import(`../resources/ldo/${shapeName}.shapeTypes.js`) as any;
    const ShapeType = shapeTypeModule[`${shapeName.charAt(0).toUpperCase() + shapeName.slice(1)}ShapeType`];
    
    // flatten the context, otherwise datatypes will be disregarded by ldo
    const FlatShapeType = {
        ...ShapeType,
        context: flattenLdoContext(ShapeType.context)
    };
    
    const shapeProfile = ldoDataset
            .usingType(FlatShapeType)
            .fromSubject(uri);

    return shapeProfile;
}

async function _executeOnEndpoint(sparqlQuery: string, readOrUpdate: SparqlReadOrUpdate): Promise<string> {
    const headers: HeadersInit = {};

    if (config.rdf.auth?.username && config.rdf.auth?.password) {
        const credentials = Buffer.from(
            `${config.rdf.auth.username}:${config.rdf.auth.password}`
        ).toString('base64');
        headers['Authorization'] = `Basic ${credentials}`;
    }

    const body = new FormData();

    if (readOrUpdate === SparqlReadOrUpdate.READ) {
        headers["Accept"] = "text/turtle";
        headers["Content-Type"] = "application/sparql-query";
        body.set("query", sparqlQuery);
    } else {
        headers["Content-Type"] = "application/sparql-update";
        body.set("update", sparqlQuery);

        if (config.rdf.qlever_token) {
            headers["Authorization"] = `Bearer ${config.rdf.qlever_token}`;
        }
    }

    const response = await fetch(config.rdf.sparql_endpoint!, {
        method: "POST",
        headers,
        body: sparqlQuery
    });

    if (!response.ok) {
        console.log("Response NOT ok! Response:", response);
        throw new SparqlError(
            `SPARQL endpoint returned status ${response.status}, Query: ${sparqlQuery}`,
            response.status
        );
    }
    //console.log(`SPARQL ${readOrUpdate} query executed successfully on endpoint.`,sparqlQuery);

    if (readOrUpdate === SparqlReadOrUpdate.READ) {
        return await response.text();
    }
    return "";
}

async function executeSparql(sparqlQuery: string, readOrUpdate: SparqlReadOrUpdate): Promise<string> {
    if (config.rdf.qlever_token) {
        // as of version 0.5.41, QLever automatically transforms xsd:integer to xsd:int,
        // which breaks queries...
        sparqlQuery = sparqlQuery.replaceAll("<http://www.w3.org/2001/XMLSchema#integer>", "<http://www.w3.org/2001/XMLSchema#int>")
    }
    if (config.debug?.do_sparql_update === false && readOrUpdate === SparqlReadOrUpdate.UPDATE) {
        console.log("Debug mode: Skipping SPARQL UPDATE execution:", sparqlQuery);
        return "";
    }
    let responseText = "";
    try {
        // check if SPARQL endpoint is configured
        if (config.rdf.sparql_endpoint && (config.rdf.sparql_endpoint.startsWith('http://') || config.rdf.sparql_endpoint.startsWith('https://'))) {
            responseText = await _executeOnEndpoint(sparqlQuery, readOrUpdate);
        } else {
            throw new SparqlError("SPARQL endpoint is not configured", 500);
        }
    } catch (err) {
        console.error("Error executing SPARQL query:", err);
        // Re-throw SparqlError to preserve status code
        if (err instanceof SparqlError) {
            throw err;
        }
        throw new SparqlError(`Failed to execute SPARQL query`, 500);
    }
    //console.log(sparqlQuery);
    return responseText;
}

function formatTerminalValue(obj: any): { value: any } | undefined {
    if (typeof obj === "string" || typeof obj === "number") {
        return { "value": obj };
    }
    if (typeof obj === "object" && obj["@id"]) {
        return { "value": obj["@id"] };
    }
    console.error("Unexpected type:", typeof obj, obj);
    return undefined;
}

function getValuesFromArray(
    arr: Array<any>, 
    path: Array<string>, 
    prefLanguage: string | null
): Array<any> {
    const results: Array<any> = [];
    for (const item of arr) {
        const result = getValue(item, path, prefLanguage);
        if (result !== undefined) {
            if (Array.isArray(result)) {
                results.push(...result);
            } else if (result.value !== null) {
                results.push(result);
            }
        }
    }
    return results;
}

/**
 * Formats a language-tagged value, handling both single values and LanguageSetMap
 */
function formatLanguageValue(language: string, value: any) {
    // check for LanguageSetMap (multivalued property with proxyContext)
    if (value && typeof value === "object" && value.hasOwnProperty("proxyContext")) {
        return { 
            "language": language,
            "value": Array.from(value)
        };
    }
    return { 
        "language": language,
        "value": value
    };
}

function selectFallbackLanguage(
    availableLanguages: Record<string, any>
): { language: string, value: any } | undefined {
    for (const lang of FALLBACK_LANGUAGES) {
        if (lang in availableLanguages) {
            return formatLanguageValue(lang, availableLanguages[lang]);
        }
    }
    return undefined;
}

function getLanguageValue(
    availableLanguages: Record<string, any>,
    prefLanguage: string | null
): { language: string, value: any } | undefined {
    // Case: preferred language available
    if (prefLanguage && prefLanguage in availableLanguages && availableLanguages[prefLanguage]) {
        return formatLanguageValue(prefLanguage, availableLanguages[prefLanguage]);
    }
    
    // Case: fallback to first available language
    if (Object.keys(availableLanguages).length > 0) {
        return selectFallbackLanguage(availableLanguages);
    }
    
    return undefined;
}

export function getValue(obj: any, path: Array<string>, prefLanguage: string | null = null) {
    // Case: leaf node, return literal value as is
    if (path.length < 1) {
        return formatTerminalValue(obj);
    }
    
    // Case: multiple values
    if (Array.isArray(obj)) {
        return getValuesFromArray(obj, path, prefLanguage);
    }
    
    const key = path[0];
    
    // Case: key not found => no value to return
    if (!obj[key]) {
        return { "value": null };
    }
    
    // Case: language-tagged string
    const shortProperty = key.split(/[#\/]/).pop() || key;
    const availableLanguages = languagesOf(obj, shortProperty);
    
    if (availableLanguages && Object.keys(availableLanguages).length > 0) {
        const langValue = getLanguageValue(availableLanguages, prefLanguage);
        if (langValue) {
            return langValue;
        }
    }
    
    // Case: continue path traversal
    return getValue(obj[key], path.slice(1), prefLanguage);
}

export function setValue(obj: any, path: Array<string>, value: any, language: string | null = null, i=0) {
    if (path.length < 1) return;
    const key = path[0];
    const contextKey = key.split("#")[1] || key.split("/").slice(-1)[0];

    if (Array.isArray(obj)) {
        for (const item of obj) {
            setValue(item, path, value[i], language, i);
            i++;
        }
        return;
    }

    if (path.length === 1) {
        if (language) {
            // check for LanguageSetMap (multivalued property with proxyContext)
            let langValue = languagesOf(obj, contextKey);

            if (Array.isArray(value)) {
                const langSet = langValue[language];
                // LanguageSet (multi-valued)? => use add
                if (langSet && typeof langSet === 'object' && 'add' in langSet) {
                    value.forEach(val => (langSet as Set<string>).add(val));
                } else {
                    // single-valued property? 
                    // => set immediately, but only first value as more are not allowed (per ShEx)
                    langValue[language] = value[0];
                }
                return;
            }
            langValue[language] = value;
            return;
        }
        obj[contextKey] = value;
        return;
    }

    // create key if none exists
    if (!obj[contextKey] || typeof obj[contextKey] !== "object")
        // why specify a URI here when there are blank nodes? well, because the SPARQL spec
        // does not allow blank nodes in DELETE DATA, so the only alternative would be rewriting
        // DELETE DATA to DELETE ... WHERE ... which, however, turns quickly into incredibly complex queries
        // that run into timeouts. so, here we are
        obj[contextKey] = { "@id": config.data.base_uri + uuidv4() };

    setValue(obj[contextKey], path.slice(1), value, language);
}

export function removeValues(obj: any, path: Array<string>, language: string | null = null) {
    let key = path[0];

    if (path.length === 1) {
        if (language) {
            // check for LanguageSetMap (multivalued property with proxyContext)
            let langValue = languagesOf(obj, key);
            delete langValue[language];
            return;
        } else if (Array.isArray(obj)) {
            while (obj.length) {
                // this is perhaps a bit optimistic and may not work with more complex paths
                // ...but actually worked for all tests, so keeping it for now
                delete obj[0][key];
                obj[0] = undefined;
            }
        } else {
            obj[key] = undefined;
        }
        return;
    }

    if (obj[key])
        return removeValues(obj[key], path.slice(1), language);
}

export async function setShape(
    shape: any, 
    shapeAttrs: {[index: string]: {[index: string]: Array<string>}},
    data: any,
    typeUri?: string,
    intermediateTypeMap?: Map<string, string>,
): Promise<void> {

    const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";

    if (typeUri) {
        shape[RDF_TYPE] = {"@id": typeUri};
    }

    // suffix-based lookup map to avoid N*N complexity
    const suffixToAttr = new Map<string, string>();
    for (const attr in shapeAttrs) {
        const suffix = attr.split(/[\/#]/).slice(-1)[0];
        suffixToAttr.set(suffix, attr);
    }
    for (const dataAttr in data) {
        const shapeAttr = suffixToAttr.get(dataAttr);
        if (!shapeAttr) continue;
        
        const path = shapeAttrs[shapeAttr]["path"];
        const rawValue = data[dataAttr];
        const language = (rawValue && typeof rawValue === "object" && rawValue.hasOwnProperty("language")) ? rawValue.language : null;
        const newValue = (rawValue && typeof rawValue === "object" && rawValue.hasOwnProperty("value")) ? rawValue.value : rawValue;
        setValue(shape, path, newValue, language);
    }

    // stamp rdf:type on intermediate blank nodes
    if (intermediateTypeMap) {
        for (const [pathKey, intTypeUri] of intermediateTypeMap) {
            const predicatePath: string[] = JSON.parse(pathKey);
            // navigate from root shape along the predicate path
            let node = shape;
            for (const predicate of predicatePath) {
                const contextKey = predicate.split("#")[1] || predicate.split("/").slice(-1)[0];
                if (!node || !node[contextKey] || typeof node[contextKey] !== "object") {
                    node = null;
                    break;
                }
                node = node[contextKey];
            }
            if (node && typeof node === "object") {
                node[RDF_TYPE] = {"@id": intTypeUri};
            }
        }
    }
}

export async function removeShape(
    shape: any, 
    shapeAttrs: {[index: string]: {[index: string]: Array<string>}},
    intermediateTypeMap?: Map<string, string>,
): Promise<void> {
    
    for (const attr in shapeAttrs) {
        removeValues(shape, shapeAttrs[attr]["path"]);
    }

    // remove rdf:type from nested blank nodes
    if (intermediateTypeMap) {
        const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
        for (const [pathKey] of intermediateTypeMap) {
            const predicatePath: string[] = JSON.parse(pathKey);
            let node = shape;
            for (const predicate of predicatePath) {
                const contextKey = predicate.split("#")[1] || predicate.split("/").slice(-1)[0];
                if (!node || !node[contextKey] || typeof node[contextKey] !== "object") {
                    node = null;
                    break;
                }
                node = node[contextKey];
            }
            if (node && typeof node === "object") {
                node[RDF_TYPE] = undefined;
            }
        }
    }
}

export async function getShapeInstance(
    shape: any, 
    shapeAttrs: {[index: string]: {[index: string]: Array<string>}},
    prefLanguage: string | null = null
): Promise<any> {
    let shapeData: {[index: string]: any} = {};
    for (const attr in shapeAttrs) {
        const path = shapeAttrs[attr]["path"];
        const value = getValue(shape, path, prefLanguage);
        const suffix = attr.split(/[\/#]/).slice(-1)[0];
        shapeData[suffix] = value;
    }
    return shapeData;
}

export async function handleGET(shape: any, attributeName: string, uri: string) {
    return createReadHandlerResponse({
        notFoundMessage: "Resource not found",
        operation: async () => {
            const [isEmpty, shapeProfile] = await getDatasetForFragmentShape(shape.label, uri, attributeName);
            const body = getValue(shapeProfile, shape.shapeAttrs[attributeName]["path"]);
            return { isEmpty, body };
        }
    });
}

export async function handleShapeGET(shape: any, uri: string) {
    return createReadHandlerResponse({
        notFoundMessage: "Resource not found",
        operation: async () => {
            const [isEmpty, shapeProfile] = await getDatasetForShape(shape.label, uri, shape.shapeAttrs);
            const body = await getShapeInstance(shapeProfile, shape.shapeAttrs, null);
            return { isEmpty, body };
        }
    });
}

// replaces all values for given attributeName
export async function handlePUT(shape: any, attributeName: string, req: Request): Promise<HandlerResponse> {
    const uri = req.params.uri;
    const value = req.body.value
    const language = req.body.language || null;
    const [isEmpty, shapeProfile]: any = await getDatasetForFragmentShape(shape.label, uri, attributeName);
    return createModifyHandlerResponse({
        isEmpty,
        notFoundMessage: "Resource not found for PUT",
        successStatus: 200,
        successBody: { success: true },
        operation: async () => {
            startTransaction(shapeProfile);
            removeValues(shapeProfile, shape.shapeAttrs[attributeName]["path"]);
            setValue(shapeProfile, shape.shapeAttrs[attributeName]["path"], value, language);
            const sparqlUpdate: string = await toSparqlUpdate(shapeProfile);
            await executeSparql(sparqlUpdate, SparqlReadOrUpdate.UPDATE);
        }
    });
}

export async function handleShapePUT(shape: any, req: Request): Promise<HandlerResponse> {
    const uri = req.params.uri;
    const [isEmpty, shapeProfile]: any = await getDatasetForShape(shape.label, uri, shape.shapeAttrs);
    return createModifyHandlerResponse({
        isEmpty,
        notFoundMessage: "Resource not found for PUT",
        successStatus: 200,
        successBody: { uri: shapeProfile["@id"] },
        operation: async () => {
            startTransaction(shapeProfile);
            removeShape(shapeProfile, shape.shapeAttrs, shape.intermediateTypeMap);
            await setShape(shapeProfile, shape.shapeAttrs, req.body, shape.typeUri, shape.intermediateTypeMap);
            const sparqlUpdate: string = await toSparqlUpdate(shapeProfile);
            await executeSparql(sparqlUpdate, SparqlReadOrUpdate.UPDATE);
        }
    });
}

export async function handlePOST(shape: any, attributeName: string, req: Request): Promise<HandlerResponse> {
    const uri = req.params.uri;
    const value = req.body.value
    const language = req.body.language || null;
    const [isEmpty, shapeProfile]: any = await getDatasetForFragmentShape(shape.label, uri, attributeName);
    return createModifyHandlerResponse({
        isEmpty,
        notFoundMessage: "Resource not found for POST",
        successStatus: 201,
        successBody: { success: true },
        operation: async () => {
            startTransaction(shapeProfile);
            setValue(shapeProfile, shape.shapeAttrs[attributeName]["path"], value, language);
            const sparqlUpdate: string = await toSparqlUpdate(shapeProfile);
            await executeSparql(sparqlUpdate, SparqlReadOrUpdate.UPDATE);
        }
    });
}

export async function handleShapePOST(shape: any, req: Request): Promise<HandlerResponse> {
    const shapeProfile: any = await getEmptyShape(shape.label);
    return createModifyHandlerResponse({
        successStatus: 201,
        successBody: { uri: shapeProfile["@id"] },
        operation: async () => {
            startTransaction(shapeProfile);
            await setShape(shapeProfile, shape.shapeAttrs, req.body, shape.typeUri, shape.intermediateTypeMap);
            const sparqlUpdate: string = await toSparqlUpdate(shapeProfile);
            await executeSparql(sparqlUpdate, SparqlReadOrUpdate.UPDATE);
        }
    });
}

export async function handleDELETE(shape: any, attributeName: string, uri: string): Promise<HandlerResponse> {
    const [isEmpty, shapeProfile]: any = await getDatasetForFragmentShape(shape.label, uri, attributeName);
    return createModifyHandlerResponse({
        isEmpty,
        notFoundMessage: "Resource not found for DELETE",
        successStatus: 204,
        operation: async () => {
            startTransaction(shapeProfile);
            removeValues(shapeProfile, shape.shapeAttrs[attributeName]["path"]);
            const sparqlUpdate: string = await toSparqlUpdate(shapeProfile);
            await executeSparql(sparqlUpdate, SparqlReadOrUpdate.UPDATE);
        }
    });
}

export async function handleShapeDELETE(shape: any, uri: string): Promise<HandlerResponse> {
    const [isEmpty, shapeProfile]: any = await getDatasetForShape(shape.label, uri, shape.shapeAttrs);
    return createModifyHandlerResponse({
        isEmpty,
        notFoundMessage: "Resource not found for DELETE",
        successStatus: 204,
        operation: async () => {
            startTransaction(shapeProfile);
            removeShape(shapeProfile, shape.shapeAttrs, shape.intermediateTypeMap);
            const sparqlUpdate: string = await toSparqlUpdate(shapeProfile);
            await executeSparql(sparqlUpdate, SparqlReadOrUpdate.UPDATE);
        }
    });
}
