import { Schema } from "shexj";

/**
 * =============================================================================
 * testSchema: ShexJ Schema for test
 * =============================================================================
 */
export const testSchema: Schema = {
  type: "Schema",
  start: "http://example.org/Test",
  shapes: [
    {
      id: "http://example.org/IntermediateNode",
      type: "ShapeDecl",
      shapeExpr: {
        type: "Shape",
        expression: {
          type: "EachOf",
          expressions: [
            {
              id: "http://example.org/IntermediateNode_tes",
              type: "EachOf",
              expressions: [
                {
                  type: "TripleConstraint",
                  predicate:
                    "http://example.org/intermediateSinglevaluedStringUntagged",
                  valueExpr: {
                    type: "NodeConstraint",
                    datatype: "http://www.w3.org/2001/XMLSchema#string",
                  },
                  min: 0,
                  max: 1,
                },
                {
                  type: "TripleConstraint",
                  predicate:
                    "http://example.org/intermediateSinglevaluedStringTagged",
                  valueExpr: {
                    type: "NodeConstraint",
                    datatype: "http://www.w3.org/2001/XMLSchema#string",
                  },
                  min: 0,
                  max: 1,
                },
                {
                  type: "TripleConstraint",
                  predicate:
                    "http://example.org/intermediateMultivaluedStringUntagged",
                  valueExpr: {
                    type: "NodeConstraint",
                    datatype: "http://www.w3.org/2001/XMLSchema#string",
                  },
                  min: 0,
                  max: -1,
                },
                {
                  type: "TripleConstraint",
                  predicate:
                    "http://example.org/intermediateMultivaluedStringTagged",
                  valueExpr: {
                    type: "NodeConstraint",
                    datatype: "http://www.w3.org/2001/XMLSchema#string",
                  },
                  min: 0,
                  max: -1,
                },
                {
                  type: "TripleConstraint",
                  predicate: "http://example.org/sharedProperty",
                  valueExpr: {
                    type: "NodeConstraint",
                    datatype: "http://www.w3.org/2001/XMLSchema#string",
                  },
                  min: 0,
                  max: 1,
                },
              ],
            },
            {
              type: "TripleConstraint",
              predicate: "http://www.w3.org/1999/02/22-rdf-syntax-ns#type",
              valueExpr: {
                type: "NodeConstraint",
                values: ["http://example.org/IntermediateNodeclass"],
              },
              min: 0,
              max: 1,
            },
          ],
        },
        closed: true,
      },
    },
    {
      id: "http://example.org/Test",
      type: "ShapeDecl",
      shapeExpr: {
        type: "Shape",
        expression: {
          type: "EachOf",
          expressions: [
            {
              id: "http://example.org/Test_tes",
              type: "EachOf",
              expressions: [
                {
                  type: "TripleConstraint",
                  predicate: "http://example.org/singlevaluedStringUntagged",
                  valueExpr: {
                    type: "NodeConstraint",
                    datatype: "http://www.w3.org/2001/XMLSchema#string",
                  },
                  min: 0,
                  max: 1,
                },
                {
                  type: "TripleConstraint",
                  predicate: "http://example.org/singlevaluedStringTagged",
                  valueExpr: {
                    type: "NodeConstraint",
                    datatype: "http://www.w3.org/2001/XMLSchema#string",
                  },
                  min: 0,
                  max: 1,
                },
                {
                  type: "TripleConstraint",
                  predicate: "http://example.org/dateTimeProperty",
                  valueExpr: {
                    type: "NodeConstraint",
                    datatype: "http://www.w3.org/2001/XMLSchema#dateTime",
                  },
                  min: 0,
                  max: 1,
                },
                {
                  type: "TripleConstraint",
                  predicate: "http://example.org/integerProperty",
                  valueExpr: {
                    type: "NodeConstraint",
                    datatype: "http://www.w3.org/2001/XMLSchema#integer",
                  },
                  min: 0,
                  max: 1,
                },
                {
                  type: "TripleConstraint",
                  predicate: "http://example.org/multivaluedStringUntagged",
                  valueExpr: {
                    type: "NodeConstraint",
                    datatype: "http://www.w3.org/2001/XMLSchema#string",
                  },
                  min: 0,
                  max: -1,
                },
                {
                  type: "TripleConstraint",
                  predicate: "http://example.org/multivaluedStringTagged",
                  valueExpr: {
                    type: "NodeConstraint",
                    datatype: "http://www.w3.org/2001/XMLSchema#string",
                  },
                  min: 0,
                  max: -1,
                },
                {
                  type: "TripleConstraint",
                  predicate: "http://example.org/intermediateNodeLink",
                  valueExpr: "http://example.org/IntermediateNode",
                  min: 0,
                  max: 1,
                },
                {
                  type: "TripleConstraint",
                  predicate: "http://example.org/sharedProperty",
                  valueExpr: {
                    type: "NodeConstraint",
                    datatype: "http://www.w3.org/2001/XMLSchema#string",
                  },
                  min: 0,
                  max: 1,
                },
              ],
            },
            {
              type: "TripleConstraint",
              predicate: "http://www.w3.org/1999/02/22-rdf-syntax-ns#type",
              valueExpr: {
                type: "NodeConstraint",
                values: ["http://example.org/Testclass"],
              },
              min: 0,
              max: 1,
            },
          ],
        },
        closed: true,
      },
    },
  ],
};
