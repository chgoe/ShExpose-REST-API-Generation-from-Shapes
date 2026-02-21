# ShExpose

**ShExpose your RDF data via a REST API leveraging ShEx shapes.**

ShExpose dynamically generates fully-documented REST API endpoints from [ShEx (Shape Expressions)](https://shex.io/) schemas, enabling CRUD access to RDF knowledge graphs without writing any route code. It follows a **LinkML → ShEx → LDO → Express** pipeline.

## Prerequisites

Tested with:
Node v24
Python 3.12


## Installation & Setup

### 1. Clone the repository

```bash
git clone --recurse-submodules <repo-url>
cd ShExpose
```

> The `--recurse-submodules` flag is required to fetch the `submodules/shex2sparql/` dependency.

### 2. Install Node.js dependencies

```bash
npm install
```

### 3. Configure the application

Copy the example config and edit it:

```bash
cp config/config.example.yaml config/config.yaml
```

### 4. Prepare ShEx schemas and generate types

```bash
npm run prepare:shex
```

This command will:
1. Create a Python virtual environment (`venv/`) if not already present
2. Install LinkML's `gen-shex` inside the venv
3. Merge shape fragments and generate `.shex` files
4. Run `@ldo/cli` to produce TypeScript types in `resources/ldo/`
5. Build `resources/shapes/slot-to-shex-mapping.json`

> **Re-run `npm run prepare:shex` every time you modify a YAML schema file.**

### 5. Start the server

```bash
npm start
```

The server will scan `resources/shapes/*.shex`, generate all routes, and listen on the configured port (default: `3000`).

---

## API Endpoints

Routes are generated automatically for every shape found in `resources/shapes/`. Given a shape called `Person`, the following endpoints are created:

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/{shape}/:uri/` | Retrieve all attributes of a resource |
| `GET` | `/{shape}/:uri/{attribute}` | Retrieve a single attribute value |
| `POST` | `/{shape}/` | Create a new resource |
| `POST` | `/{shape}/:uri/{attribute}` | Add a value to an attribute |
| `PUT` | `/{shape}/:uri/` | Replace all attributes of a resource |
| `PUT` | `/{shape}/:uri/{attribute}` | Replace a single attribute value |
| `DELETE` | `/{shape}/:uri/` | Delete a resource |
| `DELETE` | `/{shape}/:uri/{attribute}` | Delete a single attribute value |

`:uri` must be a URL-encoded RDF subject URI.

**Example:**
```
GET /person/https%3A%2F%2Fexample.org%2Fperson-42/givenName
```

### OpenAPI Documentation

Interactive API documentation is available at:
```
GET /api-docs
```

## Adding a New Entity Type

1. Create a directory `resources/shapes/{entity}/`
2. Add LinkML YAML fragment files (e.g., `{entity}_base.yaml`, `{entity}_literals.yaml`, …)
3. Run `npm run prepare:shex` — ShEx schemas, TypeScript types, and mappings are generated automatically
4. Start the server — endpoints for the new entity are registered on startup

> The YAML filename, the class name inside the YAML, and the last segment of the shape URI must all match.

---

## Custom Attribute Names

Long predicate property chains can be aliased in `config/overwrite-mappings.yaml`. This can also be used when the flattening of the chains causes collisions:

```yaml
overwriteMappings:
  - path:
      - "http://www.w3.org/2006/vcard/ns#hasName"
      - "http://www.w3.org/2006/vcard/ns#givenName"
    name: "givenName"
```

Without an override, the attribute name defaults to the last URI segment of the outermost predicate.
