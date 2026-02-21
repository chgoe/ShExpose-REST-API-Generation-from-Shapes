import fs from 'node:fs/promises';
import yaml from 'js-yaml';

interface Config {
    app: {
        port: number;
    };
    rdf: {
        sparql_endpoint: string;
        auth?: {
            username: string;
            password: string;
        };
        qlever_token?: string;
    };
    data: {
        base_uri?: string;
    };
    debug?: {
        do_sparql_update?: boolean;
    };
}

const config = yaml.load(await fs.readFile("config/config.yaml", "utf-8")) as Config;

export default config;