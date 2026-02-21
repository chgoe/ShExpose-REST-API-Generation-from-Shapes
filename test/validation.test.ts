import { jest, describe, test, expect, beforeAll } from '@jest/globals';
import { Express, Request as ExpressRequest, Response as ExpressResponse } from "express";
import { TestShapeType } from "./resources/ldo/test.shapeTypes";
import { loadOverwriteMappings, findPredicatesForShape } from '../src/utils';
import { validateUriParam, createShapeUpdateBodyValidator, createAttributeUpdateBodyValidator } from '../src/validation';

// Mock the config module before importing request handlers
jest.unstable_mockModule('../src/config.js', () => ({
    default: {
        app: { port: 3000 },
        rdf: { sparql_endpoint: 'http://mock-sparql-server/query' },
        data: { base_uri: 'http://example.org/' },
        debug: { do_sparql_update: false }
    }
}));

// Store for our mock RDF data
let mockTurtleData: string = '';

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


describe('REST API Tests', () => {
    let shape: any;
    let schema: any;

    function testUriValidation(
        uri: string,
        shouldPass: boolean,
    ) {
        const req = {
            params: { uri: encodeURIComponent(uri) }
        } as unknown as ExpressRequest;
        const res = {
            status: jest.fn().mockReturnThis(),
            json: jest.fn()
        } as unknown as ExpressResponse;
        const next = jest.fn();

        validateUriParam(req, res, next);
        
        if (shouldPass) {
            expect(next).toHaveBeenCalled();
            expect(res.status).not.toHaveBeenCalled();
        } else {
            expect(next).not.toHaveBeenCalled();
            expect(res.status).toHaveBeenCalled();
        }
    }

    function testAttributeValidation(
        attributeName: string,
        requestBody: { value: any; language?: string },
        shouldPass: boolean,
        statusCode: number
    ): void {
        const shapeAttrPath = `http://example.org/${attributeName}`;
        const attrPath = shape.shapeAttrs[shapeAttrPath].path;
        const attrValidator = createAttributeUpdateBodyValidator(attrPath, schema);

        const req = { body: requestBody } as unknown as ExpressRequest;
        const res = {
            status: jest.fn().mockReturnThis(),
            json: jest.fn()
        } as unknown as ExpressResponse;
        const next = jest.fn();

        attrValidator(req, res, next);

        if (shouldPass) {
            expect(next).toHaveBeenCalled();
            expect(res.status).not.toHaveBeenCalledWith(statusCode);
        } else {
            expect(next).not.toHaveBeenCalled();
            expect(res.status).toHaveBeenCalledWith(statusCode);
        }
    }

    function testShapeUpdateBodyValidation(
        requestBody: {[attributeName: string]: { value: any; language?: string }} | null,
        shouldPass: boolean,
        statusCode: number
    ): void {
        const shapeBodyValidator = createShapeUpdateBodyValidator(shape.shapeAttrs, schema);

        const req = { body: requestBody } as unknown as ExpressRequest;
        const res = {
            status: jest.fn().mockReturnThis(),
            json: jest.fn()
        } as unknown as ExpressResponse;
        const next = jest.fn();

        shapeBodyValidator(req, res, next);

        if (shouldPass) {
            expect(next).toHaveBeenCalled();
            expect(res.status).not.toHaveBeenCalled();
        } else {
            expect(next).not.toHaveBeenCalled();
            expect(res.status).toHaveBeenCalledWith(statusCode);
        }
    };

    beforeAll(async () => {
        // Load overwrite mappings and create shape attributes
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
        schema = TestShapeType.schema;
    });

    describe('validateUriParam Tests', () => {
        test('validateUriParam: should accept valid URI', async () => {
            testUriValidation('http://example.org/testSubject', true);
        });

        test('validateUriParam: should reject invalid URI', async () => {
            testUriValidation('some-invalid-uri', false);
        });
    });

    describe('AttributeUpdateBodyValidation Tests', () => {
        test('AttributeUpdateBodyValidation: should accept valid shape attributes', async () => {
            testAttributeValidation('integerProperty', { value: 42 }, true, 200);
            testAttributeValidation('singlevaluedStringUntagged', { value: 'string data' }, true, 200);
            testAttributeValidation('singlevaluedStringUntagged', { value: 'string data', language: 'de-de' }, true, 200);
        });

        test('AttributeUpdateBodyValidation: should reject language param for integer attributes', async () => {
            testAttributeValidation('integerProperty', { value: 'data', language: 'de-de' }, false, 400);
        });

        test('AttributeUpdateBodyValidation: should accept multiple values for multivaluedStringUntagged', async () => {
            testAttributeValidation('multivaluedStringUntagged', { value: ['string a', 'string b', 'string c'] }, true, 200);
        });

        test('AttributeUpdateBodyValidation: should accept multiple values for multivaluedStringTagged', async () => {
            testAttributeValidation('multivaluedStringTagged', { value: ['string a', 'string b', 'string c'], language: 'de-de' }, true, 200);
        });
    });

    describe('ShapeUpdateBodyValidation Tests', () => {
        test('ShapeUpdateBodyValidation: should accept number value for integerProperty', async () => {
            const requestBody = {
                integerProperty: { value: 42 }
            };
            testShapeUpdateBodyValidation(requestBody, true, 201);
        });

        test('ShapeUpdateBodyValidation: should accept string value for integerProperty', async () => {
            const requestBody = {
                integerProperty: { value: '42' }
            };
            testShapeUpdateBodyValidation(requestBody, true, 201);
        });

        test('ShapeUpdateBodyValidation: should reject empty body for integerProperty', async () => {
            const requestBody = null;
            testShapeUpdateBodyValidation(requestBody, false, 400);
        });

        test('ShapeUpdateBodyValidation: should reject empty object for integerProperty', async () => {
            const requestBody = {};
            testShapeUpdateBodyValidation(requestBody, false, 400);
        });

        test('ShapeUpdateBodyValidation: should accept multiple values for multivaluedStringUntagged', async () => {
            const requestBody = {
                multivaluedStringUntagged: { value: ['string a', 'string b', 'string c'] }
            };
            testShapeUpdateBodyValidation(requestBody, true, 201);
        });

        test('ShapeUpdateBodyValidation: should accept multiple language-tagged values for multivaluedStringTagged', async () => {
            const requestBody = {
                multivaluedStringTagged: { value: ['string a', 'string b', 'string c'], language: 'de-de' }
            };
            testShapeUpdateBodyValidation(requestBody, true, 201);
        });
    });
});
