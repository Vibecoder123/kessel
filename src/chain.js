import { ChatAnthropic } from "@langchain/anthropic";
import { createRetrievalChain } from "langchain/chains/retrieval";
import { createStuffDocumentsChain } from "langchain/chains/combine_documents";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { getVectorStore } from "./vectorstore.js";

// The system prompt deliberately omits source attribution to keep
// underlying documents private. Only synthesised answers are returned.
const SYSTEM_PROMPT = `You are Kessel, a helpful assistant for a private knowledge base.
Answer the user's question using only the information in the context below.
If the context does not contain enough information to answer, say so honestly — do not make anything up.
Do not reference or quote the source documents directly.

Context:
{context}`;

export async function buildChain() {
  const vectorStore = await getVectorStore();

  const retriever = vectorStore.asRetriever({ k: 4 });

  const llm = new ChatAnthropic({
    model: "claude-sonnet-4-6",
    apiKey: process.env.ANTHROPIC_API_KEY,
    temperature: 0.2,
  });
  // Workaround for @langchain/anthropic 0.3.34 bug: topP defaults to -1 and is
  // sent as-is for non-haiku models, but the API rejects top_p=-1.
  llm.topP = undefined;

  const prompt = ChatPromptTemplate.fromMessages([
    ["system", SYSTEM_PROMPT],
    ["human", "{input}"],
  ]);

  const combineDocsChain = await createStuffDocumentsChain({ llm, prompt });

  return createRetrievalChain({ retriever, combineDocsChain });
}
