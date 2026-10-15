"""Prepara uma cópia local do upstream; nunca toca na sessão do WhatsApp."""

from pathlib import Path
import argparse
import hashlib
import json
import os
import secrets
import shutil
import tempfile
from compat import aplicar_compatibilidade_go

ROOT = Path(__file__).resolve().parents[2]
RUNTIME = ROOT / ".whatsapp-local"
SOURCE = RUNTIME / "upstream"
APP = RUNTIME / "app"
MANIFEST_NAME = ".mel-prepared.json"
ARCHIVE_SHA256 = "ade0361916ed9f3ab4251537808e9c47f2916b202019f58e6bf1c9dea704755a"
APP_FILES = (
    "whatsapp-bridge/main.go",
    "whatsapp-bridge/local_server.go",
    "whatsapp-bridge/local_server_test.go",
    "whatsapp-bridge/local_activity.go",
    "whatsapp-bridge/local_activity_test.go",
    "whatsapp-bridge/go.mod",
    "whatsapp-bridge/go.sum",
    "whatsapp-mcp-server/main.py",
    "whatsapp-mcp-server/whatsapp.py",
    "whatsapp-mcp-server/audio.py",
    "whatsapp-mcp-server/pyproject.toml",
    "whatsapp-mcp-server/uv.lock",
)


def _digest(path: Path) -> str:
    if path.is_symlink() or not path.is_file():
        raise RuntimeError(f"Arquivo obrigatório ausente ou não regular: {path.name}")
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _artifact_hashes(app: Path) -> dict[str, str]:
    if app.is_symlink() or not app.is_dir():
        raise RuntimeError("Cópia local ausente ou não regular")
    for directory, suffix in (("whatsapp-bridge", ".go"), ("whatsapp-mcp-server", ".py")):
        target = app / directory
        if target.is_symlink() or not target.is_dir():
            raise RuntimeError("Diretório de código ausente ou não regular")
        expected = {name for name in APP_FILES if name.startswith(directory + "/") and name.endswith(suffix)}
        actual = {f"{directory}/{file.name}" for file in target.glob("*" + suffix)}
        if actual != expected:
            raise RuntimeError("Conjunto de arquivos de código divergente; não compilar")
    return {name: _digest(app / name) for name in APP_FILES}


def _input_hashes() -> dict[str, str]:
    directory = Path(__file__).resolve().parent
    names = [
        "prepare.py", "local_server.go", "local_server_test.go", "local_activity.go", "local_activity_test.go",
        "dependencies/go.mod", "dependencies/go.sum",
        "dependencies/pyproject.toml", "dependencies/uv.lock",
    ]
    # Compatibilidade do SDK, quando presente, também faz parte da preparação.
    if (directory / "compat.py").exists():
        names.append("compat.py")
    return {name: _digest(directory / name) for name in names}


def create_manifest(app: Path) -> dict:
    """Certifica explicitamente uma cópia revisada; não lê nem altera a sessão."""
    app = Path(app)
    manifest = {
        "version": 1,
        "upstream_sha256": ARCHIVE_SHA256,
        "inputs": _input_hashes(),
        "files": _artifact_hashes(app),
    }
    fd, temporary = tempfile.mkstemp(prefix=".mel-manifest-", dir=app)
    try:
        with os.fdopen(fd, "w") as output:
            json.dump(manifest, output, indent=2, sort_keys=True)
            output.write("\n")
        os.replace(temporary, app / MANIFEST_NAME)
    finally:
        Path(temporary).unlink(missing_ok=True)
    return manifest


def verify_manifest(app: Path) -> dict:
    """Rejeita cópias incompletas, alteradas ou preparadas com patches antigos."""
    app = Path(app)
    manifest_file = app / MANIFEST_NAME
    _digest(manifest_file)
    try:
        manifest = json.loads(manifest_file.read_text())
    except (ValueError, UnicodeError) as error:
        raise RuntimeError("Manifesto de preparação inválido; não compilar") from error
    expected = {
        "version": 1,
        "upstream_sha256": ARCHIVE_SHA256,
        "inputs": _input_hashes(),
        "files": _artifact_hashes(app),
    }
    if manifest != expected:
        raise RuntimeError("Manifesto divergente; revisar a cópia local antes de compilar")
    return manifest


def replace_once(text: str, before: str, after: str) -> str:
    if text.count(before) != 1:
        raise RuntimeError("Upstream divergente; patch interrompido sem iniciar o serviço")
    return text.replace(before, after, 1)


def patch_whatsapp(text: str) -> str:
    text = replace_once(text, 'WHATSAPP_API_BASE_URL = "http://localhost:8080/api"', '''WHATSAPP_API_BASE_URL = "http://127.0.0.1:18281/api"
_LOCAL_HTTP = requests.Session()
_LOCAL_HTTP.trust_env = False

def _local_post(url, payload):
    return _LOCAL_HTTP.post(
        url,
        json=payload,
        headers={"Authorization": "Bearer " + os.environ["MEL_WHATSAPP_BRIDGE_TOKEN"]},
        timeout=(3, 30),
        allow_redirects=False,
    )''')
    return text.replace('requests.post(url, json=payload)', '_local_post(url, payload)')


def patch_history_download(text: str) -> str:
    constructor = '''\tclient := whatsmeow.NewClient(deviceStore, logger)
\tif client == nil {
\t\tlogger.Errorf("Failed to create WhatsApp client")
\t\treturn
\t}
'''
    return replace_once(text, constructor, constructor + '''
\t// Confirmações de texto não precisam importar o histórico pessoal.
\tclient.ManualHistorySyncDownload = true
''')


def _patch_app(app: Path) -> None:
    go_file = app / "whatsapp-bridge/main.go"
    go = go_file.read_text()
    go = replace_once(go, 'func main() {', '''func main() {
	// A instalação pode ser testada sem abrir sessão ou rede do WhatsApp.
	if len(os.Getenv("MEL_WHATSAPP_BRIDGE_TOKEN")) < 32 {
		fmt.Fprintln(os.Stderr, "Token local ausente ou inválido")
		os.Exit(1)
	}
	if os.Getenv("MEL_WHATSAPP_SIMULATION") == "1" {
		startLocalRESTServer(nil, nil, 18281)
		exitChan := make(chan os.Signal, 1)
		signal.Notify(exitChan, syscall.SIGINT, syscall.SIGTERM)
		<-exitChan
		return
	}
	syscall.Umask(0077)
	defer os.Remove("pairing.png")''')
    go = replace_once(go, 'switch v := evt.(type) {\n\t\tcase *events.Message:\n\t\t\t// Process regular messages\n\t\t\thandleMessage(client, messageStore, v, logger)\n\n\t\tcase *events.HistorySync:\n\t\t\t// Process history sync events\n\t\t\thandleHistorySync(client, messageStore, v, logger)', '''switch evt.(type) {
		case *events.Message, *events.HistorySync:
			// Envio para o CRM não precisa guardar conversas ou histórico pessoal.''')
    go = replace_once(go, '\t// Setup event handling for messages and history sync', '''	stopActivity, err := startLocalActivityRecorder(client, os.Getenv("MEL_WHATSAPP_BRIDGE_TOKEN"))
	if err != nil {
		fmt.Fprintln(os.Stderr, "Não foi possível iniciar metadados de interação")
		return
	}
	defer stopActivity()

	// Setup event handling for messages and history sync''')
    go = replace_once(go, '\tclient.AddEventHandler(func(evt interface{}) {', '''	client.AddEventHandler(func(evt interface{}) {
		recordLocalActivityEvent(client, evt)''')
    go = replace_once(go, 'startRESTServer(client, messageStore, 8080)', 'startLocalRESTServer(client, messageStore, 18281)')
    go = replace_once(go, '\t\tqrChan, _ := client.GetQRChannel(context.Background())', '''		if os.Getenv("MEL_WHATSAPP_PAIRING") != "1" {
			fmt.Fprintln(os.Stderr, "Conecte o WhatsApp pelo comando de pareamento")
			os.Exit(1)
		}
		qrChan, _ := client.GetQRChannel(context.Background())''')
    go = replace_once(go, '\t_, err = client.SendMessage(context.Background(), recipientJID, msg)', '''	ctx, cancel := context.WithTimeout(context.Background(), 25*time.Second)
	defer cancel()
	_, err = client.SendMessage(ctx, recipientJID, msg)''')
    go = replace_once(go, '\t\t\t\tqrterminal.GenerateHalfBlock(evt.Code, qrterminal.L, os.Stdout)', '''				qrterminal.GenerateHalfBlock(evt.Code, qrterminal.L, os.Stdout)
				// QR fica apenas no arquivo local privado, para a operadora escanear.
				code, qrErr := qr.Encode(evt.Code, qr.L)
				if qrErr == nil {
					code.Scale = 5
					if writeErr := os.WriteFile("pairing.png", code.PNG(), 0600); writeErr != nil {
						fmt.Fprintln(os.Stderr, "Não foi possível salvar o QR local")
					}
				}''')
    go = replace_once(go, '\t"github.com/mdp/qrterminal"', '\t"github.com/mdp/qrterminal"\n\t"rsc.io/qr"')
    go = replace_once(go, '\t// Wait a moment for connection to stabilize', '\t_ = os.Remove("pairing.png")\n\n\t// Wait a moment for connection to stabilize')
    go_file.write_text(aplicar_compatibilidade_go(patch_history_download(go)))
    for name in ("local_server.go", "local_server_test.go", "local_activity.go", "local_activity_test.go"):
        shutil.copyfile(Path(__file__).parent / name, app / "whatsapp-bridge" / name)
    for name in ("go.mod", "go.sum"):
        shutil.copyfile(Path(__file__).parent / "dependencies" / name, app / "whatsapp-bridge" / name)
    for name in ("pyproject.toml", "uv.lock"):
        shutil.copyfile(Path(__file__).parent / "dependencies" / name, app / "whatsapp-mcp-server" / name)
    main_file = app / "whatsapp-mcp-server/main.py"
    main = main_file.read_text()
    main = replace_once(main, 'mcp = FastMCP("whatsapp")', '''mcp = FastMCP("whatsapp-mel-local")

def mel_tool():
    def register(function):
        if function.__name__ == "send_message":
            function.__doc__ = (
                "Envia texto ou link para um destinatário individual brasileiro "
                "(55 + DDD + número, só dígitos). Requer autorização humana do "
                "destinatário e conteúdo. Não envia arquivos nem grupos. "
                "Timeout tem resultado indeterminado: não repetir automaticamente."
            )
            return mcp.tool()(function)
        return function
    return register''')
    main = main.replace("@mcp.tool()", "@mel_tool()")
    main = replace_once(main, '''def send_message(
    recipient: str,
    message: str
)''', '''def send_message(
    recipient: str,
    message: str,
    automation_job_id: Optional[str] = None
)''')
    main = replace_once(main, 'whatsapp_send_message(recipient, message)', 'whatsapp_send_message(recipient, message, automation_job_id)')
    main_file.write_text(main)
    whatsapp_file = app / "whatsapp-mcp-server/whatsapp.py"
    whatsapp = patch_whatsapp(whatsapp_file.read_text())
    whatsapp = replace_once(whatsapp, 'def send_message(recipient: str, message: str)', 'def send_message(recipient: str, message: str, automation_job_id: Optional[str] = None)')
    whatsapp = replace_once(whatsapp,
        '            "message": message,\n        }\n        \n        response = _local_post(url, payload)',
        '            "message": message,\n        }\n        if automation_job_id is not None:\n            payload["automation_job_id"] = automation_job_id\n        \n        response = _local_post(url, payload)')
    whatsapp_file.write_text(whatsapp)


def prepare() -> None:
    archive = RUNTIME / "downloads/upstream.tar.gz"
    if _digest(archive) != ARCHIVE_SHA256:
        raise RuntimeError("Checksum do upstream divergente")
    if APP.exists() or APP.is_symlink():
        raise RuntimeError("Cópia local já existe; não substituir instalação ou sessão")
    RUNTIME.chmod(0o700)
    temporary = Path(tempfile.mkdtemp(prefix=".app-preparing-", dir=RUNTIME))
    try:
        staged = temporary / "app"
        shutil.copytree(SOURCE, staged, ignore=shutil.ignore_patterns(".venv", "__pycache__"))
        _patch_app(staged)
        create_manifest(staged)
        verify_manifest(staged)
        # A sessão é separada do app e nunca é substituída ou lida pelo preparo.
        state = RUNTIME / "state"
        state.mkdir(mode=0o700, exist_ok=True)
        token = state / "bridge-token"
        if not token.exists():
            fd = os.open(token, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(fd, "w") as output:
                output.write(secrets.token_urlsafe(48))
        if APP.exists() or APP.is_symlink():
            raise RuntimeError("Cópia local apareceu durante o preparo; não substituir")
        staged.rename(APP)
    finally:
        shutil.rmtree(temporary)
    print("Cópia local preparada; token privado criado; nenhuma conta conectada")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    actions = parser.add_mutually_exclusive_group()
    actions.add_argument("--verify", nargs="?", const=str(APP), metavar="APP")
    actions.add_argument("--create-manifest", nargs="?", const=str(APP), metavar="APP")
    arguments = parser.parse_args()
    if arguments.verify is not None:
        verify_manifest(Path(arguments.verify))
        print("Manifesto conferido; cópia local completa e inalterada")
    elif arguments.create_manifest is not None:
        create_manifest(Path(arguments.create_manifest))
        print("Manifesto criado para cópia local previamente revisada")
    else:
        prepare()
