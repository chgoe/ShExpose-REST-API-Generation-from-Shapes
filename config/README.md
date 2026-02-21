# Overwrite Mappings Configuration

This document explains how to configure custom predicate path mappings in the `config/overwrite-mappings.yaml` file.

## Overview

The overwrite mappings allow developers to customize the names used for specific predicate paths when extracting data from RDF shapes. Instead of using the default names from the JSON-LD context, you can define more meaningful or simplified names.

## Configuration File Format

The configuration file is located at `config/overwrite-mappings.yaml` and follows this structure:

```yaml
overwriteMappings:
  - path:
      - "predicate1_uri"
      - "predicate2_uri"
      - "predicate3_uri"
    name: "customName"
```

## Configuration Properties

- `overwriteMappings`: An array of mapping objects
- `path`: An array of predicate URIs that form the path to be overwritten
- `name`: The custom name to use
