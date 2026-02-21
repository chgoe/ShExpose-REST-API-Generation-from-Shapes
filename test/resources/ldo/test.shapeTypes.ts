import { ShapeType } from "@ldo/ldo";
import { testSchema } from "./test.schema";
import { testContext } from "./test.context";
import { IntermediateNode, Test } from "./test.typings";

/**
 * =============================================================================
 * LDO ShapeTypes test
 * =============================================================================
 */

/**
 * IntermediateNode ShapeType
 */
export const IntermediateNodeShapeType: ShapeType<IntermediateNode> = {
  schema: testSchema,
  shape: "http://example.org/IntermediateNode",
  context: testContext,
};

/**
 * Test ShapeType
 */
export const TestShapeType: ShapeType<Test> = {
  schema: testSchema,
  shape: "http://example.org/Test",
  context: testContext,
};
