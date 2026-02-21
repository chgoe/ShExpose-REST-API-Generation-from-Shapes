import { jest, describe, test, expect, beforeAll, beforeEach, afterEach } from '@jest/globals';
import { TestShapeType } from "./resources/ldo/test.shapeTypes";
import { loadOverwriteMappings, findPredicatesForShape } from '../src/utils';

// Mock the config module before importing request handlers
jest.unstable_mockModule('../src/config.js', () => ({
    default: {
        app: { port: 3000 },
        rdf: { sparql_endpoint: 'http://mock-sparql-server/query' },
        data: { base_uri: 'http://example.org/' },
        debug: { do_sparql_update: true }
    }
}));

// Import after mocking config
const { handleShapeGET, handleShapePUT, handleShapePOST, handleDELETE, handleShapeDELETE } = await import('../src/requestHandler.js');

// Mock fetch for SPARQL endpoint
const mockFetch = jest.fn<typeof fetch>();
global.fetch = mockFetch as unknown as typeof fetch;

const testTurtle = `
    @prefix ex: <http://example.org/> .
    @prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
    @prefix xsd: <http://www.w3.org/2001/XMLSchema#> .

    ex:testSubject a ex:Testclass ;
        ex:singlevaluedStringUntagged "untagged value" ;
        ex:singlevaluedStringTagged "tagged value"@en ;
        ex:dateTimeProperty "2000-01-01T00:00:00"^^xsd:dateTime ;
        ex:integerProperty "9001"^^xsd:integer ;
        ex:multivaluedStringUntagged "value1", "value2", "value3" ;
        ex:multivaluedStringTagged "de value1"@de, "en value1"@en, "de value2"@de ;
        ex:intermediateNodeLink ex:intermediateNode ;
        ex:sharedProperty "value1"@de-DE .

    ex:intermediateNode a ex:IntermediateNodeclass ;
        ex:intermediateSinglevaluedStringUntagged "intermediate untagged" ;
        ex:intermediateSinglevaluedStringTagged "intermediate tagged"@de ;
        ex:sharedProperty "value2"@en-US .
`;

describe('CRUD Operations Tests', () => {
    let shape: any;
    let capturedSparqlQuery: string | null = null;

    beforeAll(async () => {
        const overwriteMap = await loadOverwriteMappings('config/overwrite-mappings.yaml');
        const shapeAttrs = findPredicatesForShape(
            TestShapeType.shape,
            TestShapeType.schema.shapes,
            TestShapeType.context,
            overwriteMap
        );
        
        shape = {
            label: 'test',
            shapeAttrs: shapeAttrs
        };
    });

    beforeEach(() => {
        mockFetch.mockClear();
        capturedSparqlQuery = null;
        
        // Mock fetch to capture SPARQL queries
        mockFetch.mockImplementation(async (url, options) => {
            const body = options?.body as string;
            
            // Capture UPDATE queries (INSERT/DELETE)
            if (body && (body.includes('INSERT') || body.includes('DELETE'))) {
                capturedSparqlQuery = body;
                return new Response('', { status: 200 });
            }
            
            if (body && (body.includes('CONSTRUCT') || body.includes('construct'))) {
                return new Response(testTurtle, {
                    status: 200,
                    headers: { 'Content-Type': 'text/turtle' }
                });
            }
            
            return new Response('', { status: 200 });
        });
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe('POST - Create new testSubject2', () => {
        test('should generate correct SPARQL INSERT query for new resource', async () => {
            const newResourceData = {
                singlevaluedStringUntagged: { value: "new untagged string" },
                singlevaluedStringTagged: { value: "new tagged string", language: "en" },
                dateTimeProperty: { value: "2025-01-01T00:00:00" },
                integerProperty: { value: 42 },
                multivaluedStringUntagged: { value: ["val1", "val2"] },
                multivaluedStringTagged: { value: ["de val1", "de val2"], language: "de" },
                sharedProperty: { value: "shared value", language: "de" }
            };

            const mockRequest = {
                body: newResourceData,
                params: {}
            } as any;

            const result = await handleShapePOST(shape, mockRequest);

            expect(result.status).toBe(201);
            
            expect(capturedSparqlQuery).toBeDefined();
            const sparqlQuery = capturedSparqlQuery!;
            
            expect(sparqlQuery).toContain('INSERT DATA');
            expect(sparqlQuery).toContain('"new untagged string"');
            expect(sparqlQuery).toContain('"new tagged string"@en');
            expect(sparqlQuery).toContain('"42"^^<http://www.w3.org/2001/XMLSchema#integer>');
            expect(sparqlQuery).toContain('"2025-01-01T00:00:00"^^<http://www.w3.org/2001/XMLSchema#dateTime>');
            expect(sparqlQuery).toContain('"val1"');
            expect(sparqlQuery).toContain('"val2"');
            expect(sparqlQuery).toContain('"de val1"@de');
            expect(sparqlQuery).toContain('"de val2"@de');
            
            // Verify correct predicates are used
            expect(sparqlQuery).toContain('<http://example.org/singlevaluedStringUntagged>');
            expect(sparqlQuery).toContain('<http://example.org/singlevaluedStringTagged>');
            expect(sparqlQuery).toContain('<http://example.org/dateTimeProperty>');
            expect(sparqlQuery).toContain('<http://example.org/integerProperty>');
            expect(sparqlQuery).toContain('<http://example.org/multivaluedStringUntagged>');
            expect(sparqlQuery).toContain('<http://example.org/multivaluedStringTagged>');
        });

        test('should handle minimal data correctly', async () => {
            const minimalResourceData = {
                integerProperty: { value: 1 }
            };

            const mockRequest = {
                body: minimalResourceData,
                params: {}
            } as any;

            const result = await handleShapePOST(shape, mockRequest);

            expect(result.status).toBe(201);

            expect(capturedSparqlQuery).toBeDefined();
            const sparqlQuery = capturedSparqlQuery!;
            
            expect(sparqlQuery).toContain('INSERT DATA');
            expect(sparqlQuery).toContain('"1"^^<http://www.w3.org/2001/XMLSchema#integer>');
            expect(sparqlQuery).toContain('http://example.org/integerProperty');
        });
    });

    describe('PUT - Replace existing testSubject', () => {
        test('should generate correct SPARQL update query for full resource replacement', async () => {
            const testSubjectUri = 'http://example.org/testSubject';
            const replacementData = {
                singlevaluedStringUntagged: { value: 'updated untagged value' },
                singlevaluedStringTagged: { value: 'updated tagged value', language: 'de' },
                integerProperty: { value: 123 },
                dateTimeProperty: { value: '2026-01-01T00:00:00' }
            };

            const mockRequest = {
                body: replacementData,
                params: { uri: testSubjectUri }
            } as any;

            const result = await handleShapePUT(shape, mockRequest);

            expect(result.status).toBe(200);
            expect(result.body).toEqual({ uri: testSubjectUri });

            expect(capturedSparqlQuery).toBeDefined();
            const sparqlQuery = capturedSparqlQuery!;

            expect(sparqlQuery).toMatch(/^DELETE DATA/);
            expect(sparqlQuery).toMatch(/.+INSERT DATA/);
            expect(sparqlQuery).toContain(testSubjectUri);

            // DELETE old values
            expect(sparqlQuery).toMatch(/^DELETE DATA.*"untagged value"/);
            expect(sparqlQuery).toMatch(/^DELETE DATA.*"tagged value"@en/);
            expect(sparqlQuery).toMatch(/^DELETE DATA.*"value2"@en-us/);
            expect(sparqlQuery).toMatch(/^DELETE DATA.*"9001"\^\^<http:\/\/www.w3.org\/2001\/XMLSchema#integer>/);

            // INSERT new values
            expect(sparqlQuery).toMatch(/.+INSERT DATA.*"updated untagged value"/);
            expect(sparqlQuery).toMatch(/.+INSERT DATA.*"updated tagged value"@de/);
            expect(sparqlQuery).toMatch(/.+INSERT DATA.*"123"\^\^<http:\/\/www.w3.org\/2001\/XMLSchema#integer>/);
            expect(sparqlQuery).toMatch(/.+INSERT DATA.*"2026-01-01T00:00:00"\^\^<http:\/\/www.w3.org\/2001\/XMLSchema#dateTime>/);
        });
    });

    describe('GET - Read test shape', () => {
        test('should return correct JSON response for testSubject', async () => {
            const testSubjectUri = 'http://example.org/testSubject';

            const result = await handleShapeGET(shape, testSubjectUri);

            expect(result.body).toHaveProperty('singlevaluedStringUntagged');
            expect(result.body.singlevaluedStringUntagged).toEqual({
                language: '@none',
                value: 'untagged value'
            });

            expect(result.body).toHaveProperty('singlevaluedStringTagged');
            expect(result.body.singlevaluedStringTagged).toEqual({
                language: 'en',
                value: 'tagged value'
            });

            expect(result.body).toHaveProperty('integerProperty');
            expect(result.body.integerProperty).toEqual({
                value: 9001
            });

            expect(result.body).toHaveProperty('dateTimeProperty');
            expect(result.body.dateTimeProperty).toEqual({
                value: '2000-01-01T00:00:00'
            });

            expect(result.body).toHaveProperty('multivaluedStringUntagged');
            expect(result.body.multivaluedStringUntagged).toEqual({
                language: '@none',
                value: expect.arrayContaining(['value1', 'value2', 'value3'])
            });

            expect(result.body).toHaveProperty('multivaluedStringTagged');
            expect(result.body.multivaluedStringTagged).toBeDefined();
        });

        test('should handle non-existent resource gracefully', async () => {
            const nonExistentUri = 'http://example.org/nonExistent';

            // Mock fetch to return empty turtle data
            mockFetch.mockImplementation(async () => {
                return new Response('', {
                    status: 200,
                    headers: { 'Content-Type': 'text/turtle' }
                });
            });

            const result = await handleShapeGET(shape, nonExistentUri);

            // Result should have shape structure but with null values
            expect(result).toBeDefined();
            expect(result.status).toBe(404);
        });
    });

    describe('DELETE - Delete testSubject', () => {
        test('should generate correct SPARQL DELETE query for single attribute', async () => {
            const testSubjectUri = 'http://example.org/testSubject';
            const attributeName = 'http://example.org/integerProperty';

            await handleDELETE(shape, attributeName, testSubjectUri);

            expect(capturedSparqlQuery).toBeDefined();
            const sparqlQuery = capturedSparqlQuery!;
            
            expect(sparqlQuery).toContain('DELETE');
            expect(sparqlQuery).toContain('http://example.org/testSubject');
            expect(sparqlQuery).toContain('http://example.org/integerProperty');
            expect(sparqlQuery).toContain('"9001"^^<http://www.w3.org/2001/XMLSchema#integer>');
        });

        test('should handle DELETE for multivalued property', async () => {
            const testSubjectUri = 'http://example.org/testSubject';
            const attributeName = 'http://example.org/multivaluedStringUntagged';

            await handleDELETE(shape, attributeName, testSubjectUri);

            expect(capturedSparqlQuery).toBeDefined();
            const sparqlQuery = capturedSparqlQuery!;
            
            expect(sparqlQuery).toContain('DELETE');
            expect(sparqlQuery).toContain('http://example.org/multivaluedStringUntagged');
            
            // Should delete all values
            expect(sparqlQuery).toContain('value1');
            expect(sparqlQuery).toContain('value2');
            expect(sparqlQuery).toContain('value3');
        });

        test('should handle DELETE for language-tagged property', async () => {
            const testSubjectUri = 'http://example.org/testSubject';
            const attributeName = 'http://example.org/singlevaluedStringTagged';

            await handleDELETE(shape, attributeName, testSubjectUri);

            expect(capturedSparqlQuery).toBeDefined();
            const sparqlQuery = capturedSparqlQuery!;
            
            expect(sparqlQuery).toContain('DELETE');
            expect(sparqlQuery).toContain('http://example.org/singlevaluedStringTagged');
            expect(sparqlQuery).toContain('"tagged value"@en');
        });

        test('should delete entire shape/resource', async () => {
            const testSubjectUri = 'http://example.org/testSubject';

            await handleShapeDELETE(shape, testSubjectUri);

            expect(capturedSparqlQuery).toBeDefined();
            const sparqlQuery = capturedSparqlQuery!;
            
            // Verify DELETE query structure
            expect(sparqlQuery).toContain('DELETE DATA');
            expect(sparqlQuery).toContain('http://example.org/testSubject');
            
            expect(sparqlQuery).toContain('"untagged value"');
            expect(sparqlQuery).toContain('"tagged value"@en');
            expect(sparqlQuery).toContain('"9001"^^<http://www.w3.org/2001/XMLSchema#integer>');
            expect(sparqlQuery).toContain('"2000-01-01T00:00:00"^^<http://www.w3.org/2001/XMLSchema#dateTime>');
            expect(sparqlQuery).toContain('"value1"');
            expect(sparqlQuery).toContain('"value2"');
            expect(sparqlQuery).toContain('"value3"');
            expect(sparqlQuery).toContain('"de value1"@de');
            expect(sparqlQuery).toContain('"de value2"@de');

            // Should delete all attributes of the resource
            expect(sparqlQuery).toContain('<http://example.org/singlevaluedStringUntagged>');
            expect(sparqlQuery).toContain('<http://example.org/singlevaluedStringTagged>');
            expect(sparqlQuery).toContain('<http://example.org/dateTimeProperty>');
            expect(sparqlQuery).toContain('<http://example.org/integerProperty>');
            expect(sparqlQuery).toContain('<http://example.org/multivaluedStringUntagged>');
            expect(sparqlQuery).toContain('<http://example.org/multivaluedStringTagged>');
        });
    });
});
