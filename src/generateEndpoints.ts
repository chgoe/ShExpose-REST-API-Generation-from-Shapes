import express, { Express, Request, Response } from "express";
import { handleGET,
    handlePUT,
    handlePOST,
    handleDELETE,
    handleShapeGET,
    handleShapePUT,
    handleShapePOST,
    handleShapeDELETE } from "./requestHandler";
import { loadOverwriteMappings, findPredicatesForShape, extractTypeUri, buildIntermediateTypeMap } from './utils';
import fs from 'node:fs/promises';
import path from 'path';
import parser from "@shexjs/parser";
import config from './config';
import { 
    validateUriParam, 
    createAttributeUpdateBodyValidator,
    createShapeUpdateBodyValidator,
    registerOpenApiPaths, 
    setupOpenApiEndpoint 
} from './validation';


const app: Express = express();
app.use(express.json());

type HandlerResponse = {
    status: number;
    body?: any;
};

function sendHandlerResponse(res: Response, result: HandlerResponse) {
    if (typeof result.body === "undefined") {
        res.sendStatus(result.status);
        return;
    }
    res.status(result.status).send(result.body);
}


function generateRouteGET(shape: any) {
    for(let shapeAttrPath of Object.keys(shape.shapeAttrs)) {
        const shapeAttrPathEnding = shapeAttrPath.split(/[\/#]/).slice(-1)[0];
        console.log("Generating GET route for "+shape.label+"/:uri/"+shapeAttrPathEnding);
        app.get(`/${shape.label}/:uri/${shapeAttrPathEnding}`, validateUriParam, (req: Request, res: Response) => {
            handleGET(shape, shapeAttrPath, req.params.uri).then((result) => {
                sendHandlerResponse(res, result);
            }).catch((error) => {
                res.status(500).json({ error: "Internal server error", message: error.message });
            });
        });
    }
    console.log("Generating GET route for "+shape.label+"/:uri/");
    app.get(`/${shape.label}/:uri/`, validateUriParam, (req: Request, res: Response) => {
        handleShapeGET(shape, req.params.uri).then((result) => {
            sendHandlerResponse(res, result);
        }).catch((error) => {
            res.status(500).json({ error: "Internal server error", message: error.message });
        });
    });
}

function generateRoutePUT(shape: any, schema: any) {
    // Attribute-level PUT: /:uri/:attribute
    for(let shapeAttrPath of Object.keys(shape.shapeAttrs)) {
        const shapeAttrPathEnding = shapeAttrPath.split(/[\/#]/).slice(-1)[0];
        const attrPath = shape.shapeAttrs[shapeAttrPath].path;
        const attrValidator = createAttributeUpdateBodyValidator(attrPath, schema);
        console.log("Generating PUT route for "+shape.label+"/:uri/"+shapeAttrPathEnding);
        app.put(`/${shape.label}/:uri/${shapeAttrPathEnding}`, validateUriParam, attrValidator, (req: Request, res: Response) => {
            handlePUT(shape, shapeAttrPath, req).then((result) => {
                sendHandlerResponse(res, result);
            }).catch((error) => {
                res.status(500).json({ error: "Internal server error", message: error.message });
            });
        });
    }
    
    // Shape-level PUT: /:uri/ (update multiple attributes, remove old ones)
    const shapeBodyValidator = createShapeUpdateBodyValidator(shape.shapeAttrs, schema);
    console.log("Generating PUT route for "+shape.label+"/:uri/");
    app.put(`/${shape.label}/:uri/`, validateUriParam, shapeBodyValidator, (req: Request, res: Response) => {
        handleShapePUT(shape, req).then((result) => {
            sendHandlerResponse(res, result);
        }).catch((error) => {
            res.status(500).json({ error: "Internal server error", message: error.message });
        });
    });
}

function generateRoutePOST(shape: any, schema: any) {
    for(let shapeAttrPath of Object.keys(shape.shapeAttrs)) {
        const shapeAttrPathEnding = shapeAttrPath.split(/[\/#]/).slice(-1)[0];
        const attrPath = shape.shapeAttrs[shapeAttrPath].path;
        const attrValidator = createAttributeUpdateBodyValidator(attrPath, schema);
        console.log("Generating POST route for "+shape.label+"/:uri/"+shapeAttrPathEnding);
        app.post(`/${shape.label}/:uri/${shapeAttrPathEnding}`, validateUriParam, attrValidator, (req: Request, res: Response) => {
            handlePOST(shape, shapeAttrPath, req).then((result) => {
                sendHandlerResponse(res, result);
            }).catch((error) => {
                res.status(500).json({ error: "Internal server error", message: error.message });
            });
        });
    }
    
    const shapeBodyValidator = createShapeUpdateBodyValidator(shape.shapeAttrs, schema);
    console.log("Generating POST route for "+shape.label);
    app.post(`/${shape.label}/`, shapeBodyValidator, (req: Request, res: Response) => {
        handleShapePOST(shape, req).then((result) => {
            sendHandlerResponse(res, result);
        }).catch((error) => {
            res.status(500).json({ error: "Internal server error", message: error.message });
        });
    });
}

function generateRouteDELETE(shape: any) {
    for(let shapeAttrPath of Object.keys(shape.shapeAttrs)) {
        const shapeAttrPathEnding = shapeAttrPath.split(/[\/#]/).slice(-1)[0];
        console.log("Generating DELETE route for "+shape.label+"/:uri/"+shapeAttrPathEnding);
        app.delete(`/${shape.label}/:uri/${shapeAttrPathEnding}`, validateUriParam, (req: Request, res: Response) => {
            handleDELETE(shape, shapeAttrPath, req.params.uri).then((result) => {
                sendHandlerResponse(res, result);
            }).catch((error) => {
                res.status(500).json({ error: "Internal server error", message: error.message });
            });
        });
    }
    console.log("Generating DELETE route for "+shape.label+"/:uri/");
    app.delete(`/${shape.label}/:uri/`, validateUriParam, (req: Request, res: Response) => {
        handleShapeDELETE(shape, req.params.uri).then((result) => {
            sendHandlerResponse(res, result);
        }).catch((error) => {
            res.status(500).json({ error: "Internal server error", message: error.message });
        });
    });
}

function generateEndpoints(shape: any, schema: any) {
    // Register OpenAPI documentation for the shape's endpoints
    registerOpenApiPaths(shape.label, shape.shapeAttrs, schema);
    
    // Generate the actual Express routes
    generateRouteGET(shape);
    generateRoutePUT(shape, schema);
    generateRoutePOST(shape, schema);
    generateRouteDELETE(shape);
}

async function init() {
    const overwriteMap = await loadOverwriteMappings('config/overwrite-mappings.yaml');

    const shapesDir = 'resources/shapes';
    const files = await fs.readdir(shapesDir);
    const shexFiles = files.filter(file => file.endsWith('.shex'));

    for (const shexFile of shexFiles) {
        try {
            const baseName = path.basename(shexFile, '.shex');
            const shapeTypesPath = `../resources/ldo/${baseName}.shapeTypes`;

            const shexSchema = await fs.readFile(`${shapesDir}/${shexFile}`, "utf8");

            // @ts-ignore: shexjs/parser quick start also runs constructor without any params
            const schema = parser.construct().parse(shexSchema);

            const shapeTypesModule = await import(shapeTypesPath);

            for (const [exportName, shapeType] of Object.entries(shapeTypesModule)) {

                if (exportName.endsWith('ShapeType') && typeof shapeType === 'object' && shapeType !== null) {
                    const typedShapeType = shapeType as any;

                    if (typedShapeType.shape !== schema.start) {
                        continue;
                    }
                    if (typedShapeType.shape && typedShapeType.schema && typedShapeType.context) {
                        const shapeAttrs = findPredicatesForShape(
                            typedShapeType.shape,
                            typedShapeType.schema.shapes,
                            typedShapeType.context,
                            overwriteMap
                        );
                        const endpointLabel = typedShapeType.shape.split("/").pop()?.toLowerCase();
                        const shape = {
                            label: endpointLabel,
                            shapeAttrs: shapeAttrs,
                            typeUri: extractTypeUri(typedShapeType.schema, typedShapeType.shape),
                            intermediateTypeMap: buildIntermediateTypeMap(typedShapeType.schema, typedShapeType.shape)
                        };
                        generateEndpoints(shape, typedShapeType.schema);
                        console.log(`Generated endpoints for shape: ${endpointLabel}`);
                    }
                }
            }
        } catch (error) {
            console.error(`Error processing ${shexFile}:`, error);
        }
    }
}

init().then(() => {
    // Setup OpenAPI documentation endpoints
    setupOpenApiEndpoint(app);
    
    const port = config.app.port || 3000;
    app.listen(port, () => {
        console.log(`[server]: Server is running at http://localhost:${port}`);
    });
}).catch(error => {
    console.error('Error during initialization:', error);
});