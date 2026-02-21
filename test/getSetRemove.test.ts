import { TestShapeType } from "./resources/ldo/test.shapeTypes";
import { getValue, setValue, removeValues } from "../src/requestHandler";
import { parseRdf } from "@ldo/ldo";

describe('getValue Tests with TestShapeType', () => {
    let testDataset: any;
    let testInstance: any;

    beforeEach(async () => {
        // Create a minimal RDF dataset with test data
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
        
        testDataset = await parseRdf(testTurtle, {});
        testInstance = testDataset
            .usingType(TestShapeType)
            .fromSubject("http://example.org/testSubject");
    });

    // Direct property tests (no intermediate nodes)
    
    test('getValue: single-valued property without preferred language (direct)', async () => {
        const value = getValue(testInstance, ["http://example.org/singlevaluedStringUntagged"]);
        expect(value).toEqual({ "language": "@none", "value": "untagged value" });
    });

    test('getValue: multi-valued property without preferred language (direct)', async () => {
        const value = getValue(testInstance, ["http://example.org/multivaluedStringUntagged"]);
        expect(value).toEqual({ "language": "@none", "value": ["value1", "value2", "value3"] });
    });

    test('getValue: single-valued property with preferred language that does not exist (direct)', async () => {
        const value = getValue(testInstance, ["http://example.org/singlevaluedStringTagged"], "de");
        expect(value).toEqual({ "language": "en", "value": "tagged value" });
    });

    test('getValue: value of dateTime property', async () => {
        const value = getValue(testInstance, ["http://example.org/dateTimeProperty"]);
        expect(value).toEqual({"value": "2000-01-01T00:00:00" });
    });

    test('getValue: value of integer property', async () => {
        const value = getValue(testInstance, ["http://example.org/integerProperty"]);
        expect(value).toEqual({"value": 9001});
    });

    test('getValue: multi-valued property with preferred language that does not exist (direct)', async () => {
        const value = getValue(testInstance, ["http://example.org/multivaluedStringTagged"], "fr");
        expect(value).toEqual({ "language": "de", "value": ["de value1", "de value2"] });
    });

    test('getValue: single-valued property with preferred language that exists (direct)', async () => {
        const value = getValue(testInstance, ["http://example.org/singlevaluedStringTagged"], "en");
        expect(value).toEqual({ "language": "en", "value": "tagged value" });
    });

    test('getValue: multi-valued property with preferred language that exists (direct)', async () => {
        const value = getValue(testInstance, ["http://example.org/multivaluedStringTagged"], "de");
        expect(value).toEqual({ "language": "de", "value": ["de value1", "de value2"] });
    });

    // Indirect property tests (through intermediate nodes)

    test('getValue: single-valued property without preferred language (indirect)', async () => {
        const value = getValue(testInstance, [
            "http://example.org/intermediateNodeLink",
            "http://example.org/intermediateSinglevaluedStringUntagged"
        ]);
        expect(value).toEqual({ "language": "@none", "value": "intermediate untagged" });
    });

    test('getValue: single-valued property with preferred language that exists (indirect)', async () => {
        const value = getValue(testInstance, [
            "http://example.org/intermediateNodeLink",
            "http://example.org/intermediateSinglevaluedStringTagged"
        ], "de");
        expect(value).toEqual({ "language": "de", "value": "intermediate tagged" });
    });

    test('getValue: single-valued property with preferred language that does not exist (indirect)', async () => {
        const value = getValue(testInstance, [
            "http://example.org/intermediateNodeLink",
            "http://example.org/intermediateSinglevaluedStringTagged"
        ], "en");
        expect(value).toEqual({ "language": "de", "value": "intermediate tagged" });
    });

    test('getValue: returns undefined for non-existent property', async () => {
        const value = getValue(testInstance, ["http://example.org/nonExistentProperty"]);
        expect(value).toEqual({"value": null});
    });

    test('getValue: returns undefined for non-existent nested property', async () => {
        const value = getValue(testInstance, [
            "http://example.org/intermediateNodeLink",
            "http://example.org/nonExistentProperty"
        ]);
        expect(value).toEqual({"value": null});
    });

    test('getValue: returns value for property shared by multiple nodes', async () => {
        const value1 = getValue(testInstance, [
            "http://example.org/sharedProperty"
        ]);
        const value2 = getValue(testInstance, [
            "http://example.org/intermediateNodeLink",
            "http://example.org/sharedProperty"
        ]);
        expect(value1).toEqual({"language": "de-de", "value": "value1"});
        expect(value2).toEqual({"language": "en-us", "value": "value2"});
    });
});


describe('setValue Tests with TestShapeType', () => {
    let testDataset: any;
    let testInstance: any;

    beforeEach(async () => {
        // Create a minimal RDF dataset with test data
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
        
        testDataset = await parseRdf(testTurtle, {});
        testInstance = testDataset
            .usingType(TestShapeType)
            .fromSubject("http://example.org/testSubject");
    });

    // Direct property tests (no intermediate nodes)
    
    test('setValue: single-valued property without preferred language (direct)', async () => {
        const value1 = getValue(testInstance, ["http://example.org/singlevaluedStringUntagged"]);
        expect(value1).toEqual({ "language": "@none", "value": "untagged value" });
        setValue(testInstance, ["http://example.org/singlevaluedStringUntagged"], "untagged value2");
        const value2 = getValue(testInstance, ["http://example.org/singlevaluedStringUntagged"]);
        expect(value2).toEqual({ "language": "@none", "value": "untagged value2" });
    });

    test('setValue: single-valued property WITH preferred language (direct)', async () => {
        const value1 = getValue(testInstance, ["http://example.org/singlevaluedStringUntagged"], "de-de");
        expect(value1).toEqual({ "language": "@none", "value": "untagged value" });
        setValue(testInstance, ["http://example.org/singlevaluedStringUntagged"], "new de value", "de-de");
        const value2 = getValue(testInstance, ["http://example.org/singlevaluedStringUntagged"], "de-de");
        expect(value2).toEqual({ "language": "de-de", "value": "new de value" });
    });

    test('setValue: multi-valued property without preferred language (direct)', async () => {
        const value1 = getValue(testInstance, ["http://example.org/multivaluedStringUntagged"]);
        expect(value1).toEqual({ "language": "@none", "value": ["value1", "value2", "value3"] });
        setValue(testInstance, ["http://example.org/multivaluedStringUntagged"], ["value4", "value5", "value6"]);
        const value2 = getValue(testInstance, ["http://example.org/multivaluedStringUntagged"]);
        expect(value2).toEqual({ "language": "@none", "value": ["value4", "value5", "value6"] });
    });

    test('setValue: multi-valued property WITH preferred language (direct)', async () => {
        const value1 = getValue(testInstance, ["http://example.org/multivaluedStringUntagged"], "de-de");
        expect(value1).toEqual({ "language": "@none", "value": ["value1", "value2", "value3"]});
        setValue(testInstance, ["http://example.org/multivaluedStringUntagged"], ["value4de", "value5de", "value6de"], "de-de");
        const value2 = getValue(testInstance, ["http://example.org/multivaluedStringUntagged"], "de-de");
        expect(value2).toEqual({ "language": "de-de", "value": ["value4de", "value5de", "value6de"] });
    });

    test('setValue: value of dateTime property', async () => {
        const value1 = getValue(testInstance, ["http://example.org/dateTimeProperty"]);
        expect(value1).toEqual({"value": "2000-01-01T00:00:00"});
        setValue(testInstance, ["http://example.org/dateTimeProperty"], "2000-11-11T00:00:00");
        const value2 = getValue(testInstance, ["http://example.org/dateTimeProperty"]);
        expect(value2).toEqual({"value": "2000-11-11T00:00:00"});
    });

    test('setValue: value of integer property', async () => {
        const value1 = getValue(testInstance, ["http://example.org/integerProperty"]);
        expect(value1).toEqual({"value": 9001});
        setValue(testInstance, ["http://example.org/integerProperty"], 9002);
        const value2 = getValue(testInstance, ["http://example.org/integerProperty"]);
        expect(value2).toEqual({"value": 9002});
    });

    // Indirect property tests (through intermediate nodes)

    test('setValue: single-valued property without preferred language (indirect)', async () => {
        const value1 = getValue(testInstance, [
            "http://example.org/intermediateNodeLink",
            "http://example.org/intermediateSinglevaluedStringUntagged"
        ]);
        expect(value1).toEqual({ "language": "@none", "value": "intermediate untagged" });
        setValue(testInstance, [
            "http://example.org/intermediateNodeLink",
            "http://example.org/intermediateSinglevaluedStringUntagged",
        ], "new value");
        const value2 = getValue(testInstance, [
            "http://example.org/intermediateNodeLink",
            "http://example.org/intermediateSinglevaluedStringUntagged"
        ]);
        expect(value2).toEqual({ "language": "@none", "value": "new value" });
    });
});

describe('removeValues Tests with TestShapeType', () => {
    let testDataset: any;
    let testInstance: any;

    beforeEach(async () => {
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
        
        testDataset = await parseRdf(testTurtle, {});
        testInstance = testDataset
            .usingType(TestShapeType)
            .fromSubject("http://example.org/testSubject");
    });

    // Direct property tests (no intermediate nodes)
    
    test('removeValues: single-valued property (direct)', async () => {
        const value1 = getValue(testInstance, ["http://example.org/singlevaluedStringUntagged"]);
        expect(value1).toEqual({ "language": "@none", "value": "untagged value" });
        removeValues(testInstance, ["http://example.org/singlevaluedStringUntagged"]);
        const value2 = getValue(testInstance, ["http://example.org/singlevaluedStringUntagged"]);
        expect(value2).toEqual({"value": null});
    });

    test('removeValues: single-valued property with language tag (direct)', async () => {
        const value1 = getValue(testInstance, ["http://example.org/singlevaluedStringTagged"]);
        expect(value1).toEqual({ "language": "en", "value": "tagged value" });
        removeValues(testInstance, ["http://example.org/singlevaluedStringTagged"]);
        const value2 = getValue(testInstance, ["http://example.org/singlevaluedStringTagged"]);
        expect(value2).toEqual({"value": null});
    });

    test('removeValues: multi-valued property (direct)', async () => {
        const value1 = getValue(testInstance, ["http://example.org/multivaluedStringUntagged"]);
        expect(value1).toEqual({ "language": "@none", "value": ["value1", "value2", "value3"] });
        removeValues(testInstance, ["http://example.org/multivaluedStringUntagged"]);
        const value2 = getValue(testInstance, ["http://example.org/multivaluedStringUntagged"]);
        expect(value2).toEqual({"value": null});
    });

    test('removeValues: multi-valued property with language tags (direct)', async () => {
        const value1 = getValue(testInstance, ["http://example.org/multivaluedStringTagged"], "de");
        expect(value1).toEqual({ "language": "de", "value": ["de value1", "de value2"] });
        removeValues(testInstance, ["http://example.org/multivaluedStringTagged"]);
        const value2 = getValue(testInstance, ["http://example.org/multivaluedStringTagged"]);
        expect(value2).toEqual({"value": null});
    });

    test('removeValues: multi-valued property with language tags (direct), only delete one language', async () => {
        const value1de = getValue(testInstance, ["http://example.org/multivaluedStringTagged"], "de");
        expect(value1de).toEqual({ "language": "de", "value": ["de value1", "de value2"] });
        const value1en = getValue(testInstance, ["http://example.org/multivaluedStringTagged"], "en");
        expect(value1en).toEqual({ "language": "en", "value": ["en value1"] });
        removeValues(testInstance, ["http://example.org/multivaluedStringTagged"], "de");
        const value2de = getValue(testInstance, ["http://example.org/multivaluedStringTagged"], "de");
        expect((value2de as any).language).not.toBe("de");
        const value2en = getValue(testInstance, ["http://example.org/multivaluedStringTagged"], "en");
        expect(value2en).toEqual({ "language": "en", "value": ["en value1"] });
    });

    test('removeValues: dateTime property', async () => {
        const value1 = getValue(testInstance, ["http://example.org/dateTimeProperty"]);
        expect(value1).toEqual({"value": "2000-01-01T00:00:00"});
        removeValues(testInstance, ["http://example.org/dateTimeProperty"]);
        const value2 = getValue(testInstance, ["http://example.org/dateTimeProperty"]);
        expect(value2).toEqual({"value": null});
    });

    test('removeValues: integer property', async () => {
        const value1 = getValue(testInstance, ["http://example.org/integerProperty"]);
        expect(value1).toEqual({"value": 9001});
        removeValues(testInstance, ["http://example.org/integerProperty"]);
        const value2 = getValue(testInstance, ["http://example.org/integerProperty"]);
        expect(value2).toEqual({"value": null});
    });

    // indirect property tests (through intermediate nodes)
    test('removeValues: single-valued property (indirect)', async () => {
        const path = [
            "http://example.org/intermediateNodeLink",
            "http://example.org/intermediateSinglevaluedStringUntagged"
        ];
        const value1 = getValue(testInstance, path);
        expect(value1).toEqual({ "language": "@none", "value": "intermediate untagged" });
        removeValues(testInstance, path);
        const value2 = getValue(testInstance, path);
        expect(value2).toEqual({"value": null});
    });

    test('removeValues: single-valued property with language tag (indirect)', async () => {
        const path = [
            "http://example.org/intermediateNodeLink",
            "http://example.org/intermediateSinglevaluedStringTagged"
        ];
        const value1 = getValue(testInstance, path, "de");
        expect(value1).toEqual({ "language": "de", "value": "intermediate tagged" });
        removeValues(testInstance, path);
        const value2 = getValue(testInstance, path, "de");
        expect(value2).toEqual({"value": null});
    });

    test('removeValues: property shared by multiple nodes', async () => {
        const path1 = ["http://example.org/sharedProperty"];
        const path2 = [
            "http://example.org/intermediateNodeLink",
            "http://example.org/sharedProperty"
        ];
        const value1 = getValue(testInstance, path1);
        const value2 = getValue(testInstance, path2);
        expect(value1).toEqual({"language": "de-de", "value": "value1"});
        expect(value2).toEqual({"language": "en-us", "value": "value2"});
        
        // remove from direct property
        removeValues(testInstance, path1);
        const value3 = getValue(testInstance, path1);
        expect(value3).toEqual({"value": null});
        
        // indirect property should still exist
        const value4 = getValue(testInstance, path2);
        expect(value4).toEqual({"language": "en-us", "value": "value2"});

        // now remove from indirect property
        removeValues(testInstance, path2);
        const value5 = getValue(testInstance, path2);
        expect(value5).toEqual({"value": null});
    });

    test('removeValues: non-existent property should not throw error', async () => {
        const nonExistentPath = ["http://example.org/nonExistentProperty"];
        expect(() => {
            removeValues(testInstance, nonExistentPath);
        }).not.toThrow();
        const value = getValue(testInstance, nonExistentPath);
        expect(value).toEqual({"value": null});
    });

    test('removeValues: non-existent nested property should not throw error', async () => {
        const nonExistentNestedPath = [
            "http://example.org/intermediateNodeLink",
            "http://example.org/nonExistentProperty"
        ];
        expect(() => {
            removeValues(testInstance, nonExistentNestedPath);
        }).not.toThrow();
        const value = getValue(testInstance, nonExistentNestedPath);
        expect(value).toEqual({"value": null});
    });
});