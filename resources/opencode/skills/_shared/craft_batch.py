"""Comandos de Word/Deck por stdin del MCP local, nunca por argv ni por el entorno."""
import json
import subprocess


def run(binary, commands, out, env, timeout):
    parsed = []
    for line in commands:
        command, sep, params = line.partition('=')
        parsed.append(dict(command=command, **({'params': json.loads(params)} if sep else {})))
    parsed.append({'command': 'file.saveAs', 'params': {'path': out}})
    messages = [
        {'jsonrpc': '2.0', 'id': 1, 'method': 'initialize', 'params': {
            'protocolVersion': '2024-11-05', 'capabilities': {}, 'clientInfo': {'name': 'lazunox', 'version': '1'}}},
        {'jsonrpc': '2.0', 'method': 'notifications/initialized'},
        {'jsonrpc': '2.0', 'id': 2, 'method': 'tools/call', 'params': {
            'name': 'batch', 'arguments': {'commands': parsed, 'keepGoing': False}}}
    ]
    result = subprocess.run([binary, 'mcp'], input=''.join(json.dumps(m) + '\n' for m in messages),
                            capture_output=True, text=True, timeout=timeout, env=env)
    if result.returncode:
        return result
    try:
        reply = next(json.loads(line) for line in result.stdout.splitlines() if json.loads(line).get('id') == 2)
        if reply.get('error') or reply['result'].get('isError'):
            raise ValueError('falló la tanda de comandos')
        rows = json.loads(next(c['text'] for c in reply['result']['content'] if c['type'] == 'text'))
        if len(rows) != len(parsed) or any(r.get('ok') is not True for r in rows):
            raise ValueError('falló un comando de la tanda')
    except (ValueError, KeyError, TypeError, StopIteration) as e:
        return subprocess.CompletedProcess(result.args, 1, result.stdout, 'ArtCraft: ' + str(e))
    return result
