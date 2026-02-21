import { ContextDefinition } from "jsonld";

/**
 * =============================================================================
 * Typescript Typings for test
 * =============================================================================
 */

/**
 * IntermediateNode Type
 */
export interface IntermediateNode {
  "@id"?: string;
  "@context"?: ContextDefinition;
  intermediateSinglevaluedStringUntagged?: string;
  intermediateSinglevaluedStringTagged?: string;
  intermediateMultivaluedStringUntagged?: string[];
  intermediateMultivaluedStringTagged?: string[];
  sharedProperty?: string;
  type?: {
    "@id": "IntermediateNodeclass";
  };
}

/**
 * Test Type
 */
export interface Test {
  "@id"?: string;
  "@context"?: ContextDefinition;
  singlevaluedStringUntagged?: string;
  singlevaluedStringTagged?: string;
  dateTimeProperty?: string;
  integerProperty?: number;
  multivaluedStringUntagged?: string[];
  multivaluedStringTagged?: string[];
  intermediateNodeLink?: IntermediateNode;
  sharedProperty?: string;
  type?: {
    "@id": "Testclass";
  };
}
