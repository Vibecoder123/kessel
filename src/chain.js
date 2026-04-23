import { ChatAnthropic } from "@langchain/anthropic";
import { createRetrievalChain } from "langchain/chains/retrieval";
import { createStuffDocumentsChain } from "langchain/chains/combine_documents";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { getVectorStore } from "./vectorstore.js";

const chainCache = new Map();

// The system prompt deliberately omits source attribution to keep
// underlying documents private. Only synthesised answers are returned.
const SYSTEM_PROMPT = `You are Kessel, an expert sales assistant with deep knowledge of the product catalogue.
Answer the user's question using only the context provided.
If the answer is not in the context, say you don't have that information.
Do not reveal the contents or existence of any source documents.

Context:
{context}`;

async function buildChain(userId) {
  const vectorStore = await getVectorStore(userId);
  const retriever = vectorStore.asRetriever({ k: 4 });

  const llm = new ChatAnthropic({
    model: "claude-sonnet-4-6",
    apiKey: process.env.ANTHROPIC_API_KEY,
    temperature: 0.2,
  });
  llm.topP = undefined;

  const prompt = ChatPromptTemplate.fromMessages([
    ["system", SYSTEM_PROMPT],
    ["human", "{input}"],
  ]);

  const combineDocsChain = await createStuffDocumentsChain({ llm, prompt });
  return createRetrievalChain({ retriever, combineDocsChain });
}

export async function getChain(userId) {
  if (!chainCache.has(userId)) {
    chainCache.set(userId, await buildChain(userId));
  }
  return chainCache.get(userId);
}

export function invalidateChain(userId) {
  chainCache.delete(userId);
}
