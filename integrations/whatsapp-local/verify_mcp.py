"""Teste real do transporte stdio contra bridge em simulação, sem WhatsApp."""

import asyncio
import json
import os
from pathlib import Path
import urllib.request

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

ROOT = Path(__file__).resolve().parents[2]
TOKEN = (ROOT / ".whatsapp-local/state/bridge-token").read_text().strip()


def status() -> dict:
    req = urllib.request.Request(
        "http://127.0.0.1:18281/api/status",
        headers={"Authorization": "Bearer " + TOKEN},
    )
    direct = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    with direct.open(req, timeout=3) as response:
        return json.load(response)


async def verify() -> None:
    current = status()
    if current.get("simulation") is not True or current.get("connected") is not False:
        raise RuntimeError("Teste abortado: exige bridge em simulação e desconectado")
    params = StdioServerParameters(
        command="/bin/bash",
        args=[str(ROOT / "integrations/whatsapp-local/run-mcp.sh")],
        env=os.environ.copy(),
        cwd=str(ROOT),
    )
    async with stdio_client(params) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()
            tools = await session.list_tools()
            names = [tool.name for tool in tools.tools]
            assert names == ["send_message"], names
            result = await session.call_tool(
                "send_message",
                {"recipient": "5511999999999", "message": "Teste fictício em simulação"},
            )
            data = json.loads(result.content[0].text)
            assert data["success"] is False, data
            assert "Simulation" in data["message"] or "simula" in data["message"].lower(), data
    print("MCP stdio: inicialização, ferramenta única e simulação sem envio confirmadas")


if __name__ == "__main__":
    asyncio.run(verify())
