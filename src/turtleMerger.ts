export class TurtleMerger {
    private prefixes: Map<string, string>;
    private bodies: string[];
    
    constructor() {
        this.prefixes = new Map();
        this.bodies = [];
    }
    
    addTurtle(turtleData: string): void {
        const lines = turtleData.split('\n');
        const prefixLines: string[] = [];
        const bodyLines: string[] = [];
        
        let inPrefixSection = true;
        
        for (const line of lines) {
            const trimmed = line.trim();
            
            if (trimmed.startsWith('@prefix')) {
                prefixLines.push(line);
            } else if (trimmed === '' && inPrefixSection) {
                // empty line
                continue;
            } else {
                inPrefixSection = false;
                bodyLines.push(line);
            }
        }
        
        // ensure unique prefixes
        for (const prefixLine of prefixLines) {
            const match = prefixLine.match(/@prefix\s+(\w+):\s+<([^>]+)>\s*\./);
            if (match) {
                const [, prefix, uri] = match;
                if (!this.prefixes.has(prefix)) {
                    this.prefixes.set(prefix, uri);
                }
            }
        }
        
        // add body content, we do not care about uniqueness here
        const body = bodyLines.join('\n').trim();
        if (body) {
            this.bodies.push(body);
        }
    }
    
    getMergedTurtle(): string {
        const prefixSection = Array.from(this.prefixes.entries())
            .map(([prefix, uri]) => `@prefix ${prefix}: <${uri}> .`)
            .join('\n');
        
        const bodySection = this.bodies.join('\n');
        
        if (prefixSection && bodySection) {
            return `${prefixSection}\n\n${bodySection}`;
        } else if (prefixSection) {
            return prefixSection;
        } else {
            return bodySection;
        }
    }

    isEmpty(): boolean {
        return this.bodies.length === 0;
    }
}
