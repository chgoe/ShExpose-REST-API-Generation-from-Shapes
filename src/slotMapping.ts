import * as fs from 'fs';
import * as path from 'path';

const SHAPES_DIR = "resources/shapes/";

/**
 * Cached mapping data to avoid repeated file reads
 * Structure: { entityName: { path: shexFile } }
 * where path is either a custom name defined in the overwrite mappings or pipe-separated URIs
 */
let cachedGlobalMapping: Record<string, Record<string, string>> | null = null;

function loadSlotMapping(): Record<string, Record<string, string>> {
    if (cachedGlobalMapping !== null) {
        return cachedGlobalMapping;
    }
    
    const mappingPath = path.join(SHAPES_DIR, 'slot-to-shex-mapping.json');
    
    try {
        const content = fs.readFileSync(mappingPath, 'utf8');
        cachedGlobalMapping = JSON.parse(content);
        return cachedGlobalMapping!;
    } catch (error) {
        throw new Error(`Failed to load slot-to-shex mapping from ${mappingPath}. ` +
                       `Make sure to run 'npm run prepare:shex' first. Error: ${error}`);
    }
}

/**
 * Get the .shex file for a specific property path
 * @param entityName - The name of the entity
 * @param propertyPath - Either a custom path name or an array of URIs
 * @returns The .shex filename that contains this path, or null if not found
 */
export function getShexFileForPath(
    entityName: string, 
    propertyPath: string | string[]
): string | null {
    const mapping = loadSlotMapping();
    
    if (!mapping[entityName]) {
        return null;
    }
    
    // Convert array path to pipe-separated string
    const pathKey = Array.isArray(propertyPath) 
        ? propertyPath.join('|')
        : propertyPath;
    
    return mapping[entityName][pathKey] || null;
}
