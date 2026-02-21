import argparse
import asyncio
import csv
import math
import os
import random
import sys
import time
from datetime import datetime, timezone
from urllib.parse import quote

import httpx
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import pandas as pd


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

BASE_URL = "http://localhost:3000"
SPARQL_ENDPOINT = "http://localhost:7001/shexpose"
BATCH_SIZE_LEVELS = [5, 10, 15, 20]
TIMEOUT = 30.0

ENTITY_TYPE_URIS = {
    "drittmittelprojekt": "http://kerndatensatz-forschung.de/owl/Basis#Drittmittelprojekt",
    "event":              "http://purl.org/NET/c4dm/event.owl#Event",
    "grossgeraete":       "http://fis.tu-chemnitz.de/ontology/tucfis#Grossgeraete",
    "person":             "http://xmlns.com/foaf/0.1/Person"
}

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
TIMESTAMP  = datetime.now().strftime("%Y%m%d_%H%M%S")
CSV_FILE   = os.path.join(SCRIPT_DIR, f"benchmark_results_{TIMESTAMP}.csv")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def summarise(operation, batch_size, results):
    durations = sorted(r["duration_ms"] for r in results)
    n = len(durations)
    avg = sum(durations) / n if n else 0
    std = math.sqrt(sum((d - avg) ** 2 for d in durations) / n) if n else 0
    return {
        "operation":   operation,
        "batch_size":  batch_size,
        "total":       n,
        "succeeded":   sum(1 for r in results if r["ok"]),
        "failed":      sum(1 for r in results if not r["ok"]),
        "min_ms":      durations[0] if durations else 0,
        "max_ms":      durations[-1] if durations else 0,
        "avg_ms":      round(avg),
        "std_ms":      round(std),
        "total_ms":    round(sum(durations)),
    }


def print_table(results):
    header = ["Operation", "N", "OK", "Fail",
              "Min(ms)", "Avg(ms)", "Std(ms)", "Max(ms)", "Total(ms)"]
    rows = [[r["operation"], str(r["batch_size"]), str(r["succeeded"]), str(r["failed"]),
             str(r["min_ms"]), str(r["avg_ms"]), str(r["std_ms"]),
             str(r["max_ms"]), str(r["total_ms"])]
            for r in results]
    if not rows:
        return
    col_widths = [max(len(header[i]), *(len(row[i]) for row in rows))
                  for i in range(len(header))]
    def fmt(cells):
        return "|".join(f" {c.ljust(w)} " for c, w in zip(cells, col_widths))
    sep = "+".join("-" * (w + 2) for w in col_widths)
    print(fmt(header))
    print(sep)
    for row in rows:
        print(fmt(row))


async def timed_request(client, method, url, **kwargs):
    start = time.perf_counter()
    try:
        resp = await client.request(method, url, timeout=TIMEOUT, **kwargs)
        duration_ms = round((time.perf_counter() - start) * 1000)
        ok = 200 <= resp.status_code < 300
        error = None
        if not ok:
            try:
                print(method, url, error)
                error = resp.text
            except Exception:
                pass
        return {"status": resp.status_code, "duration_ms": duration_ms, "ok": ok, "error": error}
    except Exception as exc:
        duration_ms = round((time.perf_counter() - start) * 1000)
        return {"status": 0, "duration_ms": duration_ms, "ok": False, "error": str(exc)}


async def fetch_uris(client, type_uri):
    query = f"SELECT ?uri WHERE {{ ?uri a <{type_uri}> }}"
    try:
        resp = await client.post(
            SPARQL_ENDPOINT,
            data={"query": query},
            headers={"Accept": "application/sparql-results+json"},
            timeout=TIMEOUT,
        )
        if resp.status_code != 200:
            print(f"  SPARQL {resp.status_code} for <{type_uri}>")
            return []
        data = resp.json()
        return [b["uri"]["value"] for b in data["results"]["bindings"]]
    except Exception as exc:
        print(f"  Failed to fetch URIs for <{type_uri}>: {exc}")
        return []


async def discover_endpoints(client):
    """Returns a dict: entity_name -> endpoint_info"""
    resp = await client.get(f"{BASE_URL}/openapi.json", timeout=TIMEOUT)
    if resp.status_code != 200:
        raise RuntimeError(f"Failed to fetch OpenAPI spec ({resp.status_code}). Is the server running?")
    spec = resp.json()

    entity_map = {}
    for path_str, methods in spec.get("paths", {}).items():
        segments = path_str.lstrip("/").split("/")
        entity = segments[0]
        if not entity:
            continue

        if entity not in entity_map:
            entity_map[entity] = {"entity": entity, "attributes": [], "schema_properties": {}}
        info = entity_map[entity]

        # Attribute names from /{entity}/{uri}/{attribute}
        if len(segments) == 3 and segments[1] == "{uri}":
            attr = segments[2]
            if attr not in info["attributes"]:
                info["attributes"].append(attr)

        # POST body schema from entity root only (no {uri})
        if "{uri}" not in path_str:
            post_def = methods.get("post")
            if post_def:
                props = (post_def
                         .get("requestBody", {})
                         .get("content", {})
                         .get("application/json", {})
                         .get("schema", {})
                         .get("properties", {}))
                if props:
                    info["schema_properties"].update(props)

    return entity_map


# ---------------------------------------------------------------------------
# Body generation
# ---------------------------------------------------------------------------

def _resolve_type(schema_node):
    if not isinstance(schema_node, dict):
        return ""
    if "type" in schema_node:
        return schema_node["type"]
    for key in ("anyOf", "oneOf"):
        for entry in schema_node.get(key, []):
            t = entry.get("type", "")
            if t:
                return t
    return ""


def _make_attr_value(attr, schema_def):
    """Generate a random value for one attribute from its OpenAPI schema definition."""
    props = None
    if isinstance(schema_def, dict):
        props = (schema_def.get("anyOf", [{}])[0].get("properties") or
                 schema_def.get("properties"))

    if not props or "value" not in props:
        return {"value": f"eval-{int(time.time() * 1000)}-{random.getrandbits(16):04x}"}

    value_def    = props["value"]
    has_language = "language" in props
    vtype        = _resolve_type(value_def)

    if vtype in ("number", "integer"):
        return {"value": random.randint(0, 9999)}
    if vtype == "boolean":
        return {"value": random.choice([True, False])}
    if "date" in attr.lower() or "time" in attr.lower() or "duration" in attr.lower():
        return {"value": datetime.now(timezone.utc).isoformat()}

    val = f"eval-{attr}-{int(time.time() * 1000)}-{random.getrandbits(32):08x}"
    return {"value": val, "language": "en"} if has_language else {"value": val}


def generate_body(endpoint):
    """Full-shape POST/PUT body — all attributes filled."""
    schema_props = endpoint["schema_properties"]
    if schema_props:
        return {attr: _make_attr_value(attr, sdef)
                for attr, sdef in schema_props.items()}
    # Fallback: no schema info: use attribute list with lang-tagged strings
    return {attr: {"value": f"eval-{attr}-{int(time.time()*1000)}-{random.getrandbits(32):08x}",
                   "language": "en"}
            for attr in endpoint["attributes"]}


def generate_attribute_body(endpoint, attr):
    schema_def = endpoint["schema_properties"].get(attr)
    body = _make_attr_value(attr, schema_def)
    if isinstance(body.get("value"), str):
        body["value"] = "upd-" + body["value"]
    return body


# ---------------------------------------------------------------------------
# CRUD operations
# ---------------------------------------------------------------------------

async def do_create(client, endpoint):
    return await timed_request(
        client, "POST",
        f"{BASE_URL}/{endpoint['entity']}/",
        json=generate_body(endpoint),
    )


async def do_read(client, endpoint, instances):
    inst = random.choice(instances)
    return await timed_request(
        client, "GET",
        f"{BASE_URL}/{endpoint['entity']}/{quote(inst['uri'], safe='')}/",
    )


async def do_update(client, endpoint, instances):
    inst = random.choice(instances)
    attr = random.choice(inst["attrs"])
    return await timed_request(
        client, "PUT",
        f"{BASE_URL}/{endpoint['entity']}/{quote(inst['uri'], safe='')}/{attr}",
        json=generate_attribute_body(endpoint, attr),
    )


async def do_delete(client, endpoint, uri):
    return await timed_request(
        client, "DELETE",
        f"{BASE_URL}/{endpoint['entity']}/{quote(uri, safe='')}/",
    )


# ---------------------------------------------------------------------------
# Bulk resource creation (batch)
# ---------------------------------------------------------------------------

async def create_resources(client, endpoint, count):
    """Create `count` entities concurrently; return list of created URIs."""
    async def _one():
        try:
            resp = await client.post(
                f"{BASE_URL}/{endpoint['entity']}/",
                json=generate_body(endpoint),
                timeout=TIMEOUT,
            )
            if 200 <= resp.status_code < 300:
                data = resp.json()
                return data.get("uri")
        except Exception:
            pass
        return None

    results = await asyncio.gather(*(_one() for _ in range(count)))
    return [u for u in results if u]


async def fetch_verified_instances(client, endpoint, uris, count=50):
    """GET up to `count` URIs; return instances with their non-null attribute names."""
    sample = random.sample(uris, min(count, len(uris)))

    async def _get_one(uri):
        try:
            resp = await client.get(
                f"{BASE_URL}/{endpoint['entity']}/{quote(uri, safe='')}/",
                timeout=TIMEOUT,
            )
            time.sleep(1)
            if resp.status_code == 200:
                data = resp.json()
                attrs = []
                for attr in endpoint["attributes"]:
                    val = data.get(attr)
                    if val is None or val == {}:
                        continue
                    if isinstance(val, dict) and not val.get("value"):
                        continue
                    attrs.append(attr)
                return {"uri": uri, "attrs": attrs}
        except Exception:
            pass
        return None

    results = await asyncio.gather(*(_get_one(u) for u in sample))
    return [r for r in results if r is not None]


# ---------------------------------------------------------------------------
# Benchmark runners (per entity)
# ---------------------------------------------------------------------------

async def run_concurrent(count, coro_fn):
    return list(await asyncio.gather(*(coro_fn() for _ in range(count))))


async def benchmark_create(client, endpoint):
    results = []
    for n in BATCH_SIZE_LEVELS:
        raw = await run_concurrent(n, lambda: do_create(client, endpoint))
        results.append(summarise("CREATE", n, raw))
        time.sleep(5)   # Qlever actually replies before being done
                        # => wait, so prev batch does not interfere with next one
    return results


async def benchmark_read(client, endpoint, instances):
    results = []
    for n in BATCH_SIZE_LEVELS:
        raw = await run_concurrent(n, lambda: do_read(client, endpoint, instances))
        results.append(summarise("READ", n, raw))
    return results


async def benchmark_update(client, endpoint, instances):
    results = []
    for n in BATCH_SIZE_LEVELS:
        raw = await run_concurrent(n, lambda: do_update(client, endpoint, instances))
        results.append(summarise("UPDATE", n, raw))
    return results


async def benchmark_delete(client, endpoint):
    """Pre-creates fresh resources for each level so we never deplete the main pool."""
    results = []
    for n in BATCH_SIZE_LEVELS:
        del_uris = await create_resources(client, endpoint, n)
        if len(del_uris) < n:
            print(f"  ⚠ Only {len(del_uris)}/{n} resources available for DELETE@{n}")
        raw = await asyncio.gather(*(do_delete(client, endpoint, u) for u in del_uris))
        results.append(summarise("DELETE", n, list(raw)))
    return results


async def run_entity_benchmark(client, endpoint, uris):
    """Run the full CREATE/READ/UPDATE/DELETE suite for one entity."""
    name = endpoint["entity"]
    all_results = []

    # Verify 100 instances by actually reading them and recording non-null attrs
    print(f"\n  [{name}] Verifying up to 100 instances...")
    instances = await fetch_verified_instances(client, endpoint, uris)
    print(f"  {len(instances)} verified instance(s) (used for READ/UPDATE)")
    if not instances:
        print(f"  No verified instances. READ/UPDATE benchmarks will be skipped.")

    print(f"\n  [{name}] CREATE")
    r = await benchmark_create(client, endpoint)
    print_table(r)
    all_results.extend(r)
    time.sleep(5)

    print(f"\n  [{name}] READ")
    r = await benchmark_read(client, endpoint, instances)
    print_table(r)
    all_results.extend(r)
    time.sleep(5)

    print(f"\n  [{name}] UPDATE")
    r = await benchmark_update(client, endpoint, instances)
    print_table(r)
    all_results.extend(r)
    time.sleep(5)

    print(f"\n  [{name}] DELETE")
    r = await benchmark_delete(client, endpoint)
    print_table(r)
    all_results.extend(r)
    time.sleep(5)

    for row in all_results:
        row["entity"] = name

    return all_results


# ---------------------------------------------------------------------------
# CSV export
# ---------------------------------------------------------------------------

CSV_COLUMNS = [
    "entity", "operation", "batch_size", "total", "succeeded", "failed",
    "min_ms", "avg_ms", "std_ms", "max_ms", "total_ms",
]


def save_csv(all_results, path):
    with open(path, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=CSV_COLUMNS)
        writer.writeheader()
        for row in all_results:
            writer.writerow({k: row.get(k, "") for k in CSV_COLUMNS})
    print(f"\nResults saved to {path}")


# ---------------------------------------------------------------------------
# Visualization — one 1x2 chart per entity
# ---------------------------------------------------------------------------

PURE_OPS = ["CREATE", "READ", "UPDATE", "DELETE"]


def generate_entity_chart(entity_name, csv_path, chart_path):
    df      = pd.read_csv(csv_path)
    df      = df[df["entity"] == entity_name]
    df_pure = df[df["operation"].isin(PURE_OPS)]

    fig, ax = plt.subplots(1, 1, figsize=(7, 5))
    #fig.suptitle(f"ShExpose Benchmark", fontsize=14, fontweight="bold")

    prop_cycle = plt.rcParams["axes.prop_cycle"].by_key()["color"]
    op_colors  = {op: prop_cycle[i % len(prop_cycle)] for i, op in enumerate(PURE_OPS)}

    for op in PURE_OPS:
        sub = df_pure[df_pure["operation"] == op]
        if sub.empty:
            continue
        color = op_colors[op]
        x, y, s = sub["batch_size"].values, sub["avg_ms"].values, sub["std_ms"].values
        ax.plot(x, y, marker="o", color=color, label=op)
        ax.fill_between(x, y - s, y + s, color=color, alpha=0.15)
    ax.set_xlabel("Batch Size (Requests)")
    ax.set_ylabel("Avg Latency (ms)")
    ax.set_title("Avg Latency ± Std Dev")
    ax.set_xticks(BATCH_SIZE_LEVELS)
    ax.legend()
    ax.grid(True, alpha=0.3)

    plt.tight_layout(rect=[0, 0, 1, 0.93])
    fig.savefig(chart_path, dpi=150)
    print(f"Chart saved to {chart_path}")
    plt.close(fig)


def redraw_charts(csv_path):
    """Regenerate all per-entity charts from an existing benchmark CSV without rerunning benchmarks."""
    df = pd.read_csv(csv_path)
    entity_names = df["entity"].unique()
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    out_dir = os.path.dirname(os.path.abspath(csv_path))
    print(f"Redrawing charts for: {', '.join(entity_names)}")
    for entity_name in entity_names:
        chart_path = os.path.join(out_dir, f"benchmark_chart_{entity_name}_{timestamp}.png")
        generate_entity_chart(entity_name, csv_path, chart_path)


async def main():
    print("\n  ShExpose Request Batch Benchmark")
    print(f"  REST target  : {BASE_URL}")
    print(f"  SPARQL       : {SPARQL_ENDPOINT}")
    print(f"  Batch Sizes  : {BATCH_SIZE_LEVELS}")

    async with httpx.AsyncClient() as client:

        print("\nDiscovering endpoints …")
        try:
            endpoint_map = await discover_endpoints(client)
        except Exception as exc:
            print(f"ERROR: {exc}")
            sys.exit(1)

        print(f"Found: {', '.join(endpoint_map.keys())}")

        all_results = []

        for entity_name, type_uri in ENTITY_TYPE_URIS.items():
            if entity_name not in endpoint_map:
                print(f"\n⚠  '{entity_name}' not in OpenAPI spec — skipping.")
                continue

            endpoint = endpoint_map[entity_name]
            print(f"\n{'='*62}")
            print(f"  Entity : {entity_name}")
            print(f"  Type   : <{type_uri}>")
            print(f"  Attrs  : {', '.join(endpoint['attributes'])}")
            print(f"{'='*62}")

            print("  Fetching existing instances …")
            uris = await fetch_uris(client, type_uri)
            print(f"  → {len(uris)} existing URI(s)")

            if not uris:
                print(f"  No URIs available - skipping benchmarks for {entity_name}.")
                continue
            print(f"  URI pool: {len(uris)} total")

            entity_results = await run_entity_benchmark(client, endpoint, uris)
            all_results.extend(entity_results)

        if all_results:
            save_csv(all_results, CSV_FILE)
            seen = set()
            for entity_name in (r["entity"] for r in all_results):
                if entity_name in seen:
                    continue
                seen.add(entity_name)
                chart_path = os.path.join(
                    SCRIPT_DIR, f"benchmark_chart_{entity_name}_{TIMESTAMP}.png"
                )
                generate_entity_chart(entity_name, CSV_FILE, chart_path)

    print("\nDone.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="ShExpose Request Batch Benchmark",
    )
    subparsers = parser.add_subparsers(dest="command")

    subparsers.add_parser("run", help="Run benchmarks and generate charts (default)")

    redraw_parser = subparsers.add_parser("redraw", help="Regenerate charts from an existing CSV")
    redraw_parser.add_argument("csv", metavar="CSV_FILE", help="Path to the benchmark CSV file")

    args = parser.parse_args()

    if args.command == "redraw":
        redraw_charts(args.csv)
    else:
        asyncio.run(main())
