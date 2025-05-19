# DEMO Chatbot Câmara Municipal SP

## Visão Geral
Chatbot especializado em informações sobre a Câmara Municipal de São Paulo e seus 55 vereadores (19ª legislatura, 2025-2028). Parte da iniciativa Pêndulo para aproximação cidadão-política.

**Principais características**:
- Respostas contextualizadas sobre vereadores, projetos e estrutura
- API REST com persistência em Redis
- Sistema de recuperação semântica (embeddings + vector store)

## Stack Tecnológica
- **Backend**: Node.js + Express
- **Banco**: Redis (conversas) + FAISS (vector store)
- **IA**: LangChain + OpenAI (GPT-4/GPT-3.5)
- **Embeddings**: text-embedding-3-large

---
*© 2025 Optimus Data Technology - Licença Acadêmica (ver [LICENSE](LICENSE))*

## Fluxo de Inteligência
```mermaid
graph TD
    A[Input usuário] --> B{Precisa de retrieval?}
    B -->|Sim| C[Gerar query]
    B -->|Não| D[Responder direto]
    C --> E[Buscar no vector store]
    E --> F[Contexto encontrado?]
    F -->|Sim| G[Gerar resposta contextual]
    F -->|Não| H[Responder padrão]
    G & D & H --> I[Armazenar no Redis]




