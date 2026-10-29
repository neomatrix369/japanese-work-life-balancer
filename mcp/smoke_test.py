"""
smoke_test.py — MCP smoke test for the Japanese Work-Life Balancer server.

Connects to the MCP server via streamable HTTP, lists all tools, then calls
compare_presets("burnout"). Because the Quarkus model is not running, the
tool call will return a graceful "model unreachable" error — that is the
expected outcome for this test.

Run:
    # In one terminal: uv run python server.py
    # In another:      uv run python smoke_test.py
"""

import asyncio

from mcp import Client


SERVER_URL = "http://localhost:8765/mcp"


async def main() -> None:
    print(f"Connecting to MCP server at {SERVER_URL} ...")
    async with Client(SERVER_URL) as client:

        # --- List tools ---
        tools_result = await client.list_tools()
        tools = tools_result.tools
        print(f"\nTools registered ({len(tools)}):")
        for t in tools:
            desc = (t.description or "")[:70]
            print(f"  {t.name:<30} {desc}")

        # --- List resources ---
        resources_result = await client.list_resources()
        print(f"\nResources ({len(resources_result.resources)}):")
        for r in resources_result.resources:
            print(f"  {r.uri}")

        # --- Call compare_presets("burnout") ---
        # Model is not running: expect a graceful "model unreachable" error.
        print("\nCalling compare_presets(scenario='burnout') ...")
        print("(Model is not running — expecting a graceful error message)\n")
        result = await client.call_tool(
            "compare_presets",
            {"scenario": "burnout"},
        )
        for content in result.content:
            print(getattr(content, "text", str(content)))
        if result.is_error:
            print("[OK] is_error=True — model unreachable, graceful error confirmed.")

    print("\nSmoke test complete.")


if __name__ == "__main__":
    asyncio.run(main())
