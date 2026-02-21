import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import { glob } from 'glob';
import * as readline from 'readline';
import * as yaml from 'js-yaml';

const execAsync = promisify(exec);

const SHAPES_DIR = "resources/shapes/";
const LDO_DIR = "resources/ldo/";

interface OverwriteMapping {
    path: string[];
    name: string;
}

interface OverwriteMappingsConfig {
    overwriteMappings: OverwriteMapping[];
}

async function checkVenvExists(): Promise<boolean> {
    try {
        await fs.promises.access('venv', fs.constants.F_OK);
        return true;
    } catch {
        return false;
    }
}

async function promptUserToCreateVenv(): Promise<boolean> {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    return new Promise((resolve) => {
        rl.question('Virtual environment (venv) not found. Would you like to create one? (y/N): ', (answer) => {
            rl.close();
            resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
        });
    });
}

async function createVirtualEnvironment(): Promise<void> {
    try {
        console.log('Creating virtual environment...');
        await execAsync('python3 -m venv venv');
        console.log('Virtual environment created successfully.');
    } catch (error) {
        console.error('Error creating virtual environment:', error);
        throw new Error('Failed to create virtual environment. Please ensure python3 is installed.');
    }
}

async function ensureVirtualEnvironment(): Promise<void> {
    const venvExists = await checkVenvExists();
    
    if (!venvExists) {
        console.log('Virtual environment not found.');
        const shouldCreate = await promptUserToCreateVenv();
        
        if (shouldCreate) {
            await createVirtualEnvironment();
        } else {
            console.log('Proceeding without virtual environment (will use global Python packages).');
        }
    } else {
        console.log('Virtual environment found.');
    }
}

async function checkGenShexAvailable(): Promise<{ available: boolean }> {
    const venvExists = await checkVenvExists();
    
    if (venvExists) {
        try {
            await execAsync('venv/bin/gen-shex --help');
            return { available: true };
        } catch (error) {
            return { available: false };
        }
    }
    return { available: false };
}

async function promptUserToInstallLinkML(): Promise<boolean> {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    return new Promise((resolve) => {
        rl.question('LinkML (gen-shex) is not installed. Would you like to install it with "pip install linkml"? (y/N): ', (answer) => {
            rl.close();
            resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
        });
    });
}

async function installLinkML(): Promise<void> {
    const installCmd = 'venv/bin/pip install linkml';
    try {
        console.log('Installing LinkML...');

        await execAsync(installCmd);
        console.log('LinkML installed successfully in virtual environment.');
    } catch (error) {
        console.error('Error installing LinkML:', error);
        throw new Error(`Failed to install LinkML. Please install it manually with "${installCmd}"`);
    }
}1

async function ensureGenShexAvailable(): Promise<void> {
    const { available } = await checkGenShexAvailable();
    
    if (!available) {
        console.log('gen-shex command not found.');
        const shouldInstall = await promptUserToInstallLinkML();
        
        if (shouldInstall) {
            await installLinkML();
            
            // verify installation worked
            const { available: isNowAvailable } = await checkGenShexAvailable();
            if (!isNowAvailable) {
                throw new Error('LinkML installation failed or gen-shex is still not available');
            }
            console.log('gen-shex is now available.');
        } else {
            throw new Error('gen-shex is required but not installed. Please install LinkML with "pip install linkml"');
        }
    }    
}

async function mergeYamlFilesForEntities(): Promise<void> {
    try {
        console.log('Merging YAML files for entities...');
        
        // find all entities (=> subdirs) in SHAPES_DIR
        const entities = await fs.promises.readdir(SHAPES_DIR, { withFileTypes: true });
        const entityDirs = entities
            .filter(entry => entry.isDirectory())
            .map(entry => path.join(SHAPES_DIR, entry.name));
        
        for (const entityDir of entityDirs) {
            const entityName = path.basename(entityDir);
            console.log(`Processing entity: ${entityName}`);
            
            const yamlFiles = await glob(path.join(entityDir, "*.yaml"));
            
            if (yamlFiles.length < 2) {
                console.log(`  No YAML files to merge found in ${entityDir}, skipping.`);
                continue;
            }
            
            // we only care about the following parts of the schema:
            const mergedSchema: any = {
                id: '',
                name: entityName,
                prefixes: {},
                default_prefix: entityName,
                classes: {},
                slots: {},
                types: {}
            };
            
            // read and merge all YAML files
            for (const yamlFile of yamlFiles) {
                const filename = path.basename(yamlFile);
                
                // skip the $entityName.yaml file if it already exists
                if (filename === `${entityName}.yaml`) {
                    continue;
                }
                
                console.log(`  Merging ${filename}...`);
                
                const fileContent = await fs.promises.readFile(yamlFile, 'utf8');
                const schema: any = yaml.load(fileContent);
                
                // id is not interesting, just use the first one we find
                if (schema.id && !mergedSchema.id) {
                    mergedSchema.id = schema.id;
                }
                
                // merge prefixes
                if (schema.prefixes) {
                    mergedSchema.prefixes = { ...mergedSchema.prefixes, ...schema.prefixes };
                }
                
                // merge classes
                if (schema.classes) {
                    for (const [className, classData] of Object.entries(schema.classes)) {
                        if (mergedSchema.classes[className]) {
                            // if class already exists, merge the slots
                            const existingClass = mergedSchema.classes[className] as any;
                            const newClass = classData as any;
                            
                            if (newClass.slots) {
                                existingClass.slots = existingClass.slots || [];
                                // add new slots, avoiding duplicates
                                for (const slot of newClass.slots) {
                                    if (!existingClass.slots.includes(slot)) {
                                        existingClass.slots.push(slot);
                                    }
                                }
                            }
                        } else {
                            // add new class
                            mergedSchema.classes[className] = classData;
                        }
                    }
                }
                
                // merge slots
                if (schema.slots) {
                    mergedSchema.slots = { ...mergedSchema.slots, ...schema.slots };
                }
                
                // merge types
                if (schema.types) {
                    mergedSchema.types = { ...mergedSchema.types, ...schema.types };
                }
            }
            
            // write the merged schema to $entityName.yaml
            const outputPath = path.join(entityDir, `${entityName}.yaml`);
            const yamlOutput = yaml.dump(mergedSchema, {
                indent: 2,
                lineWidth: -1,
                noRefs: true
            });
            
            await fs.promises.writeFile(outputPath, yamlOutput, 'utf8');
            console.log(`  Created ${outputPath}`);
        }
        
        console.log('YAML merging completed.');
    } catch (error) {
        console.error('Error merging YAML files:', error);
        throw error;
    }
}

function loadOverwriteMappings(): Map<string, string> {
    const configPath = 'config/overwrite-mappings.yaml';
    const mappings = new Map<string, string>();
    
    try {
        const content = fs.readFileSync(configPath, 'utf8');
        const config = yaml.load(content) as OverwriteMappingsConfig;
        
        if (config.overwriteMappings) {
            for (const mapping of config.overwriteMappings) {
                const pathKey = mapping.path.join('|');
                mappings.set(pathKey, mapping.name);
            }
        }
    } catch (error) {
        console.warn(`Warning: Could not load overwrite mappings from ${configPath}:`, error);
    }
    
    return mappings;
}

async function generateSlotToShexMapping(): Promise<void> {
    try {
        console.log('Generating slot-to-shex mapping...');
        
        const overwriteMappings = loadOverwriteMappings();
        
        // find all entities (=> subdirs) in SHAPES_DIR
        const entities = await fs.promises.readdir(SHAPES_DIR, { withFileTypes: true });
        const entityDirs = entities
            .filter(entry => entry.isDirectory())
            .map(entry => path.join(SHAPES_DIR, entry.name));
        
        // global mapping structure: { entityName: { path: shexFile } }
        const globalMapping: Record<string, Record<string, string>> = {};
        
        for (const entityDir of entityDirs) {
            const entityName = path.basename(entityDir);
            console.log(`Mapping slots for entity: ${entityName}`);
            
            const yamlFiles = await glob(path.join(entityDir, "*.yaml"));
            
            if (yamlFiles.length === 0) {
                console.log(`  No YAML files found in ${entityDir}, skipping.`);
                continue;
            }
            
            // entity-specific mapping: { path: shexFile }
            const entityMapping: Record<string, string> = {};
            
            for (const yamlFile of yamlFiles) {
                const filename = path.basename(yamlFile);
                
                // skip the merged $entityName.yaml file
                if (filename === `${entityName}.yaml`) {
                    continue;
                }
                
                const baseName = path.parse(filename).name;
                const shexFileName = `${baseName}.shex`;
                
                console.log(`  Processing ${filename}...`);
                
                const fileContent = await fs.promises.readFile(yamlFile, 'utf8');
                const schema: any = yaml.load(fileContent);
                
                if (!schema.classes || !schema.slots) {
                    console.log(`    No classes or slots found, skipping.`);
                    continue;
                }
                
                // find the root class (== capitalized entity name)
                const rootClassName = entityName.charAt(0).toUpperCase() + entityName.slice(1);
                const rootClass = schema.classes[rootClassName];
                
                if (!rootClass) {
                    console.log(`    Root class ${rootClassName} not found, skipping.`);
                    continue;
                }
                
                const paths = traverseSchema(rootClassName, schema, [], overwriteMappings);
                
                // map each path to this shex file
                for (const pathInfo of paths) {
                    const pathKey = pathInfo.name || pathInfo.uris.join('|');
                    
                    if (!entityMapping[pathKey]) {
                        entityMapping[pathKey] = shexFileName;
                    }
                }
                
                console.log(`    Found ${paths.length} paths`);
            }
            
            globalMapping[entityName] = entityMapping;
            
            // write entity-specific mapping to JSON file
            const mappingPath = path.join(entityDir, 'slot-to-shex-mapping.json');
            await fs.promises.writeFile(
                mappingPath,
                JSON.stringify(entityMapping, null, 2),
                'utf8'
            );
            console.log(`  Created ${mappingPath}`);
        }
        
        // write >>global<< mapping to the root SHAPES_DIR
        const globalMappingPath = path.join(SHAPES_DIR, 'slot-to-shex-mapping.json');
        await fs.promises.writeFile(
            globalMappingPath,
            JSON.stringify(globalMapping, null, 2),
            'utf8'
        );
        console.log(`Created global mapping: ${globalMappingPath}`);
        
        console.log('Slot-to-shex mapping completed.');
    } catch (error) {
        console.error('Error generating slot-to-shex mapping:', error);
        throw error;
    }
}

interface PathInfo {
    uris: string[];
    name?: string;
}

function expandPrefixedUri(prefixedUri: string, prefixes: Record<string, string>): string {
    // if already full URI (contains ://), then return as-is
    if (prefixedUri.includes('://')) {
        return prefixedUri;
    }
    
    const colonIndex = prefixedUri.indexOf(':');
    if (colonIndex === -1) {
        return prefixedUri;
    }
    
    const prefix = prefixedUri.substring(0, colonIndex);
    const localPart = prefixedUri.substring(colonIndex + 1);
    
    const namespace = prefixes[prefix];
    if (namespace) {
        return namespace + localPart;
    }
    
    return prefixedUri;
}

function traverseSchema(
    className: string,
    schema: any,
    currentPath: string[],
    overwriteMappings: Map<string, string>,
    visited: Set<string> = new Set()
): PathInfo[] {
    const paths: PathInfo[] = [];
    
    // prevent infinite recursion
    const visitKey = `${className}:${currentPath.join('|')}`;
    if (visited.has(visitKey)) {
        return paths;
    }
    visited.add(visitKey);
    
    const classData = schema.classes[className];
    if (!classData || !classData.slots) {
        return paths;
    }
    
    const prefixes = schema.prefixes || {};
    
    for (const slotName of classData.slots) {
        const slotData = schema.slots[slotName];
        if (!slotData || !slotData.slot_uri) {
            continue;
        }
        
        // expand the slot URI to full form for consistency
        const expandedUri = expandPrefixedUri(slotData.slot_uri, prefixes);
        const newPath = [...currentPath, expandedUri];
        
        // check if this slot has a range (i.e., points to another class)
        if (slotData.range && schema.classes[slotData.range]) {
            // this slot points to another class, recurse into it
            const nestedPaths = traverseSchema(
                slotData.range,
                schema,
                newPath,
                overwriteMappings,
                visited
            );
            paths.push(...nestedPaths);
        } else {
            // this is a leaf node (literal or no defined range)
            // => check if there's an overwrite mapping for this path using full URIs
            const expandedPathKey = newPath.join('|');
            const overwriteName = overwriteMappings.get(expandedPathKey);
            
            if (overwriteName) {
                paths.push({ uris: newPath, name: overwriteName });
            } else {
                paths.push({ uris: newPath });
            }
        }
    }
    
    return paths;
}

async function generateShexFromYaml(): Promise<void> {
    try {
        console.log('Generating ShEx from YAML files...');
        
        const topLevelYamlFiles = await glob(path.join(SHAPES_DIR, "*.yaml"));
        for (const yamlFile of topLevelYamlFiles) {
            const baseName = path.parse(yamlFile).name;
            const shexFile = path.join(SHAPES_DIR, `${baseName}.shex`);
            
            console.log(`Generating ${shexFile} from ${yamlFile}...`);
            
            const genShexCmd = 'venv/bin/gen-shex';
            const command = `${genShexCmd} ${yamlFile} > ${shexFile}`;
            await execAsync(command);
        }
        
        const entityYamlFiles = await glob(path.join(SHAPES_DIR, "*/*.yaml"));
        for (const yamlFile of entityYamlFiles) {
            const baseName = path.parse(yamlFile).name;
            const entityDir = path.dirname(yamlFile);
            const entityName = path.basename(entityDir);
            const shexFile = path.join(entityDir, `${baseName}.shex`);
            
            // skip the $entityName.yaml file as it is result of a merge from all others
            if (baseName === entityName) {
                console.log(`Skipping merged file ${yamlFile} (will be processed from top-level if needed)...`);
                continue;
            }
            
            console.log(`Generating ${shexFile} from ${yamlFile}...`);
            
            const genShexCmd = 'venv/bin/gen-shex';
            const command = `${genShexCmd} ${yamlFile} > ${shexFile}`;
            await execAsync(command);
        }
        
        console.log('ShEx generation completed.');
    } catch (error) {
        console.error('Error generating ShEx from YAML:', error);
        throw error;
    }
}

async function postProcessShexFiles(): Promise<void> {
    try {
        const shexFiles = await glob(path.join(SHAPES_DIR, "**/*.shex"));
        
        for (const shexFile of shexFiles) {
            console.log(`Post-processing ${shexFile}...`);
            
            let data = await fs.promises.readFile(shexFile, 'utf8');
            
            data = data.replace(/<String> xsd:string/g, "");
            data = data.replace(/<LangString> rdf:langString/g, "");
            data = data.replace(/<DateTime> xsd:dateTime/g, "");
            data = data.replace(/<Integer> xsd:integer/g, "");
            data = data.replace(/<Int> xsd:int/g, "");
            data = data.replace(/<AnyURI> IRI/g, "");
            data = data.replace(/@<AnyURI>/g, "xsd:anyURI");
            data = data.replace(/@<DateTime>/g, "xsd:dateTime");
            data = data.replace(/@<String>/g, "xsd:string");
            data = data.replace(/@<LangString>/g, "rdf:langString");
            data = data.replace(/@<Integer>/g, "xsd:integer");
            data = data.replace(/@<Int>/g, "xsd:int");
            
            let shapeName: string;
            
            const relativeDir = path.relative(SHAPES_DIR, path.dirname(shexFile));
            if (relativeDir === '' || relativeDir === '.') {
                // for full shapes in SHAPES_DIR
                shapeName = path.basename(shexFile, '.shex');
            } else {
                // shape fragments in subdirs
                shapeName = path.basename(path.dirname(shexFile));
            }
            
            shapeName = shapeName.charAt(0).toUpperCase() + shapeName.slice(1);
            if (!data.endsWith(`start=@<${shapeName}>`)) {
                data += `\n\nstart=@<${shapeName}>`;
            }
            
            await fs.promises.writeFile(shexFile, data, 'utf8');
        }
    } catch (error) {
        console.error('Error post-processing ShEx files:', error);
        throw error;
    }
}

async function buildLdo(): Promise<void> {
    try {
        console.log('Building LDO...');

        const command = `ldo build --input ${SHAPES_DIR} --output ${LDO_DIR}`;
        await execAsync(command);
        
        console.log('LDO build completed successfully.');
    } catch (error) {
        console.error('Error building LDO:', error);
        throw error;
    }
}

async function main(): Promise<void> {
    try {
        console.log('Starting ShEx preparation process...');
        
        await ensureVirtualEnvironment();
        await ensureGenShexAvailable();
        
        await mergeYamlFilesForEntities();
        await generateSlotToShexMapping();
        await generateShexFromYaml();
        await postProcessShexFiles();
        await buildLdo();
        
        console.log('ShEx preparation completed successfully!');
    } catch (error) {
        console.error('ShEx preparation failed:', error);
        process.exit(1);
    }
}

main();
