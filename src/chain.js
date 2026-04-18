import { ChatAnthropic } from "@langchain/anthropic";
import { createRetrievalChain } from "langchain/chains/retrieval";
import { createStuffDocumentsChain } from "langchain/chains/combine_documents";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { getVectorStore } from "./vectorstore.js";

// The system prompt deliberately omits source attribution to keep
// underlying documents private. Only synthesised answers are returned.
const SYSTEM_PROMPT = `You are Kessel, an expert sales assistant with deep knowledge of the product catalogue.
Answer questions confidently and directly using only the information in the context below.
Be concise and specific — give the user exactly what they need to move forward.
If the context does not contain enough information to answer, say so briefly and suggest they contact the team for more detail.
Do not reference or quote the source documents directly. Do not use phrases like "based on the available information" or "according to the context".

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
