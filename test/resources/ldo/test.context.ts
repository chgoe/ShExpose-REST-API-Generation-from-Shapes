import { LdoJsonldContext } from "@ldo/jsonld-dataset-proxy";

/**
 * =============================================================================
 * testContext: JSONLD Context for test
 * =============================================================================
 */
export const testContext: LdoJsonldContext = {
  IntermediateNodeclass: {
    "@id": "http://example.org/IntermediateNodeclass",
    "@context": {
      intermediateSinglevaluedStringUntagged: {
        "@id": "http://example.org/intermediateSinglevaluedStringUntagged",
        "@type": "http://www.w3.org/2001/XMLSchema#string",
      },
      intermediateSinglevaluedStringTagged: {
        "@id": "http://example.org/intermediateSinglevaluedStringTagged",
        "@type": "http://www.w3.org/2001/XMLSchema#string",
      },
      intermediateMultivaluedStringUntagged: {
        "@id": "http://example.org/intermediateMultivaluedStringUntagged",
        "@type": "http://www.w3.org/2001/XMLSchema#string",
        "@isCollection": true,
      },
      intermediateMultivaluedStringTagged: {
        "@id": "http://example.org/intermediateMultivaluedStringTagged",
        "@type": "http://www.w3.org/2001/XMLSchema#string",
        "@isCollection": true,
      },
      sharedProperty: {
        "@id": "http://example.org/sharedProperty",
        "@type": "http://www.w3.org/2001/XMLSchema#string",
      },
      type: {
        "@id": "@type",
      },
    },
  },
  Testclass: {
    "@id": "http://example.org/Testclass",
    "@context": {
      singlevaluedStringUntagged: {
        "@id": "http://example.org/singlevaluedStringUntagged",
        "@type": "http://www.w3.org/2001/XMLSchema#string",
      },
      singlevaluedStringTagged: {
        "@id": "http://example.org/singlevaluedStringTagged",
        "@type": "http://www.w3.org/2001/XMLSchema#string",
      },
      dateTimeProperty: {
        "@id": "http://example.org/dateTimeProperty",
        "@type": "http://www.w3.org/2001/XMLSchema#dateTime",
      },
      integerProperty: {
        "@id": "http://example.org/integerProperty",
        "@type": "http://www.w3.org/2001/XMLSchema#integer",
      },
      multivaluedStringUntagged: {
        "@id": "http://example.org/multivaluedStringUntagged",
        "@type": "http://www.w3.org/2001/XMLSchema#string",
        "@isCollection": true,
      },
      multivaluedStringTagged: {
        "@id": "http://example.org/multivaluedStringTagged",
        "@type": "http://www.w3.org/2001/XMLSchema#string",
        "@isCollection": true,
      },
      intermediateNodeLink: {
        "@id": "http://example.org/intermediateNodeLink",
        "@type": "@id",
      },
      sharedProperty: {
        "@id": "http://example.org/sharedProperty",
        "@type": "http://www.w3.org/2001/XMLSchema#string",
      },
      type: {
        "@id": "@type",
      },
    },
  },
};
