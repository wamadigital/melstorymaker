"""Adaptação reproduzível do upstream fixado para o SDK whatsmeow atual.

Só transforma texto Go. Não lê sessão, inicia clientes ou acessa o WhatsApp.
Aplicar ao main.go da cópia preparada, mantendo os patches de privacidade.
"""

SDK_VERSION = "v0.0.0-20261014094007-f16f9ca30d6a"


def aplicar_compatibilidade_go(texto: str) -> str:
    regras = (
        (
            'waProto "go.mau.fi/whatsmeow/binary/proto"',
            'waProto "go.mau.fi/whatsmeow/proto/waE2E"',
        ),
        (
            'sqlstore.New("sqlite3", ',
            'sqlstore.New(context.Background(), "sqlite3", ',
        ),
        (
            "container.GetFirstDevice()",
            "container.GetFirstDevice(context.Background())",
        ),
        (
            "client.Download(downloader)",
            "client.Download(context.Background(), downloader)",
        ),
        (
            "client.GetGroupInfo(jid)",
            "client.GetGroupInfo(context.Background(), jid)",
        ),
        (
            "client.Store.Contacts.GetContact(jid)",
            "client.Store.Contacts.GetContact(context.Background(), jid)",
        ),
    )
    # Valida todas as âncoras antes de transformar, sem aceitar um patch parcial
    # ou aplicar novamente sobre uma cópia que já usa a API nova.
    for indice, (antes, _) in enumerate(regras, start=1):
        if texto.count(antes) != 1:
            raise RuntimeError(f"Compatibilidade whatsmeow: âncora {indice} divergente")
    for antes, depois in regras:
        texto = texto.replace(antes, depois, 1)
    return texto
